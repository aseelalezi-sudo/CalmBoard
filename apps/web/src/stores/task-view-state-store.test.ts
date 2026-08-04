import assert from "node:assert/strict";
import test from "node:test";
import {
  currentSavedViewConfiguration,
  normalizeTaskTableConfiguration,
  useTaskViewStateStore,
} from "./task-view-state-store";

test("normalizes persisted task table state", () => {
  const normalized = normalizeTaskTableConfiguration({
    sorting: [
      { id: "due", desc: true },
      { id: "unknown", desc: false },
    ],
    columnOrder: ["due", "title", "unknown", "due"],
    columnVisibility: { points: false, unknown: false },
    columnPinning: { left: ["title", "unknown"], right: ["due"] },
    columnSizing: { title: 420, due: 10, unknown: 200 },
  });

  assert.deepEqual(normalized.sorting, [{ id: "due", desc: true }]);
  assert.deepEqual(normalized.columnOrder.slice(0, 3), ["select", "due", "title"]);
  assert.deepEqual(normalized.columnVisibility, { points: false });
  assert.deepEqual(normalized.columnPinning, { left: ["title"], right: ["due"] });
  assert.deepEqual(normalized.columnSizing, { title: 420 });
});

test("applies and serializes table-only saved view configuration", () => {
  useTaskViewStateStore.getState().apply({
    schemaVersion: 1,
    table: { columnSizing: { title: 360 }, columnOrder: ["select", "due", "title"] },
  });
  const table = useTaskViewStateStore.getState().table;
  assert.equal(table.columnSizing.title, 360);
  assert.deepEqual(table.columnOrder.slice(0, 3), ["select", "due", "title"]);
  assert.deepEqual(currentSavedViewConfiguration("board", table), { schemaVersion: 1 });
  const savedTable = currentSavedViewConfiguration("table", table).table;
  assert.ok(savedTable);
  assert.equal(savedTable.columnSizing?.title, 360);
  useTaskViewStateStore.getState().resetTable();
});
