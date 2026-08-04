import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decryptAuthEmailPayload, encryptAuthEmailPayload, type AuthEmailIdentity } from "./index.js";

const env = { AUTH_EMAIL_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" };
const identity: AuthEmailIdentity = {
  id: "00000000-0000-4000-8000-000000000001",
  userId: "00000000-0000-4000-8000-000000000002",
  authTokenId: "00000000-0000-4000-8000-000000000003",
  purpose: "password_reset",
};
const payload = {
  to: "Member@Example.com",
  name: "Member",
  subject: "Reset your password",
  html: '<a href="https://example.com/reset?token=raw-secret">Reset</a>',
};

describe("auth email encryption", () => {
  it("round-trips a normalized payload without storing the raw token", () => {
    const envelope = encryptAuthEmailPayload(identity, payload, env);
    assert.equal(envelope.encryptedPayload.includes("raw-secret"), false);
    assert.deepEqual(decryptAuthEmailPayload(identity, envelope, env), {
      ...payload,
      to: "member@example.com",
    });
  });

  it("binds ciphertext to the outbox, user, token, purpose, and key version", () => {
    const envelope = encryptAuthEmailPayload(identity, payload, env);
    assert.throws(
      () =>
        decryptAuthEmailPayload({ ...identity, authTokenId: "00000000-0000-4000-8000-000000000004" }, envelope, env),
      /authentication failed/,
    );
    const tamperedPayload = `${envelope.encryptedPayload[0] === "A" ? "B" : "A"}${envelope.encryptedPayload.slice(1)}`;
    assert.throws(
      () => decryptAuthEmailPayload(identity, { ...envelope, encryptedPayload: tamperedPayload }, env),
      /authentication failed/,
    );
  });
});
