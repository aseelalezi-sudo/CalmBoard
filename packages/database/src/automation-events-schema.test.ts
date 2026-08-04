import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getTableColumns } from "drizzle-orm";
import { automationEvents } from "./schema.js";

describe("automation event outbox schema", () => {
  it("stores tenant-scoped immutable task event identity and loop depth", () => {
    const columns = getTableColumns(automationEvents);
    for (const name of [
      "organizationId",
      "workspaceId",
      "taskId",
      "trigger",
      "taskVersion",
      "current",
      "depth",
      "deduplicationKey",
    ] as const) {
      assert.equal(columns[name].notNull, true, `${name} must be required`);
    }
    assert.equal(columns.deduplicationKey.notNull, true);
  });

  it("persists durable claim, retry, completion, and failure state", () => {
    const columns = getTableColumns(automationEvents);
    for (const name of [
      "status",
      "attempts",
      "maxAttempts",
      "availableAt",
      "claimedAt",
      "claimToken",
      "completedAt",
      "lastError",
    ] as const) {
      assert.ok(columns[name], `${name} must be persisted`);
    }
  });
});
