import {
  decryptIntegrationCredential,
  purgeLocatorFingerprint,
  validatePurgeLocator,
  type PurgeDomain,
  type PurgeLocatorKind,
} from "@calmboard/database";
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient, QueryResult } from "pg";
import {
  organizationPurgeDomains,
  readOrganizationPurgePolicy,
  type OrganizationPurgeDomain,
  type OrganizationPurgePolicy,
} from "./data-retention.js";

export type OrganizationPurgeOptions = {
  batchSize: number;
  claimTimeoutMinutes: number;
  maxAttempts: number;
  retryBaseSeconds: number;
};

export type OrganizationPurgeStorage = {
  deleteReference(reference: string): Promise<void>;
  referenceExists(reference: string): Promise<boolean>;
  deleteObject(key: string): Promise<void>;
  objectExists(key: string): Promise<boolean>;
};

type IntegrationResource = {
  id: string;
  organization_id: string;
  workspace_id: string;
  provider: string;
  credential_key: string;
  auth_type: "oauth2" | "api_key" | "bearer" | "basic" | "webhook_secret";
  encrypted_payload: string;
  initialization_vector: string;
  authentication_tag: string;
  encryption_algorithm: "aes-256-gcm";
  encryption_key_version: number;
  secret_fingerprint: string;
  external_account_id: string | null;
};

type BillingResource = {
  id: string;
  provider: string;
  provider_customer_id: string | null;
  provider_subscription_id: string | null;
};

export type OrganizationPurgeProviders = {
  revokeIntegration(resource: IntegrationResource): Promise<void>;
  revokeBilling(resource: BillingResource): Promise<void>;
};

type ClaimedOrganizationRequest = {
  id: string;
  organization_id: string;
  claim_token: string;
  attempts: number;
};

const relationalTables = [
  "activities",
  "ai_action_proposals",
  "ai_usage_events",
  "ai_usage_periods",
  "automation_runs",
  "automation_events",
  "automations",
  "branches",
  "comment_mentions",
  "comments",
  "custom_fields",
  "dashboard_layouts",
  "form_responses",
  "forms",
  "goal_checkins",
  "goal_task_links",
  "goals",
  "idempotency_keys",
  "integration_webhook_receipts",
  "integration_webhook_endpoints",
  "invitation_email_outbox",
  "invitations",
  "membership_permission_overrides",
  "membership_role_bindings",
  "memberships",
  "notification_email_outbox",
  "notifications",
  "project_baseline_tasks",
  "project_baselines",
  "project_members",
  "project_teams",
  "project_wip_limits",
  "roles",
  "saved_views",
  "sprint_analytics_events",
  "sprint_snapshots",
  "task_approval_reviewers",
  "task_approval_requests",
  "task_assignees",
  "task_checklist_items",
  "task_checklists",
  "task_dependencies",
  "task_followers",
  "task_recurrence_rules",
  "task_relations",
  "task_reminders",
  "task_serial_sequences",
  "task_sprint_assignments",
  "sprints",
  "teams",
  "time_logs",
  "tasks",
  "project_sections",
  "projects",
  "timesheets",
  "usage_limits",
  "user_onboarding_progress",
  "workload_capacities",
  "workload_time_off",
  "workspaces",
] as const;

const directlyDeletedTables = [
  ...relationalTables,
  "doc_versions",
  "document_permissions",
  "report_schedule_recipients",
  "report_schedules",
] as const;

type DirectlyDeletedTable = (typeof directlyDeletedTables)[number];

const requiredDomains = [...organizationPurgeDomains] as const;

function safeProviderError(response: Response, provider: string) {
  return new Error(`${provider.toUpperCase()}_REVOCATION_HTTP_${response.status}`);
}

function providerSecret(env: NodeJS.ProcessEnv, name: string) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}

