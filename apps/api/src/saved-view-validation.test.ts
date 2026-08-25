import assert from "node:assert/strict";
import test from "node:test";
import {
  parseCreateSavedViewInput,
  parseSavedViewConfiguration,
  parseSavedViewFilters,
  parseUpdateSavedViewInput,
} from "./saved-view-validation.js";

test("saved view validation parses and migrates schemaVersion 1 legacy table state", () => {
  const input = parseCreateSavedViewInput({
    projectId: "project",
    name: "Legacy table",
    viewType: "table",
    filters: { status: "todo", search: "release", assignee: "user-1" },
    configuration: {
      schemaVersion: 1,
      table: {
        sorting: [{ id: "due", desc: true }],
        columnOrder: ["select", "title", "due"],
        columnVisibility: { points: false },
        columnPinning: { left: ["select", "title"], right: ["due"] },
        columnSizing: { title: 360, due: 140 },
        groupBy: "status",
        customGroups: [{ id: "grp-1", name: "Phase 1", color: "indigo", taskIds: ["task-1", "task-2"] }],
        collapsedGroups: { todo: true },
      },
    },
    isShared: true,
    isDefault: true,
  });

  assert.equal(input.viewType, "table");
  assert.equal(input.configuration.schemaVersion, 2);
  assert.equal(input.configuration.table?.columnSizing?.title, 360);
  assert.equal(input.configuration.table?.groupBy, "status");
  assert.equal(input.configuration.table?.customGroups?.[0]?.name, "Phase 1");
  assert.equal(input.filters.assigneeId, "user-1");
  assert.equal(input.filters.assignee, "user-1");
  assert.equal(input.isDefault, true);
});

test("saved view validation parses and validates all supported view configurations for schemaVersion 2", () => {
  // Board view
  const board = parseSavedViewConfiguration(
    {
      schemaVersion: 2,
      board: {
        groupBy: "priority",
        collapsedColumns: { backlog: true, done: false },
      },
    },
    "board",
  );
  assert.equal(board.schemaVersion, 2);
  assert.equal(board.board?.groupBy, "priority");
  assert.equal(board.board?.collapsedColumns?.backlog, true);

  // Calendar view
  const calendar = parseSavedViewConfiguration(
    {
      schemaVersion: 2,
      calendar: { mode: "week" },
    },
    "calendar",
  );
  assert.equal(calendar.calendar?.mode, "week");

  // Timeline view
  const timeline = parseSavedViewConfiguration(
    {
      schemaVersion: 2,
      timeline: { zoom: "months", showCritical: true },
    },
    "timeline",
  );
  assert.equal(timeline.timeline?.zoom, "months");
  assert.equal(timeline.timeline?.showCritical, true);

  // List view
  const list = parseSavedViewConfiguration(
    {
      schemaVersion: 2,
      list: { sorting: [{ id: "due", desc: false }], groupBy: "priority" },
    },
    "list",
  );
  assert.equal(list.list?.groupBy, "priority");
  assert.deepEqual(list.list?.sorting, [{ id: "due", desc: false }]);
});

test("saved view validation rejects invalid schema versions and mismatched view configurations", () => {
  // Invalid schema version
  assert.throws(
    () => parseSavedViewConfiguration({ schemaVersion: 3 }, "table"),
    /configuration\.schemaVersion must be 1 or 2/,
  );
  assert.throws(
    () => parseSavedViewConfiguration({ schemaVersion: 0 }, "table"),
    /configuration\.schemaVersion must be 1 or 2/,
  );

  // Mismatched configuration block for view type in v2
  assert.throws(
    () => parseSavedViewConfiguration({ schemaVersion: 2, table: { columnSizing: { title: 300 } } }, "board"),
    /configuration\.table is only valid for table views/,
  );
  assert.throws(
    () => parseSavedViewConfiguration({ schemaVersion: 2, board: { groupBy: "status" } }, "table"),
    /configuration\.board is only valid for board views/,
  );
  assert.throws(
    () => parseSavedViewConfiguration({ schemaVersion: 2, calendar: { mode: "invalid" as any } }, "calendar"),
    /configuration\.calendar\.mode is invalid/,
  );

  // Invalid custom groups
  assert.throws(
    () =>
      parseSavedViewConfiguration(
        {
          schemaVersion: 2,
          table: {
            customGroups: [{ id: "1", name: "G1", color: "neon-pink", taskIds: [] }],
          },
        },
        "table",
      ),
    /configuration\.table\.customGroups\[0\]\.color is invalid/,
  );
});

test("saved view filter validation normalizes assignee and rejects arbitrary filters", () => {
  const parsed = parseSavedViewFilters({
    status: "in_progress",
    priority: "urgent",
    assigneeId: "user-123",
    search: "backend api",
  });
  assert.equal(parsed.status, "in_progress");
  assert.equal(parsed.priority, "urgent");
  assert.equal(parsed.assigneeId, "user-123");
  assert.equal(parsed.search, "backend api");

  assert.throws(() => parseSavedViewFilters({ organizationId: "other" }), /filters\.organizationId is unsupported/);
  assert.throws(() => parseSavedViewFilters({ status: "non_existent_status" }), /filters\.status is invalid/);
  assert.throws(() => parseSavedViewFilters({ priority: "super_high" }), /filters\.priority is invalid/);
});

test("saved view update validation requires at least one field", () => {
  assert.throws(() => parseUpdateSavedViewInput({}, "table"), /saved view update is empty/);
});

test("saved view validation accepts and parses customFields in filters", () => {
  const parsed = parseSavedViewFilters({
    status: "in_progress",
    customFields: [
      { fieldKey: "cf_score", operator: "greater_than_or_equal", value: 80 },
      { fieldKey: "cf_env", operator: "contains", value: "prod" },
    ],
  });
  assert.equal(parsed.status, "in_progress");
  assert.equal(parsed.customFields?.length, 2);
  assert.equal(parsed.customFields?.[0]?.fieldKey, "cf_env");
  assert.equal(parsed.customFields?.[0]?.operator, "contains");
  assert.equal(parsed.customFields?.[0]?.value, "prod");
  assert.equal(parsed.customFields?.[1]?.fieldKey, "cf_score");
  assert.equal(parsed.customFields?.[1]?.operator, "greater_than_or_equal");
  assert.equal(parsed.customFields?.[1]?.value, 80);

  // Rejects invalid operator in customFields
  assert.throws(
    () =>
      parseSavedViewFilters({
        customFields: [{ fieldKey: "cf_score", operator: "invalid_op", value: 10 }],
      }),
    /filters\.customFields\[0\]\.operator is invalid/,
  );
});
