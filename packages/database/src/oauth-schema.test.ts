import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getTableColumns } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { oauthIdentities, oauthLoginStates } from "./schema.js";

describe("OAuth login persistence", () => {
  it("stores one-time state hashes and stable provider subjects without provider tokens", () => {
    const state = getTableColumns(oauthLoginStates);
    assert.ok(state.stateHash);
    assert.ok(state.expiresAt);
    assert.ok(state.consumedAt);
    assert.equal("state" in state, false);
    assert.equal("codeVerifier" in state, false);

    const identity = getTableColumns(oauthIdentities);
    assert.ok(identity.providerSubject);
    assert.equal("accessToken" in identity, false);
    assert.equal("refreshToken" in identity, false);
    assert.equal("clientSecret" in identity, false);
    assert.equal(getTableConfig(oauthIdentities).indexes.length, 3);
  });
});