export function createOrganizationPurgeProviders(env: NodeJS.ProcessEnv = process.env): OrganizationPurgeProviders {
  return {
    async revokeIntegration(resource) {
      if (resource.auth_type !== "oauth2") throw new Error("EXTERNAL_CREDENTIAL_REVOCATION_UNSUPPORTED");
      const secrets = decryptIntegrationCredential(
        {
          id: resource.id,
          organizationId: resource.organization_id,
          workspaceId: resource.workspace_id,
          provider: resource.provider,
          credentialKey: resource.credential_key,
          authType: resource.auth_type,
        },
        {
          encryptedPayload: resource.encrypted_payload,
          initializationVector: resource.initialization_vector,
          authenticationTag: resource.authentication_tag,
          encryptionAlgorithm: resource.encryption_algorithm,
          encryptionKeyVersion: resource.encryption_key_version,
          secretFingerprint: resource.secret_fingerprint,
        },
      );
      const token = secrets.accessToken;
      if (!token) throw new Error("OAUTH_ACCESS_TOKEN_UNAVAILABLE");
      let response: Response;
      if (resource.provider === "github") {
        const clientId = providerSecret(env, "INTEGRATION_GITHUB_CLIENT_ID");
        const clientSecret = providerSecret(env, "INTEGRATION_GITHUB_CLIENT_SECRET");
        response = await fetch(`https://api.github.com/applications/${encodeURIComponent(clientId)}/grant`, {
          method: "DELETE",
          headers: {
            authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
            accept: "application/vnd.github+json",
            "content-type": "application/json",
            "user-agent": "CalmBoard-Data-Lifecycle",
          },
          body: JSON.stringify({ access_token: token }),
          signal: AbortSignal.timeout(10_000),
        });
        if (response.status !== 204 && response.status !== 404) throw safeProviderError(response, "github");
        return;
      }
      if (resource.provider === "slack") {
        response = await fetch("https://slack.com/api/auth.revoke", {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ test: "false" }),
          signal: AbortSignal.timeout(10_000),
        });
        const body = (await response.json().catch(() => null)) as { ok?: boolean; revoked?: boolean } | null;
        if (!response.ok || body?.ok !== true || body.revoked !== true) throw safeProviderError(response, "slack");
        return;
      }
      if (resource.provider === "gcal") {
        response = await fetch("https://oauth2.googleapis.com/revoke", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ token }),
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) throw safeProviderError(response, "google");
        return;
      }
      // Microsoft does not expose an application-safe per-token revocation acknowledgement
      // matching this workflow. Refuse completion instead of treating local deletion as proof.
      throw new Error("PROVIDER_REVOCATION_ACKNOWLEDGEMENT_UNAVAILABLE");
    },

    async revokeBilling(resource) {
      if (resource.provider === "internal" || !resource.provider_subscription_id) return;
      if (resource.provider !== "stripe") throw new Error("BILLING_PROVIDER_REVOCATION_UNSUPPORTED");
      const secret = providerSecret(env, "STRIPE_SECRET_KEY");
      const mode = env.STRIPE_PURGE_MODE;
      if (secret.startsWith("sk_test_") && mode !== "test") throw new Error("STRIPE_PURGE_MODE_TEST_REQUIRED");
      if (!secret.startsWith("sk_test_") && (mode !== "live" || env.STRIPE_LIVE_PURGE_ENABLED !== "true")) {
        throw new Error("STRIPE_LIVE_PURGE_NOT_EXPLICITLY_ENABLED");
      }
      const response = await fetch(
        `https://api.stripe.com/v1/subscriptions/${encodeURIComponent(resource.provider_subscription_id)}`,
        {
          method: "DELETE",
          headers: { authorization: `Bearer ${secret}` },
          signal: AbortSignal.timeout(10_000),
        },
      );
      const body = (await response.json().catch(() => null)) as {
        id?: unknown;
        deleted?: unknown;
        status?: unknown;
      } | null;
      if (
        !response.ok ||
        body?.id !== resource.provider_subscription_id ||
        (body.deleted !== true && body.status !== "canceled")
      ) {
        throw safeProviderError(response, "stripe");
      }
    },
  };
}

function classification(policy: OrganizationPurgePolicy, domain: OrganizationPurgeDomain) {
  const value = policy.classifications?.[domain];
  if (!value) throw new Error("RETENTION_POLICY_INCOMPLETE");
  return value;
}

