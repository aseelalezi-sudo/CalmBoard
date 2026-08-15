import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const ui = readFileSync(new URL("./ui.tsx", import.meta.url), "utf8");
const shell = readFileSync(new URL("../features/shell/calmboard-app.tsx", import.meta.url), "utf8");

describe("shared screen chrome", () => {
  it("provides one responsive, semantic screen header", () => {
    assert.match(ui, /export function ScreenHeader/);
    assert.match(ui, /<header className=/);
    assert.match(ui, /<h1 className=/);
    assert.match(ui, /sm:flex-row sm:items-start sm:justify-between/);
  });

  it("provides a wrapping labelled toolbar for dense controls", () => {
    assert.match(ui, /export function ScreenToolbar/);
    assert.match(ui, /role="toolbar"/);
    assert.match(ui, /flex min-w-0 flex-wrap items-center/);
  });

  it("provides consistent accessible loading, empty, error, and permission states", () => {
    assert.match(ui, /export function ScreenState/);
    assert.match(ui, /"loading" \| "empty" \| "error" \| "permission"/);
    assert.match(ui, /aria-live=/);
    assert.match(ui, /export function Empty[\s\S]*?<ScreenState[\s\S]*?framed=\{false\}/);
    for (const file of [
      "../features/workspace/workspaces-view.tsx",
      "../features/projects/projects-view.tsx",
      "../features/permissions/permissions-view.tsx",
      "../features/sprints/sprint-backlog-view.tsx",
      "../features/sprints/sprint-board-view.tsx",
      "../features/sprints/analytics/reports-overview.tsx",
      "../features/sprints/analytics/velocity-view.tsx",
      "../features/sprints/analytics/burndown-view.tsx",
    ]) {
      assert.match(readFileSync(new URL(file, import.meta.url), "utf8"), /<ScreenState/);
    }
  });

  it("provides one RTL-aware keyboard contract for segmented tabs", () => {
    assert.match(ui, /export function SegmentedTabs/);
    assert.match(ui, /role="tablist"/);
    assert.match(ui, /"ArrowLeft", "ArrowRight", "Home", "End"/);
    assert.match(ui, /document\.documentElement\.dir === "rtl"/);
    assert.match(ui, /tabIndex=\{value === item\.value \? 0 : -1\}/);
    for (const file of [
      "../features/time/time-view.tsx",
      "../features/settings/settings-view.tsx",
      "../features/permissions/permissions-view.tsx",
      "../features/sprints/sprints-view.tsx",
      "../features/sprints/sprint-reports-view.tsx",
    ]) {
      assert.match(readFileSync(new URL(file, import.meta.url), "utf8"), /<SegmentedTabs/);
    }
  });

  it("uses shared tabs and controls for the primary project toolbar", () => {
    assert.match(shell, /<ScreenToolbar/);
    assert.match(shell, /<SegmentedTabs/);
    assert.match(shell, /className=\{`\$\{inputCls\}/);
    assert.match(shell, /className=\{`\$\{selectCls\}/);
    assert.match(shell, /aria-label=\{t\("البحث في مهام المشروع"/);
  });

  it("provides one visible invalid and disabled contract for form controls", () => {
    assert.match(ui, /export const inputCls =[\s\S]*?aria-invalid:border-rose-500/);
    assert.match(ui, /export const areaCls =[\s\S]*?aria-invalid:border-rose-500/);
    assert.match(ui, /export const selectCls =[\s\S]*?aria-invalid:border-rose-500/);
    assert.match(ui, /disabled:cursor-not-allowed disabled:bg-raised disabled:text-ink-faint/);
    const sprintDialogs = readFileSync(new URL("../features/sprints/sprint-dialogs.tsx", import.meta.url), "utf8");
    assert.match(sprintDialogs, /className=\{`\$\{inputCls\}/);
    assert.match(sprintDialogs, /className=\{`\$\{areaCls\}/);
  });

  it("uses the shared header on common management screens", () => {
    for (const file of [
      "../features/activity/activity-view.tsx",
      "../features/forms/forms-view.tsx",
      "../features/automations/automation-view.tsx",
      "../features/members/members-view.tsx",
      "../features/integrations/integrations-view.tsx",
      "../features/time/time-view.tsx",
      "../features/goals/goals-view.tsx",
      "../features/billing/billing-view.tsx",
      "../features/inbox/inbox-view.tsx",
      "../features/settings/settings-view.tsx",
      "../features/dashboard/dashboard-view.tsx",
      "../features/docs/docs-view.tsx",
      "../features/projects/projects-view.tsx",
      "../features/permissions/permissions-view.tsx",
      "../features/sprints/sprint-backlog-view.tsx",
      "../features/sprints/sprint-board-view.tsx",
      "../features/sprints/sprint-reports-view.tsx",
    ]) {
      assert.match(readFileSync(new URL(file, import.meta.url), "utf8"), /<ScreenHeader/);
    }
  });
});
