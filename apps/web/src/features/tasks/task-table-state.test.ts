import assert from "node:assert/strict";
import test from "node:test";
import { moveTableColumn, normalizeTableColumnOrder, TASK_TABLE_COLUMN_ORDER } from "./task-table-state";

test("advanced task table column state", async (t) => {
  await t.test("moves data columns without moving the selection column", () => {
    const moved = moveTableColumn([...TASK_TABLE_COLUMN_ORDER], "status", -1);
    assert.deepEqual(moved.slice(0, 4), ["select", "status", "title", "priority"]);
    assert.strictEqual(moveTableColumn(moved, "status", -1), moved);
  });

  await t.test("normalizes persisted order and restores missing columns", () => {
    const normalized = normalizeTableColumnOrder(["due", "title", "title", "unknown"]);
    assert.equal(normalized[0], "select");
    assert.equal(normalized[1], "due");
    assert.equal(normalized.filter((column) => column === "title").length, 1);
    assert.deepEqual(new Set(normalized), new Set(TASK_TABLE_COLUMN_ORDER));
  });
});