function requireLocalPurge(policy: OrganizationPurgePolicy, domain: OrganizationPurgeDomain) {
  const value = classification(policy, domain);
  if (value !== "PURGE") throw new Error(`UNSUPPORTED_${domain.toUpperCase()}_${value}`);
}

function requireProviderPurge(policy: OrganizationPurgePolicy, domain: "integration_oauth" | "billing_provider") {
  const value = classification(policy, domain);
  if (value !== "PURGE" && value !== "EXTERNAL_REVOCATION") {
    throw new Error(`UNSUPPORTED_${domain.toUpperCase()}_${value}`);
  }
  return value;
}

async function insertItem(
  client: PoolClient,
  requestId: string,
  domain: PurgeDomain,
  locatorKind: PurgeLocatorKind,
  locator: Record<string, unknown>,
) {
  validatePurgeLocator(domain, locatorKind, locator);
  const fingerprint = purgeLocatorFingerprint(domain, locatorKind, locator);
  const result = await client.query<{ id: string; status: string }>(
    `insert into data_purge_items
       (organization_request_id, domain, locator_kind, locator, locator_fingerprint)
     values ($1, $2::purge_domain, $3::purge_locator_kind, $4::jsonb, $5)
     on conflict (organization_request_id, domain, locator_fingerprint)
       where organization_request_id is not null
     do update set locator = excluded.locator
     returning id, status`,
    [requestId, domain, locatorKind, JSON.stringify(locator), fingerprint],
  );
  return result.rows[0]!;
}

async function processItem(
  client: PoolClient,
  itemId: string,
  options: OrganizationPurgeOptions,
  operation: () => Promise<void>,
  verify: () => Promise<boolean>,
) {
  const claimToken = randomUUID();
  const claim = await client.query<{ attempts: number }>(
    `update data_purge_items
        set status = 'processing', attempts = attempts + 1, retry_at = null,
            claim_token = $2, claimed_at = now(), heartbeat_at = now(), updated_at = now()
      where id = $1 and status <> 'verified'
      returning attempts`,
    [itemId, claimToken],
  );
  if (!claim.rowCount) return;
  try {
    await operation();
    if (!(await verify())) throw new Error("PURGE_ITEM_NOT_ABSENT");
    await client.query(
      `update data_purge_items
          set status = 'verified', completed_at = coalesce(completed_at, now()), verified_at = now(),
              claim_token = null, claimed_at = null, heartbeat_at = null,
              last_error_code = null, last_error_summary = null, updated_at = now()
        where id = $1 and claim_token = $2`,
      [itemId, claimToken],
    );
  } catch (error) {
    const attempts = claim.rows[0]?.attempts ?? options.maxAttempts;
    const terminal = attempts >= options.maxAttempts;
    const delay = Math.min(86_400, options.retryBaseSeconds * 2 ** Math.max(0, attempts - 1));
    await client.query(
      `update data_purge_items
          set status = $3::purge_item_status,
              retry_at = case when $3 = 'retry_wait' then now() + ($4::int * interval '1 second') else null end,
              claim_token = null, claimed_at = null, heartbeat_at = null,
              last_error_code = 'PURGE_ITEM_FAILED', last_error_summary = 'Item progress retained for trusted retry',
              updated_at = now()
        where id = $1 and claim_token = $2`,
      [itemId, claimToken, terminal ? "failed" : "retry_wait", delay],
    );
    throw error;
  }
}

async function checkpoint(client: PoolClient, requestId: string, domain: OrganizationPurgeDomain) {
  const result = await client.query<{ id: string; status: string; cursor: Record<string, unknown> }>(
    `select id, status, cursor from data_purge_checkpoints
      where organization_request_id = $1 and domain = $2 and partition_key = 'default'`,
    [requestId, domain],
  );
  return result.rows[0]!;
}

async function beginCheckpoint(client: PoolClient, id: string) {
  await client.query(
    `update data_purge_checkpoints
        set status = 'processing', attempts = attempts + 1, retry_at = null,
            claim_token = gen_random_uuid(), claimed_at = now(), heartbeat_at = now(), updated_at = now()
      where id = $1 and status <> 'verified'`,
    [id],
  );
}

