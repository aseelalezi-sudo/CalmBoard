import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getTableColumns } from "drizzle-orm";
import { idempotencyKeys } from "./schema.js";

describe("idempotency key schema", () => {
  it("stores request identity, processing ownership, replay response, and retention state", () => {
    const columns = getTableColumns(idempotencyKeys);
    assert.equal(columns.organizationId.notNull, true);
    assert.equal(columns.workspaceId.notNull, false);
    assert.equal(columns.key.notNull, true);
    assert.equal(columns.scope.notNull, true);
    assert.equal(columns.requestHash.notNull, true);
    assert.equal(columns.status.notNull, true);
    assert.equal(columns.lockToken.notNull, true);
    assert.equal(columns.attempts.notNull, true);
    assert.equal(columns.responseStatusCode.notNull, false);
    assert.equal(columns.responseBody.notNull, false);
    assert.equal(columns.expiresAt.notNull, true);
  });
});
