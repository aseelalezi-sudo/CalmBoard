import type { Pool, PoolClient } from "pg";

export const notificationEmailJobName = "notifications.deliver-email";

export type NotificationEmailOptions = {
  batchSize: number;
  claimTimeoutMinutes: number;
};

export type NotificationEmailCandidate = {
  id: string;
  organizationId: string;
  workspaceId: string;
  userId: string;
  subject: string;
  body: string | null;
  attempt: number;
  maxAttempts: number;
  claimToken: string;
  attachmentObjectKey: string | null;
  attachmentFileName: string | null;
  attachmentContentType: string | null;
  attachmentContentBase64?: string;
};

type EmailRecipient = {
  email: string;
  emailEnabled: boolean;
};

export type NotificationEmailTransport = {
  send(candidate: NotificationEmailCandidate, recipient: EmailRecipient): Promise<{ providerMessageId: string }>;
};

export type NotificationAttachmentStorage = {
  getObject(key: string): Promise<Uint8Array>;
};

export function readNotificationEmailOptions(env: NodeJS.ProcessEnv = process.env): NotificationEmailOptions {
  const readInteger = (name: string, fallback: number, minimum: number, maximum: number) => {
    const value = env[name] === undefined ? fallback : Number(env[name]);
    if (!Number.isInteger(value) || value < minimum || value > maximum) {
      throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
    }
    return value;
  };
  return {
    batchSize: readInteger("NOTIFICATION_EMAIL_BATCH_SIZE", 50, 1, 500),
    claimTimeoutMinutes: readInteger("NOTIFICATION_EMAIL_CLAIM_TIMEOUT_MINUTES", 15, 1, 1440),
  };
}