async function finishCheckpoint(client: PoolClient, id: string, discovered: number, completed: number) {
  await client.query(
    `update data_purge_checkpoints
        set status = 'verified', discovered_count = discovered_count + $2,
            completed_count = completed_count + $3, verified_at = now(), last_batch_at = now(),
            claim_token = null, claimed_at = null, heartbeat_at = null,
            last_error_code = null, last_error_summary = null, updated_at = now()
      where id = $1`,
    [id, discovered, completed],
  );
}

async function failCheckpoint(client: PoolClient, id: string, options: OrganizationPurgeOptions) {
  const result = await client.query<{ attempts: number }>("select attempts from data_purge_checkpoints where id = $1", [
    id,
  ]);
  const attempts = result.rows[0]?.attempts ?? options.maxAttempts;
  const terminal = attempts >= options.maxAttempts;
  const delay = Math.min(86_400, options.retryBaseSeconds * 2 ** Math.max(0, attempts - 1));
  await client.query(
    `update data_purge_checkpoints
        set status = $2::purge_checkpoint_status,
            retry_at = case when $2 = 'retry_wait' then now() + ($3::int * interval '1 second') else null end,
            claim_token = null, claimed_at = null, heartbeat_at = null,
            last_error_code = 'PURGE_DOMAIN_FAILED', last_error_summary = 'Domain progress retained for trusted retry',
            updated_at = now()
      where id = $1 and status <> 'verified'`,
    [id, terminal ? "failed" : "retry_wait", delay],
  );
}

async function runDomain(
  client: PoolClient,
  requestId: string,
  domain: OrganizationPurgeDomain,
  options: OrganizationPurgeOptions,
  operation: () => Promise<{ discovered: number; completed: number }>,
) {
  const state = await checkpoint(client, requestId, domain);
  if (state.status === "verified") return;
  await beginCheckpoint(client, state.id);
  try {
    const counts = await operation();
    await finishCheckpoint(client, state.id, counts.discovered, counts.completed);
  } catch (error) {
    await failCheckpoint(client, state.id, options);
    throw error;
  }
}

async function purgeAttachments(
  client: PoolClient,
  request: ClaimedOrganizationRequest,
  storage: OrganizationPurgeStorage,
  options: OrganizationPurgeOptions,
) {
  let discoveredOriginals = 0;
  let discoveredPreviews = 0;
  while (true) {
    const rows = await client.query<{ id: string; url: string; preview_reference: string | null }>(
      `select id, url, preview_reference from attachments
        where organization_id = $1 order by id limit $2`,
      [request.organization_id, options.batchSize],
    );
    if (!rows.rowCount) break;
    for (const row of rows.rows) {
      const original = await insertItem(client, request.id, "attachments", "object_key", {
        attachmentId: row.id,
        reference: row.url,
      });
      await processItem(
        client,
        original.id,
        options,
        () => storage.deleteReference(row.url),
        async () => !(await storage.referenceExists(row.url)),
      );
      discoveredOriginals += 1;
      if (row.preview_reference) {
        const preview = await insertItem(client, request.id, "attachment_previews", "object_key", {
          attachmentId: row.id,
          reference: row.preview_reference,
        });
        await processItem(
          client,
          preview.id,
          options,
          () => storage.deleteReference(row.preview_reference!),
          async () => !(await storage.referenceExists(row.preview_reference!)),
        );
        discoveredPreviews += 1;
      }
      await client.query("delete from attachments where id = $1 and organization_id = $2", [
        row.id,
        request.organization_id,
      ]);
    }
  }
  return { discoveredOriginals, discoveredPreviews };
}

