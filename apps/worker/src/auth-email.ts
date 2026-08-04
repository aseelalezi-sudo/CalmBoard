import {
  decryptAuthEmailPayload,
  type AuthEmailEncryptionEnvelope,
  type AuthEmailIdentity,
  type AuthEmailPayload,
  type AuthEmailPurpose,
} from "@calmboard/notifications";
import type { Pool, PoolClient } from "pg";

export const authEmailJobName = "auth.deliver-email";

export type AuthEmailOptions = {
  batchSize: number;
  claimTimeoutMinutes: number;
};

export type AuthEmailCandidate = AuthEmailIdentity &
  AuthEmailEncryptionEnvelope & {
    attempt: number;
    maxAttempts: number;
    claimToken: string;
  };

export type AuthEmailTransport = {
  send(candidate: AuthEmailCandidate, payload: AuthEmailPayload): Promise<{ providerMessageId: string }>;
};

export function readAuthEmailOptions(env: NodeJS.ProcessEnv = process.env): AuthEmailOptions {
  const readInteger = (name: string, fallback: number, minimum: number, maximum: number) => {
    const value = env[name] === undefined ? fallback : Number(env[name]);
    if (!Number.isInteger(value) || value < minimum || value > maximum) {
      throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
    }
    return value;
  };
  return {
    batchSize: readInteger("AUTH_EMAIL_BATCH_SIZE", 25, 1, 250),
    claimTimeoutMinutes: readInteger("AUTH_EMAIL_CLAIM_TIMEOUT_MINUTES", 15, 1, 1440),
  };
}

export async function claimAuthEmailBatch(
  client: PoolClient,
  options: AuthEmailOptions,
): Promise<AuthEmailCandidate[]> {
  await client.query("begin");
  try {
    const result = await client.query<{
      id: string;
      user_id: string;
      auth_token_id: string;
      purpose: AuthEmailPurpose;
      encrypted_payload: string;
      initialization_vector: string;
      authentication_tag: string;
      encryption_algorithm: "aes-256-gcm";
      encryption_key_version: number;
      attempts: number;
      max_attempts: number;
      claim_token: string;
    }>(
      `with candidates as (
         select outbox.id
         from auth_email_outbox outbox
         where outbox.attempts < outbox.max_attempts
           and outbox.available_at <= now()
           and (
             outbox.status = 'pending'
             or (
               outbox.status = 'processing'
               and outbox.claimed_at < now() - make_interval(mins => $1)
             )
           )
         order by outbox.available_at, outbox.created_at, outbox.id
         for update skip locked
         limit $2
       )
       update auth_email_outbox outbox
       set status = 'processing',
           attempts = outbox.attempts + 1,
           claimed_at = now(),
           claim_token = gen_random_uuid(),
           last_error = null,
           updated_at = now()
       from candidates
       where outbox.id = candidates.id
       returning
         outbox.id,
         outbox.user_id,
         outbox.auth_token_id,
         outbox.purpose,
         outbox.encrypted_payload,
         outbox.initialization_vector,
         outbox.authentication_tag,
         outbox.encryption_algorithm,
         outbox.encryption_key_version,
         outbox.attempts,
         outbox.max_attempts,
         outbox.claim_token`,
      [options.claimTimeoutMinutes, options.batchSize],
    );
    await client.query("commit");
    return result.rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      authTokenId: row.auth_token_id,
      purpose: row.purpose,
      encryptedPayload: row.encrypted_payload,
      initializationVector: row.initialization_vector,
      authenticationTag: row.authentication_tag,
      encryptionAlgorithm: row.encryption_algorithm,
      encryptionKeyVersion: row.encryption_key_version,
      attempt: row.attempts,
      maxAttempts: row.max_attempts,
      claimToken: row.claim_token,
    }));
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