export async function claimNotificationEmailBatch(
  client: PoolClient,
  options: NotificationEmailOptions,
): Promise<NotificationEmailCandidate[]> {
  await client.query("begin");
  try {
    const result = await client.query<{
      id: string;
      organization_id: string;
      workspace_id: string;
      user_id: string;
      subject: string;
      body: string | null;
      attempts: number;
      max_attempts: number;
      claim_token: string;
      attachment_object_key: string | null;
      attachment_file_name: string | null;
      attachment_content_type: string | null;
    }>(
      `with candidates as (
         select outbox.id
         from notification_email_outbox outbox
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
       update notification_email_outbox outbox
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
         outbox.organization_id,
         outbox.workspace_id,
         outbox.user_id,
         outbox.subject,
         outbox.body,
         outbox.attachment_object_key,
         outbox.attachment_file_name,
         outbox.attachment_content_type,
         outbox.attempts,
         outbox.max_attempts,
         outbox.claim_token`,
      [options.claimTimeoutMinutes, options.batchSize],
    );
    await client.query("commit");
    return result.rows.map((row) => ({
      id: row.id,
      organizationId: row.organization_id,
      workspaceId: row.workspace_id,
      userId: row.user_id,
      subject: row.subject,
      body: row.body,
      attempt: row.attempts,
      maxAttempts: row.max_attempts,
      claimToken: row.claim_token,
      attachmentObjectKey: row.attachment_object_key ?? null,
      attachmentFileName: row.attachment_file_name ?? null,
      attachmentContentType: row.attachment_content_type ?? null,
    }));
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

async function loadRecipient(
  client: PoolClient,
  candidate: NotificationEmailCandidate,
): Promise<EmailRecipient | null> {
  const result = await client.query<{ email: string; email_enabled: boolean | null }>(
    `select app_user.email, preference.email_enabled
     from users app_user
     left join notification_preferences preference on preference.user_id = app_user.id
     where app_user.id = $1
       and exists (
         select 1
         from memberships membership
         where membership.user_id = app_user.id
           and membership.organization_id = $2
           and (membership.workspace_id = $3 or membership.workspace_id is null)
           and membership.status = 'active'
       )
     limit 1`,
    [candidate.userId, candidate.organizationId, candidate.workspaceId],
  );
  const recipient = result.rows[0];
  if (!recipient?.email) return null;
  return { email: recipient.email, emailEnabled: recipient.email_enabled !== false };
}

async function markSent(client: PoolClient, candidate: NotificationEmailCandidate, providerMessageId: string) {
  await client.query(
    `update notification_email_outbox
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

async function markSkipped(client: PoolClient, candidate: NotificationEmailCandidate, reason: string) {
  await client.query(
    `update notification_email_outbox
     set status = 'skipped',
         claimed_at = null,
         claim_token = null,
         last_error = $3,
         updated_at = now()
     where id = $1 and status = 'processing' and claim_token = $2`,
    [candidate.id, candidate.claimToken, reason.slice(0, 2000)],
  );
}

async function releaseFailed(client: PoolClient, candidate: NotificationEmailCandidate, error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown notification email error";
  const backoffSeconds = Math.min(3600, 5 * 2 ** Math.max(candidate.attempt - 1, 0));
  await client.query(
    `update notification_email_outbox
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

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function createResendNotificationEmailTransport(
  env: NodeJS.ProcessEnv = process.env,
  request: typeof fetch = fetch,
): NotificationEmailTransport {
  const apiKey = env.RESEND_API_KEY;
  const from = env.RESEND_FROM_EMAIL ?? "CalmBoard Notifications <notifications@calmboard.com>";
  return {
    async send(candidate, recipient) {
      if (!apiKey?.startsWith("re_")) {
        throw new Error("RESEND_API_KEY is required by the notification email worker");
      }
      const response = await request("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": `calmboard-notification-email/${candidate.id}`,
        },
        body: JSON.stringify({
          from,
          to: recipient.email,
          subject: candidate.subject,
          html: `<div style="font-family:sans-serif;padding:20px"><h2>${escapeHtml(candidate.subject)}</h2><p>${escapeHtml(candidate.body ?? "")}</p></div>`,
          ...(candidate.attachmentContentBase64 && candidate.attachmentFileName
            ? {
                attachments: [
                  {
                    filename: candidate.attachmentFileName,
                    content: candidate.attachmentContentBase64,
                    content_type: candidate.attachmentContentType ?? undefined,
                  },
                ],
              }
            : {}),
        }),
      });
      if (!response.ok) throw new Error(`Resend notification email returned ${response.status}`);
      const payload = (await response.json()) as { id?: unknown };
      if (typeof payload.id !== "string" || !payload.id) {
        throw new Error("Resend notification email response did not include an id");
      }
      return { providerMessageId: payload.id };
    },
  };
}

export async function deliverNotificationEmails(
  pool: Pool,
  transport: NotificationEmailTransport,
  options: NotificationEmailOptions = readNotificationEmailOptions(),
  attachmentStorage?: NotificationAttachmentStorage,
) {
  const client = await pool.connect();
  try {
    const candidates = await claimNotificationEmailBatch(client, options);
    let sent = 0;
    let skipped = 0;
    let failed = 0;
    for (const candidate of candidates) {
      try {
        const recipient = await loadRecipient(client, candidate);
        if (!recipient) {
          await markSkipped(client, candidate, "Recipient is not an active workspace member");
          skipped += 1;
          continue;
        }
        if (!recipient.emailEnabled) {
          await markSkipped(client, candidate, "Recipient disabled notification emails");
          skipped += 1;
          continue;
        }
        let deliveryCandidate = candidate;
        if (candidate.attachmentObjectKey) {
          if (!attachmentStorage) throw new Error("Notification attachment storage is not configured");
          const attachment = await attachmentStorage.getObject(candidate.attachmentObjectKey);
          if (attachment.byteLength > 20 * 1024 * 1024) {
            throw new Error("Scheduled report attachment exceeds the 20 MB delivery limit");
          }
          deliveryCandidate = { ...candidate, attachmentContentBase64: Buffer.from(attachment).toString("base64") };
        }
        const delivery = await transport.send(deliveryCandidate, recipient);
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