async function runAttachmentDomains(
  client: PoolClient,
  request: ClaimedOrganizationRequest,
  storage: OrganizationPurgeStorage,
  options: OrganizationPurgeOptions,
) {
  const originalCheckpoint = await checkpoint(client, request.id, "attachments");
  const previewCheckpoint = await checkpoint(client, request.id, "attachment_previews");
  if (originalCheckpoint.status === "verified" && previewCheckpoint.status === "verified") return;
  if (originalCheckpoint.status !== "verified") await beginCheckpoint(client, originalCheckpoint.id);
  if (previewCheckpoint.status !== "verified") await beginCheckpoint(client, previewCheckpoint.id);
  try {
    await purgeAttachments(client, request, storage, options);
    const counts = await client.query<{ domain: "attachments" | "attachment_previews"; count: number }>(
      `select domain, count(*)::int as count from data_purge_items
        where organization_request_id = $1 and domain in ('attachments', 'attachment_previews')
        group by domain`,
      [request.id],
    );
    const byDomain = new Map(counts.rows.map((row) => [row.domain, row.count]));
    if (originalCheckpoint.status !== "verified") {
      const count = byDomain.get("attachments") ?? 0;
      await finishCheckpoint(client, originalCheckpoint.id, count, count);
    }
    if (previewCheckpoint.status !== "verified") {
      const count = byDomain.get("attachment_previews") ?? 0;
      await finishCheckpoint(client, previewCheckpoint.id, count, count);
    }
  } catch (error) {
    if (originalCheckpoint.status !== "verified") await failCheckpoint(client, originalCheckpoint.id, options);
    if (previewCheckpoint.status !== "verified") await failCheckpoint(client, previewCheckpoint.id, options);
    throw error;
  }
}

async function purgeExports(
  client: PoolClient,
  request: ClaimedOrganizationRequest,
  storage: OrganizationPurgeStorage,
  options: OrganizationPurgeOptions,
) {
  let count = 0;
  while (true) {
    const rows = await client.query<{ id: string; object_key: string | null }>(
      "select id, object_key from export_jobs where organization_id = $1 order by id limit $2",
      [request.organization_id, options.batchSize],
    );
    if (!rows.rowCount) break;
    for (const row of rows.rows) {
      if (row.object_key) {
        const item = await insertItem(client, request.id, "exports", "object_key", {
          exportJobId: row.id,
          key: row.object_key,
        });
        await processItem(
          client,
          item.id,
          options,
          () => storage.deleteObject(row.object_key!),
          async () => !(await storage.objectExists(row.object_key!)),
        );
      }
      await client.query("delete from export_jobs where id = $1 and organization_id = $2", [
        row.id,
        request.organization_id,
      ]);
      count += 1;
    }
  }
  return count;
}

async function deleteKeysetTable(
  client: PoolClient,
  table: DirectlyDeletedTable,
  organizationId: string,
  batchSize: number,
) {
  // Identifiers originate solely from the closed compile-time allowlist above.
  const key = table === "task_serial_sequences" ? "organization_id" : "id";
  let deleted = 0;
  let cursor: string | null = null;
  while (true) {
    const result: QueryResult<{ key: string }> = await client.query<{ key: string }>(
      `with batch as (
         select ${key} as key from ${table}
          where organization_id = $1 and ($2::text is null or ${key}::text > $2)
          order by ${key} limit $3
       ), removed as (
         delete from ${table} target using batch
          where target.${key} = batch.key
          returning target.${key}::text as key
       ) select key from removed order by key`,
      [organizationId, cursor, batchSize],
    );
    if (!result.rowCount) break;
    deleted += result.rowCount;
    cursor = result.rows.at(-1)!.key;
  }
  return deleted;
}

async function purgeDocuments(client: PoolClient, organizationId: string, batchSize: number) {
  let deleted = 0;
  for (const table of ["doc_versions", "document_permissions"] as const) {
    deleted += await deleteKeysetTable(client, table, organizationId, batchSize);
  }
  while (true) {
    const result = await client.query(
      `with leaves as (
         select document.id from docs document
          where document.organization_id = $1
            and not exists (select 1 from docs child where child.parent_id = document.id)
          order by document.id limit $2
       ) delete from docs document using leaves where document.id = leaves.id`,
      [organizationId, batchSize],
    );
    if (!result.rowCount) break;
    deleted += result.rowCount;
  }
  return deleted;
}

async function purgeSimpleTables(
  client: PoolClient,
  organizationId: string,
  batchSize: number,
  tables: readonly DirectlyDeletedTable[],
) {
  let deleted = 0;
  for (const table of tables) deleted += await deleteKeysetTable(client, table, organizationId, batchSize);
  return deleted;
}

