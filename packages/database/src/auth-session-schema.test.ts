import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getTableColumns } from "drizzle-orm";
import { refreshTokens, userSessions } from "./schema.js";

describe("authentication session schema", () => {
  it("stores revocable expiring sessions", () => {
    const columns = getTableColumns(userSessions);
    assert.equal(columns.userId.notNull, true);
    assert.equal(columns.expiresAt.notNull, true);
    assert.equal(columns.lastActive.notNull, true);
    assert.equal(columns.revokedAt.notNull, false);
    assert.equal(columns.revokeReason.notNull, false);
  });

  it("stores only refresh token hashes and rotation lineage", () => {
    const columns = getTableColumns(refreshTokens);
    assert.equal(columns.sessionId.notNull, true);
    assert.equal(columns.userId.notNull, true);
    assert.equal(columns.familyId.notNull, true);
    assert.equal(columns.tokenHash.notNull, true);
    assert.equal(columns.parentTokenId.notNull, false);
    assert.equal(columns.replacedByTokenId.notNull, false);
    assert.equal(columns.expiresAt.notNull, true);
  });
});
