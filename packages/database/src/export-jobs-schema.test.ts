import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getTableColumns } from "drizzle-orm";
import { exportJobs } from "./schema.js";

describe("workspace export jobs schema", () => {
  it("keeps every request tenant and requester scoped", () => {
    const columns = getTableColumns(exportJobs);
    for (const name of ["organizationId", "exportScope", "requestedBy", "format", "idempotencyKey"] as const) {
      assert.equal(columns[name].notNull, true);
    }
    assert.equal(columns.workspaceId.notNull, false);
    assert.ok(columns.exportScope.default);
  });

  it("stores durable claim, retry, artifact, checksum, and expiry state", () => {
    const columns = getTableColumns(exportJobs);
    for (const name of [
      "status",
      "attempts",
      "maxAttempts",
      "availableAt",
      "claimedAt",
      "claimToken",
      "objectKey",
      "fileName",
      "fileSize",
      "checksumSha256",
      "completedAt",
      "expiresAt",
      "lastError",
    ] as const) {
      assert.ok(columns[name], `${name} must be persisted`);
    }
  });
});