async function purgeIntegrations(
  client: PoolClient,
  request: ClaimedOrganizationRequest,
  providers: OrganizationPurgeProviders,
  policy: OrganizationPurgePolicy,
  options: OrganizationPurgeOptions,
) {
  const mode = requireProviderPurge(policy, "integration_oauth");
  let count = 0;
  while (true) {
    const rows = await client.query<IntegrationResource>(
      `select id, organization_id, workspace_id, provider, credential_key, auth_type,
              encrypted_payload, initialization_vector, authentication_tag, encryption_algorithm,
              encryption_key_version, secret_fingerprint, external_account_id
         from integration_credentials where organization_id = $1 order by id limit $2`,
      [request.organization_id, options.batchSize],
    );
    if (!rows.rowCount) break;
    for (const row of rows.rows) {
      if (mode === "EXTERNAL_REVOCATION") {
        const item = await insertItem(client, request.id, "integration_oauth", "provider_resource", {
          credentialId: row.id,
          provider: row.provider,
          externalAccountId: row.external_account_id,
        });
        await processItem(
          client,
          item.id,
          options,
          () => providers.revokeIntegration(row),
          async () => true,
        );
      }
      await client.query("delete from integration_credentials where id = $1 and organization_id = $2", [
        row.id,
        request.organization_id,
      ]);
      count += 1;
    }
  }
  return count;
}

async function purgeBilling(
  client: PoolClient,
  request: ClaimedOrganizationRequest,
  providers: OrganizationPurgeProviders,
  policy: OrganizationPurgePolicy,
  options: OrganizationPurgeOptions,
) {
  const mode = requireProviderPurge(policy, "billing_provider");
  let count = 0;
  while (true) {
    const rows = await client.query<BillingResource>(
      `select id, provider, provider_customer_id, provider_subscription_id
         from subscriptions where organization_id = $1 order by id limit $2`,
      [request.organization_id, options.batchSize],
    );
    if (!rows.rowCount) break;
    for (const row of rows.rows) {
      if (mode === "EXTERNAL_REVOCATION" && row.provider !== "internal") {
        const item = await insertItem(client, request.id, "billing_provider", "provider_resource", {
          subscriptionId: row.id,
          provider: row.provider,
          providerSubscriptionId: row.provider_subscription_id,
        });
        await processItem(
          client,
          item.id,
          options,
          () => providers.revokeBilling(row),
          async () => true,
        );
      }
      await client.query("delete from invoices where organization_id = $1", [request.organization_id]);
      await client.query("delete from subscriptions where id = $1 and organization_id = $2", [
        row.id,
        request.organization_id,
      ]);
      count += 1;
    }
  }
  return count;
}

async function assertZero(client: PoolClient, table: string, organizationId: string) {
  if (
    ![
      ...relationalTables,
      "attachments",
      "docs",
      "doc_versions",
      "document_permissions",
      "export_jobs",
      "report_schedules",
      "report_schedule_recipients",
      "integration_credentials",
      "subscriptions",
      "invoices",
    ].includes(table as never)
  ) {
    throw new Error("UNSAFE_PURGE_TABLE");
  }
  const result = await client.query<{ count: number }>(
    `select count(*)::int as count from ${table} where organization_id = $1`,
    [organizationId],
  );
  if (result.rows[0]?.count !== 0) throw new Error(`VERIFY_${table.toUpperCase()}_REMAINING`);
}

