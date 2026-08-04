import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getTableColumns } from "drizzle-orm";
import { taskDependencies, taskRelations } from "./schema.js";

describe("task links schema", () => {
  it("keeps dependencies and relations directly tenant-scoped", () => {
    for (const table of [taskDependencies, taskRelations]) {
      const columns = getTableColumns(table);
      assert.equal(columns.organizationId.notNull, true);
      assert.equal(columns.workspaceId.notNull, true);
      assert.equal(columns.deletedAt.notNull, false);
    }
  });

  it("stores directional dependency and relation endpoints", () => {
    const dependencyColumns = getTableColumns(taskDependencies);
    const relationColumns = getTableColumns(taskRelations);

    assert.equal(dependencyColumns.blockingTaskId.notNull, true);
    assert.equal(dependencyColumns.dependentTaskId.notNull, true);
    assert.equal(dependencyColumns.type.notNull, true);
    assert.equal(dependencyColumns.lagMinutes.notNull, true);
    assert.equal(relationColumns.sourceTaskId.notNull, true);
    assert.equal(relationColumns.targetTaskId.notNull, true);
    assert.equal(relationColumns.type.notNull, true);
  });
});
