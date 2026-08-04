import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getTableColumns } from "drizzle-orm";
import { integrationCredentials } from "./schema.js";

describe("integration credential schema", () => {
  it("stores only an authenticated encryption envelope and non-secret connection metadata", () => {
    const columns = getTableColumns(integrationCredentials);
    assert.equal(columns.organizationId.notNull, true);
    assert.equal(columns.workspaceId.notNull, true);
    assert.equal(columns.encryptedPayload.notNull, true);
    assert.equal(columns.initializationVector.notNull, true);
    assert.equal(columns.authenticationTag.notNull, true);
    assert.equal(columns.encryptionKeyVersion.notNull, true);
    assert.equal(columns.secretFingerprint.notNull, true);
    assert.equal(columns.createdBy.notNull, true);
    assert.equal(columns.revokedAt.notNull, false);
    assert.equal("accessToken" in columns, false);
    assert.equal("refreshToken" in columns, false);
    assert.equal("apiKey" in columns, false);
    assert.equal("webhookSecret" in columns, false);
  });
});
