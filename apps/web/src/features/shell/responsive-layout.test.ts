import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("mobile layout contract", () => {
  it("keeps the application shell inside the viewport and mobile safe area", () => {
    const shell = source("./calmboard-app.tsx");
    const drawer = source("./mobile-navigation-drawer.tsx");
    const activeView = source("./active-view.tsx");

    assert.match(shell, /min-h-dvh/);
    assert.match(shell, /safe-area-inset-bottom/);
    assert.match(shell, /min-w-0 flex-1/);
    assert.match(activeView, /min-w-0 w-full/);
    assert.match(drawer, /h-dvh/);
    assert.match(drawer, /safe-area-inset-bottom/);
  });

  it("contains dense task surfaces instead of widening the page", () => {
    const table = source("../tasks/advanced-task-table.tsx");
    const calendar = source("../tasks/advanced-task-calendar.tsx");
    const gantt = source("../tasks/advanced-task-gantt.tsx");
    const legacyViews = source("../tasks/task-views.tsx");

    assert.match(table, /overflow-x-auto/);
    assert.match(calendar, /overflow-x-auto/);
    assert.match(gantt, /max-h-\[min\(680px,70dvh\)\] overflow-auto overscroll-contain/);
    assert.match(legacyViews, /overflow-x-auto overscroll-x-contain/);
  });

  it("uses dynamic viewport heights for full-screen mobile overlays", () => {
    for (const path of ["../search/command-palette.tsx", "../ai/ai-panel.tsx", "../tasks/task-drawer.tsx"]) {
      assert.match(source(path), /dvh/);
    }
  });

  it("pins notifications to the mobile viewport instead of the crowded trigger row", () => {
    const shell = source("./calmboard-app.tsx");

    assert.match(shell, /fixed inset-x-2 top-\[4\.5rem\]/);
    assert.match(shell, /max-h-\[calc\(100dvh-5rem\)\]/);
    assert.match(shell, /dropdown-options min-h-0 flex-1/);
  });

  it("keeps the role editor actions visible and its long permission list contained", () => {
    const permissions = source("../permissions/permissions-view.tsx");
    const ui = source("../../components/ui.tsx");

    assert.match(permissions, /width: "min\(760px, calc\(100vw - 1rem\)\)"/);
    assert.match(permissions, /height: "min\(640px, calc\(100dvh - 1rem\)\)"/);
    assert.match(permissions, /flex shrink-0 flex-col-reverse/);
    assert.match(permissions, /min-h-64 flex-1 space-y-4 overflow-y-auto/);
    assert.match(permissions, /closeLabel=\{ctx\.t\("إغلاق نافذة الدور"/);
    assert.match(ui, /"min-h-0 flex-1 p-4 sm:p-5"/);
    assert.match(ui, /contentScrollable && "overflow-y-auto overscroll-contain"/);
    assert.match(ui, /createPortal\(/);
    assert.match(ui, /document\.body/);
  });

  it("uses shared page widths instead of per-screen pixel limits", () => {
    const styles = source("../../app/globals.css");
    assert.match(styles, /\.screen-container-focused/);
    assert.match(styles, /\.screen-container-standard/);
    assert.match(styles, /\.screen-container-wide/);

    for (const path of [
      "../activity/activity-view.tsx",
      "../automations/automation-view.tsx",
      "../billing/billing-view.tsx",
      "../dashboard/dashboard-view.tsx",
      "../docs/docs-view.tsx",
      "../forms/forms-view.tsx",
      "../goals/goals-view.tsx",
      "../inbox/inbox-view.tsx",
      "../integrations/integrations-view.tsx",
      "../members/members-view.tsx",
      "../permissions/permissions-view.tsx",
      "../projects/projects-view.tsx",
      "../settings/settings-view.tsx",
      "../time/time-view.tsx",
      "../workspace/workspaces-view.tsx",
    ]) {
      const view = source(path);
      assert.match(view, /screen-container-(?:focused|standard|wide)/);
      assert.doesNotMatch(view, /max-w-\[[0-9]+px\].*(?:mx-auto|overflow-hidden)/);
    }
  });

  it("keeps shared small actions touch-sized on phones and compact on desktop", () => {
    const ui = source("../../components/ui.tsx");
    const builder = source("../forms/form-builder.tsx");
    assert.match(ui, /size === "sm" && "h-10 .*sm:h-8"/);
    assert.match(builder, /h-10 w-10.*sm:h-8 sm:w-7/);
  });
});
