import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getTableColumns } from "drizzle-orm";
import { notificationEmailOutbox } from "./schema.js";

describe("notification email outbox schema", () => {
  it("keeps every notification email directly tenant and recipient scoped", () => {
    const columns = getTableColumns(notificationEmailOutbox);
    assert.equal(columns.organizationId.notNull, true);
    assert.equal(columns.workspaceId.notNull, true);
    assert.equal(columns.userId.notNull, true);
    assert.equal(columns.idempotencyKey.notNull, true);
  });

  it("stores durable claim, retry, provider, and terminal delivery state", () => {
    const columns = getTableColumns(notificationEmailOutbox);
    for (const name of [
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
