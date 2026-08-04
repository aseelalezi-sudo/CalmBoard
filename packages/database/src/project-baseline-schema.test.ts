import assert from "node:assert/strict";
import test from "node:test";
import { getTableColumns } from "drizzle-orm";
import { projectBaselines, projectBaselineTasks, tasks } from "./schema.js";

test("project baseline and milestone schema", async (t) => {
  await t.test("stores immutable tenant-scoped project snapshots", () => {
    const baseline = getTableColumns(projectBaselines);
    const snapshot = getTableColumns(projectBaselineTasks);
    for (const columns of [baseline, snapshot]) {
      assert.equal(columns.organizationId.notNull, true);
      assert.equal(columns.workspaceId.notNull, true);
      assert.equal(columns.projectId.notNull, true);
    }
    assert.equal(snapshot.sourceTaskId.notNull, true);
    assert.equal(snapshot.taskVersion.notNull, true);
  });

  await t.test("stores milestone identity directly on tasks", () => {
    const columns = getTableColumns(tasks);
    assert.equal(columns.isMilestone.notNull, true);
    assert.equal(columns.isMilestone.hasDefault, true);
  });
});
