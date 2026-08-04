import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getTableColumns, getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { integrationOauthStates } from "./schema.js";

describe("integration OAuth state persistence", () => {
  it("stores only a one-time state hash and expiry without tenant context or provider secrets", () => {
    const columns = getTableColumns(integrationOauthStates);
    assert.equal(getTableName(integrationOauthStates), "integration_oauth_states");
    assert.ok(columns.provider);
    assert.ok(columns.stateHash);
    assert.ok(columns.expiresAt);
    assert.ok(columns.consumedAt);
    assert.equal("state" in columns, false);
    assert.equal("codeVerifier" in columns, false);
    assert.equal("organizationId" in columns, false);
    assert.equal("workspaceId" in columns, false);
    assert.equal("actorId" in columns, false);
    assert.equal("accessToken" in columns, false);
    assert.equal("refreshToken" in columns, false);
    assert.equal(getTableConfig(integrationOauthStates).indexes.length, 1);
  });
});
