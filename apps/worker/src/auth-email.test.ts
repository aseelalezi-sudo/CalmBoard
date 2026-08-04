import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { encryptAuthEmailPayload } from "@calmboard/notifications";
import { Pool, type PoolClient } from "pg";
import {
  claimAuthEmailBatch,
  createResendAuthEmailTransport,
  deliverAuthEmails,
  readAuthEmailOptions,
  type AuthEmailCandidate,
} from "./auth-email.js";

const encryptionEnv = {
  AUTH_EMAIL_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
};
const identity = {
  id: "outbox-1",
  userId: "user-1",
  authTokenId: "token-1",
  purpose: "password_reset" as const,
};
const payload = {
  to: "member@example.com",
  name: "Member",
  subject: "Reset your password",
  html: '<a href="https://example.com/reset?token=secret">Reset</a>',
};
const candidate: AuthEmailCandidate = {
  ...identity,
  ...encryptAuthEmailPayload(identity, payload, encryptionEnv),
  attempt: 1,
  maxAttempts: 8,
  claimToken: "claim-1",
};

function candidateRow() {
  return {
    id: candidate.id,
    user_id: candidate.userId,
    auth_token_id: candidate.authTokenId,
    purpose: candidate.purpose,
    encrypted_payload: candidate.encryptedPayload,
    initialization_vector: candidate.initializationVector,
    authentication_tag: candidate.authenticationTag,
    encryption_algorithm: candidate.encryptionAlgorithm,
    encryption_key_version: candidate.encryptionKeyVersion,
    attempts: candidate.attempt,
    max_attempts: candidate.maxAttempts,
    claim_token: candidate.claimToken,
  };
}

