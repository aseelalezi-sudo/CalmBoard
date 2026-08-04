import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { Pool, type PoolClient } from "pg";
import {
  claimNotificationEmailBatch,
  createResendNotificationEmailTransport,
  deliverNotificationEmails,
  readNotificationEmailOptions,
  type NotificationEmailCandidate,
} from "./notification-email.js";

const candidate: NotificationEmailCandidate = {
  id: "outbox-1",
  organizationId: "organization-1",
  workspaceId: "workspace-1",
  userId: "user-1",
  subject: "Release <ready>",
  body: "Review & approve",
  attempt: 1,
  maxAttempts: 8,
  claimToken: "claim-1",
  attachmentObjectKey: null,
  attachmentFileName: null,
  attachmentContentType: null,
};

describe("notification email worker", () => {
  it("validates bounded polling options", () => {
    assert.deepEqual(
      readNotificationEmailOptions({
        NOTIFICATION_EMAIL_BATCH_SIZE: "25",
        NOTIFICATION_EMAIL_CLAIM_TIMEOUT_MINUTES: "10",
      }),
      { batchSize: 25, claimTimeoutMinutes: 10 },
    );
    assert.throws(() => readNotificationEmailOptions({ NOTIFICATION_EMAIL_BATCH_SIZE: "0" }), /between 1 and 500/);
  });

  it("claims a durable batch with skip-locked recovery", async () => {
    const statements: string[] = [];
    const client = {
      async query(statement: string) {
        statements.push(statement);
        return statement.startsWith("with candidates")
          ? {
              rows: [
                {
                  id: candidate.id,
                  organization_id: candidate.organizationId,
                  workspace_id: candidate.workspaceId,
                  user_id: candidate.userId,
                  subject: candidate.subject,
                  body: candidate.body,
                  attempts: candidate.attempt,
                  max_attempts: candidate.maxAttempts,
                  claim_token: candidate.claimToken,
                },
              ],
            }
          : { rows: [] };
      },
    } as unknown as PoolClient;

    assert.deepEqual(await claimNotificationEmailBatch(client, { batchSize: 50, claimTimeoutMinutes: 15 }), [
      candidate,
    ]);
    assert.equal(statements[0], "begin");
    assert.match(statements[1] ?? "", /for update skip locked/);
    assert.match(statements[1] ?? "", /status = 'processing'/);
    assert.equal(statements[2], "commit");
  });

  it("uses the outbox id as the provider idempotency key and escapes HTML", async () => {
    let request: { headers: Record<string, string>; body: string } | undefined;
    const transport = createResendNotificationEmailTransport(
      { RESEND_API_KEY: "re_test", RESEND_FROM_EMAIL: "CalmBoard <test@example.com>" },
      async (_url, init) => {
        request = { headers: init?.headers as Record<string, string>, body: String(init?.body) };
        return new Response(JSON.stringify({ id: "provider-1" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    );

    assert.deepEqual(
      await transport.send(
        {
          ...candidate,
          attachmentObjectKey: "exports/report.pdf",
          attachmentFileName: "report.pdf",
          attachmentContentType: "application/pdf",
          attachmentContentBase64: "JVBERg==",
        },
        { email: "member@example.com", emailEnabled: true },
      ),
      { providerMessageId: "provider-1" },
    );
    assert.equal(request?.headers["Idempotency-Key"], "calmboard-notification-email/outbox-1");
    const payload = JSON.parse(request?.body ?? "{}") as {
      html?: string;
      attachments?: Array<{ filename: string; content: string }>;
    };
    assert.match(payload.html ?? "", /Release &lt;ready&gt;/);
    assert.match(payload.html ?? "", /Review &amp; approve/);
    assert.deepEqual(payload.attachments, [
      { filename: "report.pdf", content: "JVBERg==", content_type: "application/pdf" },
    ]);
  });

  it("marks a delivered item sent after revalidating tenant membership", async () => {
    const statements: string[] = [];
    const client = {
      async query(statement: string) {
        statements.push(statement);
        if (statement.startsWith("with candidates")) {
          return {
            rows: [
              {
                id: candidate.id,
                organization_id: candidate.organizationId,
                workspace_id: candidate.workspaceId,
                user_id: candidate.userId,
                subject: candidate.subject,
                body: candidate.body,
                attempts: candidate.attempt,
                max_attempts: candidate.maxAttempts,
                claim_token: candidate.claimToken,
              },
            ],
          };
        }
        if (statement.startsWith("select app_user.email")) {
          return { rows: [{ email: "member@example.com", email_enabled: true }] };
        }
        return { rows: [] };
      },
      release() {},
    } as unknown as PoolClient;
    const pool = { connect: async () => client } as unknown as Pool;

    assert.deepEqual(
      await deliverNotificationEmails(
        pool,
        { send: async () => ({ providerMessageId: "provider-1" }) },
        { batchSize: 50, claimTimeoutMinutes: 15 },
      ),
      { claimed: 1, sent: 1, skipped: 0, failed: 0 },
    );
    assert.match(
      statements.find((statement) => statement.startsWith("select app_user.email")) ?? "",
      /membership.organization_id = \$2/,
    );
    assert.match(statements.at(-1) ?? "", /status = 'sent'/);
  });

  it("releases provider failures with exponential backoff instead of losing the item", async () => {
    const statements: string[] = [];
    const client = {
      async query(statement: string) {
        statements.push(statement);
        if (statement.startsWith("with candidates")) {
          return {
            rows: [
              {
                id: candidate.id,
                organization_id: candidate.organizationId,
                workspace_id: candidate.workspaceId,
                user_id: candidate.userId,
                subject: candidate.subject,
                body: candidate.body,
                attempts: candidate.attempt,
                max_attempts: candidate.maxAttempts,
                claim_token: candidate.claimToken,
              },
            ],
          };
        }
        if (statement.startsWith("select app_user.email")) {
          return { rows: [{ email: "member@example.com", email_enabled: true }] };
        }
        return { rows: [] };
      },
      release() {},
    } as unknown as PoolClient;
    const pool = { connect: async () => client } as unknown as Pool;

    const result = await deliverNotificationEmails(
      pool,
      { send: async () => Promise.reject(new Error("temporary provider failure")) },
      { batchSize: 50, claimTimeoutMinutes: 15 },
    );
    assert.deepEqual(result, { claimed: 1, sent: 0, skipped: 0, failed: 1 });
    assert.match(statements.at(-1) ?? "", /then 'dead'::notification_email_status else 'pending'/);
    assert.match(statements.at(-1) ?? "", /make_interval\(secs => \$3\)/);
  });

  it(
    "delivers an outbox email exactly once in PostgreSQL",
    { skip: !process.env.DATABASE_MAINTENANCE_URL },
    async () => {
      const pool = new Pool({ connectionString: process.env.DATABASE_MAINTENANCE_URL, max: 2 });
      const outboxId = randomUUID();
      const deliveredIds: string[] = [];
      try {
        const target = await pool.query<{
          organization_id: string;
          workspace_id: string;
          user_id: string;
        }>(
          `select workspace.organization_id, workspace.id as workspace_id, membership.user_id
           from workspaces workspace
           join memberships membership
             on membership.organization_id = workspace.organization_id
            and (membership.workspace_id = workspace.id or membership.workspace_id is null)
            and membership.status = 'active'
           order by workspace.created_at
           limit 1`,
        );
        assert.equal(target.rowCount, 1, "integration database must contain a workspace and active member");
        const scope = target.rows[0]!;
        await pool.query(
          `insert into notification_email_outbox (
             id, organization_id, workspace_id, user_id, subject, body, idempotency_key
           ) values ($1, $2, $3, $4, $5, $6, $7)`,
          [
            outboxId,
            scope.organization_id,
            scope.workspace_id,
            scope.user_id,
            "Worker email integration",
            "Exactly once delivery",
            `notification-email-test/${outboxId}`,
          ],
        );

        const transport = {
          async send(item: NotificationEmailCandidate) {
            deliveredIds.push(item.id);
            return { providerMessageId: `provider-${item.id}` };
          },
        };
        await deliverNotificationEmails(pool, transport, { batchSize: 50, claimTimeoutMinutes: 15 });
        await deliverNotificationEmails(pool, transport, { batchSize: 50, claimTimeoutMinutes: 15 });

        assert.equal(deliveredIds.filter((id) => id === outboxId).length, 1);
        const persisted = await pool.query<{
          status: string;
          attempts: number;
          provider_message_id: string | null;
        }>(
          `select status, attempts, provider_message_id
           from notification_email_outbox
           where id = $1`,
          [outboxId],
        );
        assert.deepEqual(persisted.rows, [
          {
            status: "sent",
            attempts: 1,
            provider_message_id: `provider-${outboxId}`,
          },
        ]);
      } finally {
        await pool.query("delete from notification_email_outbox where id = $1", [outboxId]);
        await pool.end();
      }
    },
  );
});
