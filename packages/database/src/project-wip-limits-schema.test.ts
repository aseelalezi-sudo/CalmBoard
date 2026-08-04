import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getTableColumns } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { projectWipLimits } from "./schema.js";

describe("project WIP limit schema", () => {
  it("keeps each limit directly tenant and project scoped", () => {
    const columns = getTableColumns(projectWipLimits);
    assert.equal(columns.organizationId.notNull, true);
    assert.equal(columns.workspaceId.notNull, true);
    assert.equal(columns.projectId.notNull, true);
    assert.equal(columns.status.notNull, true);
    assert.equal(columns.limit.notNull, true);
  });

  it("keeps one bounded limit per project status", () => {
    const config = getTableConfig(projectWipLimits);
    assert.equal(
      config.indexes.some((index) => index.config.unique),
      true,
    );
    assert.equal(
      config.checks.some((constraint) => constraint.name === "project_wip_limits_limit_check"),
      true,
    );
  });
});
