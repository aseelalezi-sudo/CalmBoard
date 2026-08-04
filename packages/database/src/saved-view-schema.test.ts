import assert from "node:assert/strict";
import test from "node:test";
import { getTableColumns, getTableName } from "drizzle-orm";
import { savedViews } from "./schema.js";

test("saved view persistence schema", async (suite) => {
  await suite.test("stores versioned view state and ownership flags", () => {
    assert.equal(getTableName(savedViews), "saved_views");
    const columns = getTableColumns(savedViews);
    assert.equal(columns.organizationId.notNull, true);
    assert.equal(columns.workspaceId.notNull, true);
    assert.equal(columns.filters.notNull, true);
    assert.equal(columns.configuration.notNull, true);
    assert.equal(columns.isShared.notNull, true);
    assert.equal(columns.isDefault.notNull, true);
  });

  await suite.test("keeps project scope optional for legacy workspace views", () => {
    const columns = getTableColumns(savedViews);
    assert.equal(columns.projectId.notNull, false);
    assert.equal(columns.createdBy.notNull, false);
  });
});