async function tokenCanReceiveEmail(client: PoolClient, candidate: AuthEmailCandidate, recipientEmail: string) {
  const result = await client.query<{ valid: boolean }>(
    `select exists (
       select 1
       from auth_tokens token
       join users app_user on app_user.id = token.user_id
       where token.id = $1
         and token.user_id = $2
         and token.purpose = $3
         and token.consumed_at is null
         and token.invalidated_at is null
         and token.expires_at > now()
         and lower(app_user.email) = lower($4)
     ) as valid`,
    [candidate.authTokenId, candidate.userId, candidate.purpose, recipientEmail],
  );
  return result.rows[0]?.valid === true;
}

async function markSent(client: PoolClient, candidate: AuthEmailCandidate, providerMessageId: string) {
  await client.query(
    `update auth_email_outbox
     set status = 'sent',
         sent_at = now(),
         provider_message_id = $3,
         claimed_at = null,
         claim_token = null,
         last_error = null,
         updated_at = now()
     where id = $1 and status = 'processing' and claim_token = $2`,
    [candidate.id, candidate.claimToken, providerMessageId.slice(0, 255)],
  );
}

async function markSkipped(client: PoolClient, candidate: AuthEmailCandidate, reason: string) {
  await client.query(
    `update auth_email_outbox
     set status = 'skipped',
         claimed_at = null,
         claim_token = null,
         last_error = $3,
         updated_at = now()
     where id = $1 and status = 'processing' and claim_token = $2`,
    [candidate.id, candidate.claimToken, reason.slice(0, 2000)],
  );
}

async function releaseFailed(client: PoolClient, candidate: AuthEmailCandidate, error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown authentication email error";
  const backoffSeconds = Math.min(3600, 5 * 2 ** Math.max(candidate.attempt - 1, 0));
  await client.query(
    `update auth_email_outbox
     set status = case when attempts >= max_attempts then 'dead'::notification_email_status else 'pending'::notification_email_status end,
         available_at = case when attempts >= max_attempts then available_at else now() + make_interval(secs => $3) end,
         claimed_at = null,
         claim_token = null,
         last_error = $4,
         updated_at = now()
     where id = $1 and status = 'processing' and claim_token = $2`,
    [candidate.id, candidate.claimToken, backoffSeconds, message.slice(0, 2000)],
  );
}

export function createResendAuthEmailTransport(
  env: NodeJS.ProcessEnv = process.env,
  request: typeof fetch = fetch,
): AuthEmailTransport {
  const apiKey = env.RESEND_API_KEY;
  const from = env.RESEND_FROM_EMAIL ?? "CalmBoard Security <security@calmboard.com>";
  return {
    async send(candidate, payload) {
      if (!apiKey?.startsWith("re_")) throw new Error("RESEND_API_KEY is required by the auth email worker");
      const response = await request("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": `calmboard-auth-email/${candidate.id}`,
        },
        body: JSON.stringify({
          from,
          to: payload.to,
          subject: payload.subject,
          html: payload.html,
        }),
      });
      if (!response.ok) throw new Error(`Resend authentication email returned ${response.status}`);
      const responsePayload = (await response.json()) as { id?: unknown };
      if (typeof responsePayload.id !== "string" || !responsePayload.id) {
        throw new Error("Resend authentication email response did not include an id");
      }
      return { providerMessageId: responsePayload.id };
    },
  };
}

export async function deliverAuthEmails(
  pool: Pool,
  transport: AuthEmailTransport,
  env: NodeJS.ProcessEnv = process.env,
  options: AuthEmailOptions = readAuthEmailOptions(env),
) {
  const client = await pool.connect();
  try {
    const candidates = await claimAuthEmailBatch(client, options);
    let sent = 0;
    let skipped = 0;
    let failed = 0;
    for (const candidate of candidates) {
      try {
        const payload = decryptAuthEmailPayload(candidate, candidate, env);
        if (!(await tokenCanReceiveEmail(client, candidate, payload.to))) {
          await markSkipped(client, candidate, "Authentication token or recipient is no longer valid");
          skipped += 1;
          continue;
        }
        const delivery = await transport.send(candidate, payload);
        await markSent(client, candidate, delivery.providerMessageId);
        sent += 1;
      } catch (error) {
        await releaseFailed(client, candidate, error);
        failed += 1;
      }
    }
    return { claimed: candidates.length, sent, skipped, failed };
  } finally {
    client.release();
  }
}
