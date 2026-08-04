import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getTableColumns, getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { goalCheckins, goals, goalTaskLinks } from "./schema.js";

describe("OKR persistence schema", () => {
  it("stores measurable and weighted goal progress", () => {
    const columns = getTableColumns(goals);
    assert.equal(columns.type.notNull, true);
    assert.equal(columns.progress.notNull, true);
    assert.equal(columns.progressMode.notNull, true);
    assert.equal(columns.measurementUnit.notNull, true);
    assert.equal(columns.startValue.notNull, true);
    assert.equal(columns.currentValue.notNull, true);
    assert.equal(columns.targetValue.notNull, true);
    assert.equal(columns.weight.notNull, true);
    assert.equal(getTableConfig(goals).indexes.length, 2);
  });

  it("keeps task contributions and check-ins relational and tenant scoped", () => {
    assert.equal(getTableName(goalTaskLinks), "goal_task_links");
    assert.equal(getTableName(goalCheckins), "goal_checkins");
    for (const table of [goalTaskLinks, goalCheckins]) {
      const columns = getTableColumns(table);
      assert.equal(columns.organizationId.notNull, true);
      assert.equal(columns.workspaceId.notNull, true);
      assert.equal(columns.goalId.notNull, true);
    }
    assert.equal(getTableColumns(goalTaskLinks).taskId.notNull, true);
    assert.equal(getTableColumns(goalCheckins).progress.notNull, true);
  });
});
