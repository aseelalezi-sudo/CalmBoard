import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { encryptInvitationEmailPayload } from "@calmboard/notifications";
import { Pool, type PoolClient } from "pg";
import {
  claimInvitationEmailBatch,
  createResendInvitationEmailTransport,
  deliverInvitationEmails,
  readInvitationEmailOptions,
  type InvitationEmailCandidate,
} from "./invitation-email.js";

const encryptionEnv = { AUTH_EMAIL_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" };
const identity = {
  id: "outbox-1",
  organizationId: "organization-1",
  workspaceId: "workspace-1",
  invitationId: "invitation-1",
  tokenVersion: 2,
};
const payload = {
  to: "invitee@example.com",
  name: "Invitee",
  subject: "CalmBoard invitation",
  html: '<a href="https://example.com/accept-invitation?token=secret">Accept</a>',
};
const candidate: InvitationEmailCandidate = {
  ...identity,
  ...encryptInvitationEmailPayload(identity, payload, encryptionEnv),
  recipientEmail: payload.to,
  attempt: 1,
  maxAttempts: 8,
  claimToken: "claim-1",
};

function candidateRow() {
  return {
    id: candidate.id,
    organization_id: candidate.organizationId,
    workspace_id: candidate.workspaceId,
    invitation_id: candidate.invitationId,
    token_version: candidate.tokenVersion,
    recipient_email: candidate.recipientEmail,
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

function mockedPool(valid: boolean, statements: string[]) {
  const client = {
    async query(statement: string) {
      statements.push(statement);
      if (statement.startsWith("with candidates")) return { rows: [candidateRow()] };
      if (statement.startsWith("select exists")) return { rows: [{ valid }] };
      return { rows: [] };
    },
    release() {},
  } as unknown as PoolClient;
  return { connect: async () => client } as unknown as Pool;
}

describe("invitation email worker", () => {
  it("validates bounded claim settings and uses skip-locked recovery", async () => {
    assert.deepEqual(
      readInvitationEmailOptions({
        INVITATION_EMAIL_BATCH_SIZE: "20",
        INVITATION_EMAIL_CLAIM_TIMEOUT_MINUTES: "10",
      }),
      { batchSize: 20, claimTimeoutMinutes: 10 },
    );
    assert.throws(() => readInvitationEmailOptions({ INVITATION_EMAIL_BATCH_SIZE: "0" }), /between 1 and 250/);
    const statements: string[] = [];
    const client = {
      async query(statement: string) {
        statements.push(statement);
        return statement.startsWith("with candidates") ? { rows: [candidateRow()] } : { rows: [] };
      },
    } as unknown as PoolClient;
    assert.deepEqual(await claimInvitationEmailBatch(client, { batchSize: 25, claimTimeoutMinutes: 15 }), [candidate]);
    assert.match(statements[1] ?? "", /for update skip locked/);
  });

  it("revalidates token generation, decrypts, sends idempotently, and scrubs ciphertext", async () => {
    const statements: string[] = [];
    let delivered: typeof payload | undefined;
    assert.deepEqual(
      await deliverInvitationEmails(
        mockedPool(true, statements),
        {
          async send(_candidate, decrypted) {
            delivered = decrypted;
            return { providerMessageId: "provider-1" };
          },
        },
        encryptionEnv,
        { batchSize: 25, claimTimeoutMinutes: 15 },
      ),
      { claimed: 1, sent: 1, skipped: 0, failed: 0 },
    );
    assert.deepEqual(delivered, payload);
    assert.match(statements.find((statement) => statement.startsWith("select exists")) ?? "", /token_version = \$4/);
    assert.match(statements.at(-1) ?? "", /encrypted_payload = null/);

    let requestHeaders: Record<string, string> | undefined;
    const transport = createResendInvitationEmailTransport(
      { RESEND_API_KEY: "re_test", RESEND_FROM_EMAIL: "Invitations <invite@example.com>" },
      async (_url, init) => {
        requestHeaders = init?.headers as Record<string, string>;
        return new Response(JSON.stringify({ id: "provider-1" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    );
    await transport.send(candidate, payload);
    assert.equal(requestHeaders?.["Idempotency-Key"], "calmboard-invitation-email/outbox-1");
  });

  it("skips stale generations without delivery and scrubs their ciphertext", async () => {
    const statements: string[] = [];
    let contacted = false;
    assert.deepEqual(
      await deliverInvitationEmails(
        mockedPool(false, statements),
        {
          async send() {
            contacted = true;
            return { providerMessageId: "unexpected" };
          },
        },
        encryptionEnv,
        { batchSize: 25, claimTimeoutMinutes: 15 },
      ),
      { claimed: 1, sent: 0, skipped: 1, failed: 0 },
    );
    assert.equal(contacted, false);
    assert.match(statements.at(-1) ?? "", /status = 'skipped'/);
    assert.match(statements.at(-1) ?? "", /encrypted_payload = null/);
  });

  it("releases temporary provider failures for retry with backoff", async () => {
    const statements: string[] = [];
    assert.deepEqual(
      await deliverInvitationEmails(
        mockedPool(true, statements),
        { send: async () => Promise.reject(new Error("temporary provider failure")) },
        encryptionEnv,
        { batchSize: 25, claimTimeoutMinutes: 15 },
      ),
      { claimed: 1, sent: 0, skipped: 0, failed: 1 },
    );
    assert.match(statements.at(-1) ?? "", /status = case when attempts >= max_attempts/);
    assert.match(statements.at(-1) ?? "", /make_interval\(secs => \$3\)/);
  });
});
