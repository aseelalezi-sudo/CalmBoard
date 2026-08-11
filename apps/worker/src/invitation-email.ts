import {
  decryptInvitationEmailPayload,
  type InvitationEmailEncryptionEnvelope,
  type InvitationEmailIdentity,
  type InvitationEmailPayload,
} from "@calmboard/notifications";
import type { Pool, PoolClient } from "pg";

export const invitationEmailJobName = "invitations.deliver-email";

export type InvitationEmailOptions = { batchSize: number; claimTimeoutMinutes: number };
export type InvitationEmailCandidate = InvitationEmailIdentity &
  InvitationEmailEncryptionEnvelope & {
    attempt: number;
    maxAttempts: number;
    claimToken: string;
    recipientEmail: string;
  };
export type InvitationEmailTransport = {
  send(candidate: InvitationEmailCandidate, payload: InvitationEmailPayload): Promise<{ providerMessageId: string }>;
};

export function readInvitationEmailOptions(env: NodeJS.ProcessEnv = process.env): InvitationEmailOptions {
  const readInteger = (name: string, fallback: number, minimum: number, maximum: number) => {
    const value = env[name] === undefined ? fallback : Number(env[name]);
    if (!Number.isInteger(value) || value < minimum || value > maximum) {
      throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
    }
    return value;
  };
  return {
    batchSize: readInteger("INVITATION_EMAIL_BATCH_SIZE", 25, 1, 250),
    claimTimeoutMinutes: readInteger("INVITATION_EMAIL_CLAIM_TIMEOUT_MINUTES", 15, 1, 1440),
  };
}

export async function claimInvitationEmailBatch(client: PoolClient, options: InvitationEmailOptions) {
  await client.query("begin");
  try {
    const result = await client.query<{
      id: string;
      organization_id: string;
      workspace_id: string | null;
      invitation_id: string;
      token_version: number;
      recipient_email: string;
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
         from invitation_email_outbox outbox
         where outbox.attempts < outbox.max_attempts
           and outbox.available_at <= now()
           and outbox.encrypted_payload is not null
           and (
             outbox.status = 'pending'
             or (outbox.status = 'processing' and outbox.claimed_at < now() - make_interval(mins => $1))
           )
         order by outbox.available_at, outbox.created_at, outbox.id
         for update skip locked
         limit $2
       )
       update invitation_email_outbox outbox
       set status = 'processing', attempts = outbox.attempts + 1, claimed_at = now(),
           claim_token = gen_random_uuid(), last_error = null, updated_at = now()
       from candidates
       where outbox.id = candidates.id
       returning outbox.*`,
      [options.claimTimeoutMinutes, options.batchSize],
    );
    await client.query("commit");
    return result.rows.map((row): InvitationEmailCandidate => ({
      id: row.id,
      organizationId: row.organization_id,
      workspaceId: row.workspace_id,
      invitationId: row.invitation_id,
      tokenVersion: row.token_version,
      recipientEmail: row.recipient_email,
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

async function invitationCanReceiveEmail(client: PoolClient, candidate: InvitationEmailCandidate) {
  const result = await client.query<{ valid: boolean }>(
    `select exists (
       select 1 from invitations invitation
       where invitation.id = $1
         and invitation.organization_id = $2
         and invitation.workspace_id is not distinct from $3::uuid
         and invitation.token_version = $4
         and invitation.status = 'pending'
         and invitation.expires_at > now()
         and lower(invitation.email) = lower($5)
     ) as valid`,
    [
      candidate.invitationId,
      candidate.organizationId,
      candidate.workspaceId,
      candidate.tokenVersion,
      candidate.recipientEmail,
    ],
  );
  return result.rows[0]?.valid === true;
}

async function markSent(client: PoolClient, candidate: InvitationEmailCandidate, providerMessageId: string) {
  await client.query(
    `update invitation_email_outbox
     set status = 'sent', sent_at = now(), provider_message_id = $3,
         encrypted_payload = null, initialization_vector = null, authentication_tag = null,
         claimed_at = null, claim_token = null, last_error = null, updated_at = now()
     where id = $1 and status = 'processing' and claim_token = $2`,
    [candidate.id, candidate.claimToken, providerMessageId.slice(0, 255)],
  );
}

async function markSkipped(client: PoolClient, candidate: InvitationEmailCandidate, reason: string) {
  await client.query(
    `update invitation_email_outbox
     set status = 'skipped', encrypted_payload = null, initialization_vector = null, authentication_tag = null,
         claimed_at = null, claim_token = null, last_error = $3, updated_at = now()
     where id = $1 and status = 'processing' and claim_token = $2`,
    [candidate.id, candidate.claimToken, reason.slice(0, 2000)],
  );
}

async function releaseFailed(client: PoolClient, candidate: InvitationEmailCandidate, error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown invitation email error";
  const backoffSeconds = Math.min(3600, 5 * 2 ** Math.max(candidate.attempt - 1, 0));
  await client.query(
    `update invitation_email_outbox
     set status = case when attempts >= max_attempts then 'dead'::notification_email_status else 'pending'::notification_email_status end,
         available_at = case when attempts >= max_attempts then available_at else now() + make_interval(secs => $3) end,
         claimed_at = null, claim_token = null, last_error = $4, updated_at = now()
     where id = $1 and status = 'processing' and claim_token = $2`,
    [candidate.id, candidate.claimToken, backoffSeconds, message.slice(0, 2000)],
  );
}

export function createResendInvitationEmailTransport(
  env: NodeJS.ProcessEnv = process.env,
  request: typeof fetch = fetch,
): InvitationEmailTransport {
  const apiKey = env.RESEND_API_KEY;
  const from = env.RESEND_FROM_EMAIL ?? "CalmBoard Invitations <invitations@calmboard.com>";
  return {
    async send(candidate, payload) {
      if (!apiKey?.startsWith("re_")) throw new Error("RESEND_API_KEY is required by the invitation email worker");
      const response = await request("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": `calmboard-invitation-email/${candidate.id}`,
        },
        body: JSON.stringify({ from, to: payload.to, subject: payload.subject, html: payload.html }),
      });
      if (!response.ok) throw new Error(`Resend invitation email returned ${response.status}`);
      const result = (await response.json()) as { id?: unknown };
      if (typeof result.id !== "string" || !result.id) {
        throw new Error("Resend invitation email response did not include an id");
      }
      return { providerMessageId: result.id };
    },
  };
}

export async function deliverInvitationEmails(
  pool: Pool,
  transport: InvitationEmailTransport,
  env: NodeJS.ProcessEnv = process.env,
  options: InvitationEmailOptions = readInvitationEmailOptions(env),
) {
  const client = await pool.connect();
  try {
    const candidates = await claimInvitationEmailBatch(client, options);
    let sent = 0;
    let skipped = 0;
    let failed = 0;
    for (const candidate of candidates) {
      try {
        if (!(await invitationCanReceiveEmail(client, candidate))) {
          await markSkipped(client, candidate, "Invitation token generation is stale, terminal, or expired");
          skipped += 1;
          continue;
        }
        const payload = decryptInvitationEmailPayload(candidate, candidate, env);
        if (payload.to.toLowerCase() !== candidate.recipientEmail.toLowerCase()) {
          await markSkipped(client, candidate, "Invitation recipient no longer matches the encrypted payload");
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
