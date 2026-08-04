import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getTableColumns, getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { formResponses, forms } from "./schema.js";

describe("form builder persistence schema", () => {
  it("stores versioned definitions and tenant-scoped publication state", () => {
    assert.equal(getTableName(forms), "forms");
    const columns = getTableColumns(forms);
    assert.equal(columns.organizationId.notNull, true);
    assert.equal(columns.workspaceId.notNull, true);
    assert.equal(columns.fields.notNull, true);
    assert.equal(columns.settings.notNull, true);
    assert.equal(columns.responses.notNull, true);
    assert.equal(columns.isActive.notNull, true);
    const config = getTableConfig(forms);
    assert.equal(config.indexes.length, 1);
    assert.equal(config.checks.length, 3);
  });

  it("keeps response data non-null and links created tasks relationally", () => {
    const columns = getTableColumns(formResponses);
    assert.equal(columns.organizationId.notNull, true);
    assert.equal(columns.workspaceId.notNull, true);
    assert.equal(columns.formId.notNull, true);
    assert.equal(columns.data.notNull, true);
    assert.equal(columns.createdTaskId.notNull, false);
    assert.equal(columns.taskCreationPayload.notNull, false);
    assert.equal(columns.taskCreationStatus.notNull, true);
    assert.equal(columns.taskCreationAttempts.notNull, true);
    assert.equal(columns.taskCreationMaxAttempts.notNull, true);
    assert.equal(columns.taskCreationAvailableAt.notNull, true);
    assert.equal(columns.taskCreationClaimedAt.notNull, false);
    assert.equal(columns.taskCreationClaimToken.notNull, false);
    assert.equal(columns.taskCreationCompletedAt.notNull, false);
    const config = getTableConfig(formResponses);
    assert.equal(config.indexes.length, 2);
    assert.equal(config.checks.length, 6);
    assert.equal(config.foreignKeys.length, 4);
  });
});
