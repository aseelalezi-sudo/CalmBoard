import assert from "node:assert/strict";
import test from "node:test";
import { parseCreateSavedViewInput, parseUpdateSavedViewInput } from "./saved-view-validation";

test("saved view validation preserves bounded table state", () => {
  const input = parseCreateSavedViewInput({
    projectId: "project",
    name: "My table",
    viewType: "table",
    filters: { status: "todo", search: "release" },
    configuration: {
      schemaVersion: 1,
      table: {
        sorting: [{ id: "due", desc: true }],
        columnOrder: ["select", "title", "due"],
        columnVisibility: { points: false },
        columnPinning: { left: ["select", "title"], right: ["due"] },
        columnSizing: { title: 360, due: 140 },
      },
    },
    isShared: true,
    isDefault: true,
  });
  assert.equal(input.viewType, "table");
  assert.equal(input.configuration.table?.columnSizing?.title, 360);
  assert.equal(input.isDefault, true);
});

test("saved view validation rejects arbitrary filters and unsafe configuration", () => {
  assert.throws(() =>
    parseCreateSavedViewInput({
      projectId: "project",
      name: "Unsafe",
      viewType: "table",
      filters: { organizationId: "other" },
    }),
  );
  assert.throws(() =>
    parseCreateSavedViewInput({
      projectId: "project",
      name: "Unsafe",
      viewType: "board",
      filters: {},
      configuration: { schemaVersion: 1, table: { columnSizing: { title: 300 } } },
    }),
  );
  assert.throws(() => parseUpdateSavedViewInput({}, "table"));
});