describe("authentication email worker", () => {
  it("validates bounded polling options", () => {
    assert.deepEqual(
      readAuthEmailOptions({
        AUTH_EMAIL_BATCH_SIZE: "20",
        AUTH_EMAIL_CLAIM_TIMEOUT_MINUTES: "10",
      }),
      { batchSize: 20, claimTimeoutMinutes: 10 },
    );
    assert.throws(() => readAuthEmailOptions({ AUTH_EMAIL_BATCH_SIZE: "0" }), /between 1 and 250/);
  });

  it("claims encrypted messages with skip-locked recovery", async () => {
    const statements: string[] = [];
    const client = {
      async query(statement: string) {
        statements.push(statement);
        return statement.startsWith("with candidates") ? { rows: [candidateRow()] } : { rows: [] };
      },
    } as unknown as PoolClient;

    assert.deepEqual(await claimAuthEmailBatch(client, { batchSize: 25, claimTimeoutMinutes: 15 }), [candidate]);
    assert.equal(statements[0], "begin");
    assert.match(statements[1] ?? "", /for update skip locked/);
    assert.match(statements[1] ?? "", /gen_random_uuid/);
    assert.equal(statements[2], "commit");
  });

  it("uses a stable provider idempotency key", async () => {
    let request: { headers: Record<string, string>; body: string } | undefined;
    const transport = createResendAuthEmailTransport(
      { RESEND_API_KEY: "re_test", RESEND_FROM_EMAIL: "Security <security@example.com>" },
      async (_url, init) => {
        request = { headers: init?.headers as Record<string, string>, body: String(init?.body) };
        return new Response(JSON.stringify({ id: "provider-1" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    );

    assert.deepEqual(await transport.send(candidate, payload), { providerMessageId: "provider-1" });
    assert.equal(request?.headers["Idempotency-Key"], "calmboard-auth-email/outbox-1");
    assert.deepEqual(JSON.parse(request?.body ?? "{}"), {
      from: "Security <security@example.com>",
      to: payload.to,
      subject: payload.subject,
      html: payload.html,
    });
  });

  it("decrypts only after claiming and revalidates the token and recipient", async () => {
    const statements: string[] = [];
    const client = {
      async query(statement: string) {
        statements.push(statement);
        if (statement.startsWith("with candidates")) return { rows: [candidateRow()] };
        if (statement.startsWith("select exists")) return { rows: [{ valid: true }] };
        return { rows: [] };
      },
      release() {},
    } as unknown as PoolClient;
    const pool = { connect: async () => client } as unknown as Pool;
    let deliveredPayload: typeof payload | undefined;

    assert.deepEqual(
      await deliverAuthEmails(
        pool,
        {
          async send(_candidate, decryptedPayload) {
            deliveredPayload = decryptedPayload;
            return { providerMessageId: "provider-1" };
          },
        },
        encryptionEnv,
        { batchSize: 25, claimTimeoutMinutes: 15 },
      ),
      { claimed: 1, sent: 1, skipped: 0, failed: 0 },
    );
    assert.deepEqual(deliveredPayload, payload);
    assert.match(
      statements.find((statement) => statement.startsWith("select exists")) ?? "",
      /token\.expires_at > now\(\)/,
    );
    assert.match(statements.at(-1) ?? "", /status = 'sent'/);
  });

  it("skips an invalidated token without contacting the provider", async () => {
    const client = {
      async query(statement: string) {
        if (statement.startsWith("with candidates")) return { rows: [candidateRow()] };
        if (statement.startsWith("select exists")) return { rows: [{ valid: false }] };
        return { rows: [] };
      },
      release() {},
    } as unknown as PoolClient;
    const pool = { connect: async () => client } as unknown as Pool;
    let sent = false;

    assert.deepEqual(
      await deliverAuthEmails(
        pool,
        {
          async send() {
            sent = true;
            return { providerMessageId: "unexpected" };
          },
        },
        encryptionEnv,
        { batchSize: 25, claimTimeoutMinutes: 15 },
      ),
      { claimed: 1, sent: 0, skipped: 1, failed: 0 },
    );
    assert.equal(sent, false);
  });

  it("releases provider failures with exponential backoff", async () => {
    const statements: string[] = [];
    const client = {
      async query(statement: string) {
        statements.push(statement);
        if (statement.startsWith("with candidates")) return { rows: [candidateRow()] };
        if (statement.startsWith("select exists")) return { rows: [{ valid: true }] };
        return { rows: [] };
      },
      release() {},
    } as unknown as PoolClient;
    const pool = { connect: async () => client } as unknown as Pool;

    assert.deepEqual(
      await deliverAuthEmails(
        pool,
        { send: async () => Promise.reject(new Error("temporary provider failure")) },
        encryptionEnv,
        { batchSize: 25, claimTimeoutMinutes: 15 },
      ),
      { claimed: 1, sent: 0, skipped: 0, failed: 1 },
    );
    assert.match(statements.at(-1) ?? "", /then 'dead'::notification_email_status else 'pending'/);
    assert.match(statements.at(-1) ?? "", /make_interval\(secs => \$3\)/);
  });

  it(
    "delivers an encrypted authentication email exactly once in PostgreSQL",
    { skip: !process.env.DATABASE_MAINTENANCE_URL },
    async () => {
      const pool = new Pool({ connectionString: process.env.DATABASE_MAINTENANCE_URL, max: 2 });
      const userId = randomUUID();
      const tokenId = randomUUID();
      const outboxId = randomUUID();
      const rawToken = `worker-auth-${randomUUID()}`;
      const databaseIdentity = {
        id: outboxId,
        userId,
        authTokenId: tokenId,
        purpose: "password_reset" as const,
      };
      const databasePayload = {
        ...payload,
        to: `auth-worker-${userId}@example.test`,
        html: `<a href="https://example.test/reset?token=${rawToken}">Reset</a>`,
      };
      const envelope = encryptAuthEmailPayload(databaseIdentity, databasePayload, encryptionEnv);
      const deliveries: Array<{ id: string; html: string }> = [];
      try {
        await pool.query(
          `insert into users (id, email, name)
           values ($1, $2, $3)`,
          [userId, databasePayload.to, "Authentication worker user"],
        );
        await pool.query(
          `insert into auth_tokens (id, user_id, purpose, token_hash, expires_at)
           values ($1, $2, $3, $4, now() + interval '30 minutes')`,
          [tokenId, userId, databaseIdentity.purpose, createHash("sha256").update(rawToken).digest("hex")],
        );
        await pool.query(
          `insert into auth_email_outbox (
             id, user_id, auth_token_id, purpose, encrypted_payload,
             initialization_vector, authentication_tag, encryption_algorithm,
             encryption_key_version, idempotency_key
           ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            outboxId,
            userId,
            tokenId,
            databaseIdentity.purpose,
            envelope.encryptedPayload,
            envelope.initializationVector,
            envelope.authenticationTag,
            envelope.encryptionAlgorithm,
            envelope.encryptionKeyVersion,
            `auth-email-test/${outboxId}`,
          ],
        );

        const transport = {
          async send(item: AuthEmailCandidate, decryptedPayload: typeof databasePayload) {
            deliveries.push({ id: item.id, html: decryptedPayload.html });
            return { providerMessageId: `provider-${item.id}` };
          },
        };
        await deliverAuthEmails(pool, transport, encryptionEnv, { batchSize: 25, claimTimeoutMinutes: 15 });
        await deliverAuthEmails(pool, transport, encryptionEnv, { batchSize: 25, claimTimeoutMinutes: 15 });

        assert.deepEqual(
          deliveries.filter((delivery) => delivery.id === outboxId),
          [{ id: outboxId, html: databasePayload.html }],
        );
        const persisted = await pool.query<{
          status: string;
          attempts: number;
          provider_message_id: string | null;
          encrypted_payload: string;
        }>(
          `select status, attempts, provider_message_id, encrypted_payload
           from auth_email_outbox
           where id = $1`,
          [outboxId],
        );
        assert.equal(persisted.rows[0]?.status, "sent");
        assert.equal(persisted.rows[0]?.attempts, 1);
        assert.equal(persisted.rows[0]?.provider_message_id, `provider-${outboxId}`);
        assert.equal(persisted.rows[0]?.encrypted_payload.includes(rawToken), false);
      } finally {
        await pool.query("delete from users where id = $1", [userId]);
        await pool.end();
      }
    },
  );
});
