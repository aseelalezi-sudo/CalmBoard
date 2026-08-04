import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getTableColumns, getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { documentPermissions, docs, docVersions } from "./schema.js";

describe("document collaboration schema", () => {
  it("persists workspace visibility, inheritance, and per-user access", () => {
    const documentColumns = getTableColumns(docs);
    assert.equal(documentColumns.workspaceAccess.notNull, true);
    assert.equal(documentColumns.inheritPermissions.notNull, true);
    assert.equal(documentColumns.isPublic.notNull, true);

    assert.equal(getTableName(documentPermissions), "document_permissions");
    const permissionColumns = getTableColumns(documentPermissions);
    assert.equal(permissionColumns.organizationId.notNull, true);
    assert.equal(permissionColumns.workspaceId.notNull, true);
    assert.equal(permissionColumns.docId.notNull, true);
    assert.equal(permissionColumns.userId.notNull, true);
    assert.equal(permissionColumns.accessLevel.notNull, true);
    assert.equal(getTableConfig(documentPermissions).indexes.length, 2);
  });

  it("keeps immutable version identity unique within a document", () => {
    const versionColumns = getTableColumns(docVersions);
    assert.equal(versionColumns.versionNumber.notNull, true);
    assert.equal(versionColumns.savedById.notNull, true);
    assert.equal(getTableConfig(docVersions).indexes.length, 2);
  });
});
