import assert from "node:assert/strict";
import test from "node:test";
import {
  currentSavedViewConfiguration,
  normalizeTaskBoardConfiguration,
  normalizeTaskCalendarConfiguration,
  normalizeTaskListConfiguration,
  normalizeTaskTableConfiguration,
  normalizeTaskTimelineConfiguration,
  useTaskViewStateStore,
} from "./task-view-state-store";

test("normalizes persisted task table state with custom groups and grouping", () => {
  const normalized = normalizeTaskTableConfiguration({
    sorting: [
      { id: "due", desc: true },
      { id: "unknown", desc: false },
    ],
    columnOrder: ["due", "title", "unknown", "due"],
    columnVisibility: { points: false, unknown: false },
    columnPinning: { left: ["title", "unknown"], right: ["due"] },
    columnSizing: { title: 420, due: 10, unknown: 200 },
    groupBy: "custom",
    collapsedGroups: { "grp-1": true },
    customGroups: [
      { id: "grp-1", name: "Sprint A", color: "violet", taskIds: ["t-1", "t-2", "t-1"] },
      { id: "grp-2", name: "Sprint B", color: "invalid-color", taskIds: [] },
    ],
  });

  assert.deepEqual(normalized.sorting, [{ id: "due", desc: true }]);
  assert.deepEqual(normalized.columnOrder.slice(0, 3), ["select", "due", "title"]);
  assert.deepEqual(normalized.columnVisibility, { points: false });
  assert.deepEqual(normalized.columnPinning, { left: ["title"], right: ["due"] });
  assert.deepEqual(normalized.columnSizing, { title: 420 });
  assert.equal(normalized.groupBy, "custom");
  assert.equal(normalized.collapsedGroups["grp-1"], true);
  assert.equal(normalized.customGroups[0]?.color, "violet");
  assert.deepEqual(normalized.customGroups[0]?.taskIds, ["t-1", "t-2"]);
  assert.equal(normalized.customGroups[1]?.color, "indigo"); // fallback for invalid color
});

test("normalizes board, calendar, timeline, and list configurations", () => {
  assert.deepEqual(
    normalizeTaskBoardConfiguration({
      groupBy: "priority",
      collapsedColumns: { todo: true },
    }),
    { groupBy: "priority", collapsedColumns: { todo: true } },
  );

  assert.deepEqual(normalizeTaskCalendarConfiguration({ mode: "week" }), { mode: "week" });
  assert.deepEqual(normalizeTaskCalendarConfiguration({ mode: "invalid" as any }), { mode: "month" });

  assert.deepEqual(normalizeTaskTimelineConfiguration({ zoom: "months", showCritical: true }), {
    zoom: "months",
    showCritical: true,
  });

  assert.deepEqual(
    normalizeTaskListConfiguration({
      sorting: [{ id: "due", desc: true }],
      groupBy: "status",
    }),
    {
      sorting: [{ id: "due", desc: true }],
      groupBy: "status",
    },
  );
});

test("applies and serializes multi-view saved view configurations", () => {
  const store = useTaskViewStateStore.getState();

  // Apply legacy v1 table configuration
  store.apply({
    schemaVersion: 1,
    table: { columnSizing: { title: 360 }, columnOrder: ["select", "due", "title"] },
  });
  assert.equal(useTaskViewStateStore.getState().table.columnSizing.title, 360);

  // Apply v2 multi-view configuration
  store.apply({
    schemaVersion: 2,
    board: { groupBy: "priority", collapsedColumns: { done: true } },
    calendar: { mode: "day" },
    timeline: { zoom: "days", showCritical: true },
    list: { groupBy: "priority" },
  });

  const state = useTaskViewStateStore.getState();
  assert.equal(state.board.groupBy, "priority");
  assert.equal(state.calendar.mode, "day");
  assert.equal(state.timeline.zoom, "days");
  assert.equal(state.timeline.showCritical, true);
  assert.equal(state.list.groupBy, "priority");

  // Verify serialization with currentSavedViewConfiguration
  const serializedBoard = currentSavedViewConfiguration("board", state);
  assert.equal(serializedBoard.schemaVersion, 2);
  assert.equal(serializedBoard.board?.groupBy, "priority");

  const serializedCalendar = currentSavedViewConfiguration("calendar", state);
  assert.equal(serializedCalendar.schemaVersion, 2);
  assert.equal(serializedCalendar.calendar?.mode, "day");

  const serializedTimeline = currentSavedViewConfiguration("timeline", state);
  assert.equal(serializedTimeline.schemaVersion, 2);
  assert.equal(serializedTimeline.timeline?.showCritical, true);

  const serializedTable = currentSavedViewConfiguration("table", state);
  assert.equal(serializedTable.schemaVersion, 2);
  assert.equal(serializedTable.table?.columnSizing?.title, 360);

  store.resetAll();
});
