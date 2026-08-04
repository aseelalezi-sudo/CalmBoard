import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DashboardWidget } from "@/lib/types";
import { nextDashboardWidgetWidth, reorderDashboardWidgets } from "./layout";

describe("dashboard layout interactions", () => {
  it("reorders widgets without mutating the saved layout", () => {
    const widgets: DashboardWidget[] = [
      { id: "total_tasks", width: "small" },
      { id: "goals", width: "medium" },
      { id: "activity", width: "full" },
    ];
    const reordered = reorderDashboardWidgets(widgets, "activity", "total_tasks");
    assert.deepEqual(
      reordered.map((widget) => widget.id),
      ["activity", "total_tasks", "goals"],
    );
    assert.deepEqual(
      widgets.map((widget) => widget.id),
      ["total_tasks", "goals", "activity"],
    );
  });

  it("cycles through every supported responsive width", () => {
    assert.equal(nextDashboardWidgetWidth("small"), "medium");
    assert.equal(nextDashboardWidgetWidth("medium"), "wide");
    assert.equal(nextDashboardWidgetWidth("wide"), "full");
    assert.equal(nextDashboardWidgetWidth("full"), "small");
  });
});