async function finalOrganizationVerification(
  client: PoolClient,
  request: ClaimedOrganizationRequest,
  finalCheckpointMayBeProcessing = false,
) {
  for (const table of [
    ...relationalTables,
    "attachments",
    "docs",
    "doc_versions",
    "document_permissions",
    "export_jobs",
    "report_schedules",
    "report_schedule_recipients",
    "integration_credentials",
    "subscriptions",
    "invoices",
  ]) {
    await assertZero(client, table, request.organization_id);
  }
  const state = await client.query<{
    verified: number;
    incomplete: number;
    final_processing: number;
    children: number;
    active_claims: number;
  }>(
    `select
       (select count(*)::int from data_purge_checkpoints where organization_request_id = $1 and status = 'verified') as verified,
       (select count(*)::int from data_purge_checkpoints where organization_request_id = $1 and status <> 'verified') as incomplete,
       (select count(*)::int from data_purge_checkpoints
         where organization_request_id = $1 and domain = 'final_verification' and status = 'processing') as final_processing,
       (select count(*)::int from data_purge_items where organization_request_id = $1 and status <> 'verified') as children,
       ((select count(*) from data_purge_checkpoints where organization_request_id = $1 and claim_token is not null)
        + (select count(*) from data_purge_items where organization_request_id = $1 and claim_token is not null))::int as active_claims`,
    [request.id],
  );
  const row = state.rows[0];
  const expectedVerified = requiredDomains.length - (finalCheckpointMayBeProcessing ? 1 : 0);
  const expectedIncomplete = finalCheckpointMayBeProcessing ? 1 : 0;
  const allowedActiveClaims = finalCheckpointMayBeProcessing ? 1 : 0;
  if (
    row?.verified !== expectedVerified ||
    row.incomplete !== expectedIncomplete ||
    row.final_processing !== (finalCheckpointMayBeProcessing ? 1 : 0) ||
    row.children !== 0 ||
    row.active_claims !== allowedActiveClaims
  ) {
    throw new Error("ORGANIZATION_DOMAINS_NOT_VERIFIED");
  }
}

