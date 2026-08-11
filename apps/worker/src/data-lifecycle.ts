import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { readOrganizationPurgePolicy } from "./data-retention.js";
import {
  claimOrganizationDeletion,
  createOrganizationPurgeProviders,
  failOrRetryOrganization,
  processOrganizationRequest,
  type OrganizationPurgeProviders,
  type OrganizationPurgeStorage,
} from "./organization-purge.js";

export const dataLifecycleJobName = "data-lifecycle.process";

const accountDomains = ["account_security", "account_memberships", "account_profile", "final_verification"] as const;

export type DataLifecycleOptions = {
  batchSize: number;
  claimTimeoutMinutes: number;
  maxAttempts: number;
  retryBaseSeconds: number;
};

function integer(env: NodeJS.ProcessEnv, name: string, fallback: number, minimum: number, maximum: number) {
  const value = Number(env[name] ?? fallback);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

export function readDataLifecycleOptions(env: NodeJS.ProcessEnv = process.env): DataLifecycleOptions {
  return {
    batchSize: integer(env, "DATA_LIFECYCLE_BATCH_SIZE", 250, 1, 1_000),
    claimTimeoutMinutes: integer(env, "DATA_LIFECYCLE_CLAIM_TIMEOUT_MINUTES", 15, 1, 120),
    maxAttempts: integer(env, "DATA_LIFECYCLE_MAX_ATTEMPTS", 8, 1, 25),
    retryBaseSeconds: integer(env, "DATA_LIFECYCLE_RETRY_BASE_SECONDS", 30, 5, 3_600),
  };
}

type ClaimedAccountRequest = {
  id: string;
  user_id: string;
  claim_token: string;
  attempts: number;
};

export async function claimAccountDeletion(
  client: PoolClient,
  options: DataLifecycleOptions,
): Promise<ClaimedAccountRequest | null> {
  const claimToken = randomUUID();
  await client.query("begin");
  try {
    const selected = await client.query<{ id: string; user_id: string; attempts: number }>(
      `select request.id, request.user_id, request.attempts
         from account_deletion_requests request
        where (
          (request.status = 'scheduled' and request.scheduled_for <= now())
          or (request.status = 'retry_wait' and request.retry_at <= now())
          or (
            request.status = 'processing'
            and request.heartbeat_at < now() - ($1::int * interval '1 minute')
          )
        )
        order by coalesce(request.retry_at, request.scheduled_for, request.heartbeat_at), request.created_at
        for update skip locked
        limit 1`,
      [options.claimTimeoutMinutes],
    );
    const request = selected.rows[0];
    if (!request) {
      await client.query("commit");
      return null;
    }
    const now = new Date();
    const claimed = await client.query<ClaimedAccountRequest>(
      `update account_deletion_requests
          set status = 'processing',
              processing_started_at = coalesce(processing_started_at, $2),
              retry_at = null,
              claim_token = $3,
              claimed_at = $2,
              heartbeat_at = $2,
              attempts = attempts + 1,
              updated_at = $2
        where id = $1
        returning id, user_id, claim_token, attempts`,
      [request.id, now, claimToken],
    );
    await client.query(
      `update users
          set lifecycle_state = 'auth_disabled', auth_disabled_at = coalesce(auth_disabled_at, $2), updated_at = $2
        where id = $1 and lifecycle_state in ('deletion_pending', 'auth_disabled')`,
      [request.user_id, now],
    );
    for (const domain of accountDomains) {
      await client.query(
        `insert into data_purge_checkpoints
          (account_request_id, domain, partition_key, batch_size)
         values ($1, $2::purge_domain, 'default', $3)
         on conflict (account_request_id, domain, partition_key)
           where account_request_id is not null
         do nothing`,
        [request.id, domain, options.batchSize],
      );
    }
    await client.query("commit");
    return claimed.rows[0] ?? null;
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

async function markCheckpointProcessing(
  client: PoolClient,
  requestId: string,
  domain: (typeof accountDomains)[number],
) {
  const claimToken = randomUUID();
  const result = await client.query<{ id: string }>(
    `update data_purge_checkpoints
        set status = 'processing', claim_token = $3, claimed_at = now(), heartbeat_at = now(),
            attempts = attempts + 1, retry_at = null, updated_at = now()
      where account_request_id = $1 and domain = $2 and status <> 'verified'
      returning id`,
    [requestId, domain, claimToken],
  );
  return result.rows[0]?.id ?? null;
}

async function verifyCheckpoint(client: PoolClient, checkpointId: string, completedCount: number) {
  await client.query(
    `update data_purge_checkpoints
        set status = 'verified', discovered_count = greatest(discovered_count, $2),
            completed_count = $2, verified_at = now(), last_batch_at = now(),
            claim_token = null, claimed_at = null, heartbeat_at = null, updated_at = now()
      where id = $1`,
    [checkpointId, completedCount],
  );
}

async function purgeAccountSecurity(client: PoolClient, userId: string) {
  let deleted = 0;
  for (const statement of [
    "delete from refresh_tokens where user_id = $1",
    "delete from user_sessions where user_id = $1",
    "delete from auth_tokens where user_id = $1",
    "delete from oauth_identities where user_id = $1",
    "delete from user_mfa_factors where user_id = $1",
  ]) {
    deleted += (await client.query(statement, [userId])).rowCount ?? 0;
  }
  return deleted;
}

async function purgeAccountMemberships(client: PoolClient, userId: string) {
  let deleted = 0;
  for (const statement of [
    "delete from task_approval_reviewers where reviewer_id = $1",
    "delete from task_followers where user_id = $1",
    "delete from task_assignees where user_id = $1",
    "delete from project_members where user_id = $1",
    "delete from memberships where user_id = $1",
  ]) {
    deleted += (await client.query(statement, [userId])).rowCount ?? 0;
  }
  return deleted;
}

async function purgeAccountProfile(client: PoolClient, userId: string) {
  let deleted = 0;
  for (const statement of [
    "delete from notification_preferences where user_id = $1",
    "delete from user_onboarding_progress where user_id = $1",
    "delete from dashboard_layouts where user_id = $1",
    "delete from notifications where user_id = $1",
    "delete from saved_views where created_by = $1 and is_shared = false",
  ]) {
    deleted += (await client.query(statement, [userId])).rowCount ?? 0;
  }
  return deleted;
}

async function remainingAccountPersonalRows(client: PoolClient, userId: string) {
  const result = await client.query<{ remaining: number }>(
    `select (
       (select count(*) from refresh_tokens where user_id = $1) +
       (select count(*) from user_sessions where user_id = $1) +
       (select count(*) from auth_tokens where user_id = $1) +
       (select count(*) from oauth_identities where user_id = $1) +
       (select count(*) from user_mfa_factors where user_id = $1) +
       (select count(*) from memberships where user_id = $1) +
       (select count(*) from project_members where user_id = $1) +
       (select count(*) from task_assignees where user_id = $1) +
       (select count(*) from task_followers where user_id = $1) +
       (select count(*) from notification_preferences where user_id = $1) +
       (select count(*) from user_onboarding_progress where user_id = $1) +
       (select count(*) from dashboard_layouts where user_id = $1) +
       (select count(*) from notifications where user_id = $1) +
       (select count(*) from saved_views where created_by = $1 and is_shared = false)
     )::int as remaining`,
    [userId],
  );
  return result.rows[0]?.remaining ?? -1;
}

async function processAccountRequest(pool: Pool, request: ClaimedAccountRequest) {
  const client = await pool.connect();
  try {
    for (const [domain, operation] of [
      ["account_security", purgeAccountSecurity],
      ["account_memberships", purgeAccountMemberships],
      ["account_profile", purgeAccountProfile],
    ] as const) {
      await client.query("begin");
      try {
        const checkpointId = await markCheckpointProcessing(client, request.id, domain);
        if (checkpointId) {
          const completed = await operation(client, request.user_id);
          await verifyCheckpoint(client, checkpointId, completed);
        }
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw error;
      }
    }

    await client.query("begin");
    try {
      const verificationCheckpoint = await markCheckpointProcessing(client, request.id, "final_verification");
      const remaining = await remainingAccountPersonalRows(client, request.user_id);
      if (remaining !== 0) throw new Error("ACCOUNT_VERIFICATION_REMAINING_ROWS");
      if (verificationCheckpoint) await verifyCheckpoint(client, verificationCheckpoint, 0);

      const locked = await client.query<{ status: string; claim_token: string }>(
        `select status, claim_token from account_deletion_requests where id = $1 for update`,
        [request.id],
      );
      if (locked.rows[0]?.status !== "processing" || locked.rows[0]?.claim_token !== request.claim_token) {
        throw new Error("ACCOUNT_CLAIM_LOST");
      }
      const verification = await client.query<{ verified: number; incomplete: number }>(
        `select
           count(*) filter (where status = 'verified')::int as verified,
           count(*) filter (where status <> 'verified')::int as incomplete
         from data_purge_checkpoints
         where account_request_id = $1`,
        [request.id],
      );
      if (verification.rows[0]?.verified !== accountDomains.length || verification.rows[0]?.incomplete !== 0) {
        throw new Error("ACCOUNT_DOMAINS_NOT_VERIFIED");
      }

      const now = new Date();
      await client.query(
        `update users
            set lifecycle_state = 'anonymized', auth_disabled_at = coalesce(auth_disabled_at, $2), anonymized_at = $2,
                email = 'deleted+' || id::text || '@users.invalid', name = 'Deleted user', avatar_url = null,
                password_hash = null, email_verified_at = null, password_changed_at = null,
                failed_login_attempts = 0, locked_until = null, last_failed_login_at = null,
                locale = null, theme = null, skills = '[]'::jsonb, updated_at = $2
          where id = $1`,
        [request.user_id, now],
      );
      await client.query(
        `update account_deletion_requests
            set status = 'completed', completed_at = $2,
                claim_token = null, claimed_at = null, heartbeat_at = null,
                last_error_code = null, last_error_summary = null, updated_at = $2
          where id = $1`,
        [request.id, now],
      );
      await client.query(
        `insert into data_deletion_receipts
          (subject_type, outcome, schema_version, verification_version, domain_summary, completed_at)
         values ('account', 'anonymized', 1, 'account-v1', $1::jsonb, $2)`,
        [JSON.stringify(Object.fromEntries(accountDomains.map((domain) => [domain, 1]))), now],
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  } finally {
    client.release();
  }
}

function errorCode(error: unknown) {
  const value = error instanceof Error ? error.message : "UNKNOWN_FAILURE";
  return /^[A-Z0-9_]{3,64}$/.test(value) ? value : "ACCOUNT_PURGE_FAILED";
}

async function failOrRetryAccount(
  pool: Pool,
  request: ClaimedAccountRequest,
  options: DataLifecycleOptions,
  error: unknown,
) {
  const terminal = request.attempts >= options.maxAttempts;
  const delaySeconds = Math.min(86_400, options.retryBaseSeconds * 2 ** Math.max(0, request.attempts - 1));
  await pool.query(
    `update account_deletion_requests
        set status = $3::deletion_request_status,
            retry_at = case when $3 = 'retry_wait' then now() + ($4::int * interval '1 second') else null end,
            failed_at = now(), claim_token = null, claimed_at = null, heartbeat_at = null,
            last_error_code = $5, last_error_summary = 'Account purge did not complete; progress was retained',
            updated_at = now()
      where id = $1 and claim_token = $2 and status = 'processing'`,
    [request.id, request.claim_token, terminal ? "failed" : "retry_wait", delaySeconds, errorCode(error)],
  );
}

export type DataLifecycleDependencies = {
  organizationStorage: OrganizationPurgeStorage;
  organizationProviders?: OrganizationPurgeProviders;
  env?: NodeJS.ProcessEnv;
};

export async function retryFailedDataLifecycleRequest(
  pool: Pool,
  subjectType: "account" | "organization",
  requestId: string,
) {
  const requestTable = subjectType === "account" ? "account_deletion_requests" : "organization_deletion_requests";
  const parentColumn = subjectType === "account" ? "account_request_id" : "organization_request_id";
  const client = await pool.connect();
  await client.query("begin");
  try {
    const request = await client.query(
      `update ${requestTable}
          set status = 'retry_wait', retry_at = now(), claim_token = null, claimed_at = null,
              heartbeat_at = null, updated_at = now()
        where id = $1 and status = 'failed' and processing_started_at is not null
        returning id`,
      [requestId],
    );
    if (!request.rowCount) {
      await client.query("rollback");
      return false;
    }
    await client.query(
      `update data_purge_checkpoints
          set status = 'retry_wait', retry_at = now(), claim_token = null, claimed_at = null,
              heartbeat_at = null, updated_at = now()
        where ${parentColumn} = $1 and status = 'failed'`,
      [requestId],
    );
    await client.query(
      `update data_purge_items
          set status = 'retry_wait', retry_at = now(), claim_token = null, claimed_at = null,
              heartbeat_at = null, updated_at = now()
        where ${parentColumn} = $1 and status = 'failed'`,
      [requestId],
    );
    await client.query("commit");
    return true;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function processDataLifecycle(
  pool: Pool,
  options = readDataLifecycleOptions(),
  dependencies?: DataLifecycleDependencies,
) {
  let processed = 0;
  while (processed < options.batchSize) {
    const client = await pool.connect();
    let request: ClaimedAccountRequest | null;
    try {
      request = await claimAccountDeletion(client, options);
    } finally {
      client.release();
    }
    if (!request) break;
    try {
      await processAccountRequest(pool, request);
    } catch (error) {
      await failOrRetryAccount(pool, request, options, error);
    }
    processed += 1;
  }
  if (dependencies) {
    const policy = readOrganizationPurgePolicy(dependencies.env);
    const providers = dependencies.organizationProviders ?? createOrganizationPurgeProviders(dependencies.env);
    let organizationProcessed = 0;
    while (organizationProcessed < options.batchSize) {
      const client = await pool.connect();
      let request;
      try {
        request = await claimOrganizationDeletion(client, options, policy);
      } finally {
        client.release();
      }
      if (!request) break;
      try {
        await processOrganizationRequest(pool, request, dependencies.organizationStorage, providers, policy, options);
      } catch (error) {
        await failOrRetryOrganization(pool, request, options, error);
      }
      organizationProcessed += 1;
      processed += 1;
    }
  }
  return { processed };
}
