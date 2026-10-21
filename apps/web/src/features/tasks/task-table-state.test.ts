import assert from "node:assert/strict";
import test from "node:test";
import {
  keyboardColumnSize,
  moveTableColumn,
  normalizeTableColumnOrder,
  TASK_TABLE_COLUMN_ORDER,
} from "./task-table-state";

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

test("keyboard column resizing", async (t) => {
  await t.test("widens with the arrow pointing away from the cell in each direction and clamps to the limits", () => {
    assert.equal(keyboardColumnSize(120, "ArrowRight", false, 95, 400), 136);
    assert.equal(keyboardColumnSize(120, "ArrowLeft", false, 95, 400), 104);
    assert.equal(keyboardColumnSize(120, "ArrowLeft", true, 95, 400), 136);
    assert.equal(keyboardColumnSize(120, "ArrowRight", true, 95, 400), 104);
    assert.equal(keyboardColumnSize(100, "ArrowLeft", false, 95, 400), 95);
    assert.equal(keyboardColumnSize(395, "ArrowRight", false, 95, 400), 400);
    assert.equal(keyboardColumnSize(120, "ArrowRight", false, 95, 400, 48), 168);
  });

  await t.test("ignores unrelated keys", () => {
    assert.equal(keyboardColumnSize(120, "Enter", false, 95, 400), undefined);
    assert.equal(keyboardColumnSize(120, "ArrowUp", true, 95, 400), undefined);
  });
});