export async function claimOrganizationDeletion(
  client: PoolClient,
  options: OrganizationPurgeOptions,
  policy = readOrganizationPurgePolicy(),
): Promise<ClaimedOrganizationRequest | null> {
  if (!policy.enabled) return null;
  const claimToken = randomUUID();
  await client.query("begin");
  try {
    const selected = await client.query<{ id: string; organization_id: string }>(
      `select request.id, request.organization_id
         from organization_deletion_requests request
        where ((request.status = 'scheduled' and request.scheduled_for <= now())
            or (request.status = 'retry_wait' and request.retry_at <= now())
            or (request.status = 'processing' and request.heartbeat_at < now() - ($1::int * interval '1 minute')))
        order by coalesce(request.retry_at, request.scheduled_for, request.heartbeat_at), request.created_at
        for update skip locked limit 1`,
      [options.claimTimeoutMinutes],
    );
    const selectedRequest = selected.rows[0];
    if (!selectedRequest) {
      await client.query("commit");
      return null;
    }
    const now = new Date();
    const organization = await client.query(
      `update organizations
          set lifecycle_state = 'write_frozen', write_frozen_at = coalesce(write_frozen_at, $2), updated_at = $2
        where id = $1 and lifecycle_state in ('deletion_pending', 'write_frozen') returning id`,
      [selectedRequest.organization_id, now],
    );
    if (!organization.rowCount) throw new Error("ORGANIZATION_NOT_DELETION_PENDING");
    const claimed = await client.query<ClaimedOrganizationRequest>(
      `update organization_deletion_requests
          set status = 'processing', processing_started_at = coalesce(processing_started_at, $2),
              retry_at = null, claim_token = $3, claimed_at = $2, heartbeat_at = $2,
              attempts = attempts + 1, updated_at = $2
        where id = $1 returning id, organization_id, claim_token, attempts`,
      [selectedRequest.id, now, claimToken],
    );
    for (const domain of requiredDomains) {
      await client.query(
        `insert into data_purge_checkpoints (organization_request_id, domain, partition_key, batch_size)
         values ($1, $2::purge_domain, 'default', $3)
         on conflict (organization_request_id, domain, partition_key)
           where organization_request_id is not null do nothing`,
        [selectedRequest.id, domain, options.batchSize],
      );
    }
    await client.query("commit");
    return claimed.rows[0] ?? null;
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

export async function processOrganizationRequest(
  pool: Pool,
  request: ClaimedOrganizationRequest,
  storage: OrganizationPurgeStorage,
  providers: OrganizationPurgeProviders,
  policy: OrganizationPurgePolicy,
  options: OrganizationPurgeOptions,
) {
  const client = await pool.connect();
  try {
    requireLocalPurge(policy, "attachments");
    requireLocalPurge(policy, "attachment_previews");
    await runAttachmentDomains(client, request, storage, options);

    requireLocalPurge(policy, "exports");
    await runDomain(client, request.id, "exports", options, async () => {
      const count = await purgeExports(client, request, storage, options);
      return { discovered: count, completed: count };
    });
    requireLocalPurge(policy, "documents");
    await runDomain(client, request.id, "documents", options, async () => {
      const count = await purgeDocuments(client, request.organization_id, options.batchSize);
      return { discovered: count, completed: count };
    });
    requireLocalPurge(policy, "reports");
    await runDomain(client, request.id, "reports", options, async () => {
      const count = await purgeSimpleTables(client, request.organization_id, options.batchSize, [
        "report_schedule_recipients",
        "report_schedules",
      ]);
      return { discovered: count, completed: count };
    });
    await runDomain(client, request.id, "integration_oauth", options, async () => {
      const count = await purgeIntegrations(client, request, providers, policy, options);
      return { discovered: count, completed: count };
    });
    await runDomain(client, request.id, "billing_provider", options, async () => {
      const count = await purgeBilling(client, request, providers, policy, options);
      return { discovered: count, completed: count };
    });
    requireLocalPurge(policy, "organization_relational");
    await runDomain(client, request.id, "organization_relational", options, async () => {
      const count = await purgeSimpleTables(client, request.organization_id, options.batchSize, relationalTables);
      return { discovered: count, completed: count };
    });
    requireLocalPurge(policy, "final_verification");
    await runDomain(client, request.id, "final_verification", options, async () => {
      await finalOrganizationVerification(client, request, true);
      return { discovered: 0, completed: 0 };
    });

    // Repeat discovery/verification after all handlers and close only under one lock.
    await client.query("begin");
    try {
      const locked = await client.query<{ status: string; claim_token: string; lifecycle_state: string }>(
        `select request.status, request.claim_token, organization.lifecycle_state
           from organization_deletion_requests request
           join organizations organization on organization.id = request.organization_id
          where request.id = $1 for update of request, organization`,
        [request.id],
      );
      if (locked.rows[0]?.status !== "processing" || locked.rows[0]?.claim_token !== request.claim_token) {
        throw new Error("ORGANIZATION_CLAIM_LOST");
      }
      if (locked.rows[0]?.lifecycle_state !== "write_frozen") throw new Error("ORGANIZATION_NOT_WRITE_FROZEN");
      await finalOrganizationVerification(client, request);
      const now = new Date();
      await client.query(
        `insert into data_deletion_receipts
          (subject_type, outcome, schema_version, verification_version, domain_summary, completed_at)
         values ('organization', 'purged', 1, 'organization-v1', $1::jsonb, $2)`,
        [JSON.stringify(Object.fromEntries(requiredDomains.map((domain) => [domain, 1]))), now],
      );
      await client.query("delete from organizations where id = $1 and lifecycle_state = 'write_frozen'", [
        request.organization_id,
      ]);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  } finally {
    client.release();
  }
}

export async function failOrRetryOrganization(
  pool: Pool,
  request: ClaimedOrganizationRequest,
  options: OrganizationPurgeOptions,
  error: unknown,
) {
  const terminal = request.attempts >= options.maxAttempts;
  const delay = Math.min(86_400, options.retryBaseSeconds * 2 ** Math.max(0, request.attempts - 1));
  const raw = error instanceof Error ? error.message : "ORGANIZATION_PURGE_FAILED";
  const code = /^[A-Z0-9_]{3,64}$/.test(raw) ? raw : "ORGANIZATION_PURGE_FAILED";
  await pool.query(
    `update organization_deletion_requests
        set status = $3::deletion_request_status,
            retry_at = case when $3 = 'retry_wait' then now() + ($4::int * interval '1 second') else null end,
            failed_at = now(), claim_token = null, claimed_at = null, heartbeat_at = null,
            last_error_code = $5, last_error_summary = 'Organization purge did not complete; progress was retained',
            updated_at = now()
      where id = $1 and claim_token = $2 and status = 'processing'`,
    [request.id, request.claim_token, terminal ? "failed" : "retry_wait", delay, code],
  );
}
