import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getTableColumns } from "drizzle-orm";
import { authEmailOutbox } from "./schema.js";

describe("authentication email outbox schema", () => {
  it("references a user and one-time token without plaintext delivery fields", () => {
    const columns = getTableColumns(authEmailOutbox);
    assert.equal(columns.userId.notNull, true);
    assert.equal(columns.authTokenId.notNull, true);
    assert.equal(columns.purpose.notNull, true);
    for (const plaintext of ["recipientEmail", "token", "html"]) {
      assert.equal(plaintext in columns, false);
    }
  });

  it("persists an authenticated encryption envelope and durable delivery state", () => {
    const columns = getTableColumns(authEmailOutbox);
    for (const name of [
      "encryptedPayload",
      "initializationVector",
      "authenticationTag",
      "encryptionAlgorithm",
      "encryptionKeyVersion",
      "idempotencyKey",
      "status",
      "attempts",
      "maxAttempts",
      "availableAt",
      "claimedAt",
      "claimToken",
      "sentAt",
      "providerMessageId",
      "lastError",
    ] as const) {
      assert.ok(columns[name], `${name} must be persisted`);
    }
  });
});
