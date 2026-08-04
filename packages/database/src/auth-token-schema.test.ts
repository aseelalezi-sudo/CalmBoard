import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getTableColumns } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { authTokens, users } from "./schema.js";

describe("authentication recovery schema", () => {
  it("stores hashed one-time token lifecycle without a raw token column", () => {
    const columns = getTableColumns(authTokens);
    assert.ok(columns.tokenHash);
    assert.ok(columns.expiresAt);
    assert.ok(columns.consumedAt);
    assert.ok(columns.invalidatedAt);
    assert.equal("token" in columns, false);
    assert.equal(getTableConfig(authTokens).indexes.length, 2);
  });

  it("tracks email verification and password changes on the identity", () => {
    const columns = getTableColumns(users);
    assert.ok(columns.emailVerifiedAt);
    assert.ok(columns.passwordChangedAt);
  });
});
