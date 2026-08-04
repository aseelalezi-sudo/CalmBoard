import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getTableColumns, getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { dashboardLayouts } from "./schema.js";

describe("dashboard layout persistence schema", () => {
  it("stores one versioned personal layout per workspace", () => {
    assert.equal(getTableName(dashboardLayouts), "dashboard_layouts");
    const columns = getTableColumns(dashboardLayouts);
    assert.equal(columns.organizationId.notNull, true);
    assert.equal(columns.workspaceId.notNull, true);
    assert.equal(columns.userId.notNull, true);
    assert.equal(columns.widgets.notNull, true);
    assert.equal(columns.version.notNull, true);
    assert.equal(getTableConfig(dashboardLayouts).indexes.length, 2);
  });
});
