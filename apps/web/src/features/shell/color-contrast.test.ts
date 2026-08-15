import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const styles = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
const taskDrawer = readFileSync(new URL("../tasks/task-drawer.tsx", import.meta.url), "utf8");
const goals = readFileSync(new URL("../goals/goals-view.tsx", import.meta.url), "utf8");
const settings = readFileSync(new URL("../settings/settings-view.tsx", import.meta.url), "utf8");
const dashboard = readFileSync(new URL("../dashboard/dashboard-view.tsx", import.meta.url), "utf8");
const docs = readFileSync(new URL("../docs/docs-view.tsx", import.meta.url), "utf8");
const formBuilder = readFileSync(new URL("../forms/form-builder.tsx", import.meta.url), "utf8");
const auth = readFileSync(new URL("../auth/auth-screen.tsx", import.meta.url), "utf8");
const resetPassword = readFileSync(new URL("../auth/reset-password-screen.tsx", import.meta.url), "utf8");
const createModals = readFileSync(new URL("../creation/create-modals.tsx", import.meta.url), "utf8");
const sprintTaskRow = readFileSync(new URL("../sprints/sprint-task-row.tsx", import.meta.url), "utf8");

function rgb(hex: string) {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function luminance(hex: string) {
  const channels = rgb(hex).map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(foreground: string, background: string) {
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

describe("semantic color contrast", () => {
  it("keeps secondary text readable on both application surfaces", () => {
    assert.ok(contrast("#64748b", "#ffffff") >= 4.5);
    assert.ok(contrast("#8b8ba0", "#0e0e16") >= 4.5);
    assert.match(styles, /--color-ink-faint: #64748b/);
    assert.match(styles, /--color-ink-faint: #8b8ba0/);
  });

  it("disables decorative motion when the user requests reduced motion", () => {
    assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
    assert.match(styles, /animation-duration: 0\.01ms !important/);
    assert.match(styles, /transition-duration: 0\.01ms !important/);
  });

  it("uses semantic surfaces and text in the task drawer", () => {
    assert.match(taskDrawer, /border-line bg-surface\/98/);
    assert.match(taskDrawer, /border border-line bg-raised/);
    assert.match(taskDrawer, /font-semibold text-ink/);
    assert.doesNotMatch(taskDrawer, /(?:text|bg|border)-(?:violet|cyan)-/);
  });

  it("uses theme tokens for goal cards and workspace settings", () => {
    assert.match(goals, /border border-line bg-raised\/60/);
    assert.match(goals, /text-ink-faint/);
    assert.match(settings, /<SegmentedTabs/);
    assert.match(settings, /className=\{inputCls\}/);
    assert.match(settings, /className=\{areaCls\}/);
    assert.match(settings, /border border-line/);
  });

  it("does not override shared cards with separate light and dark surfaces", () => {
    for (const file of [
      "../activity/activity-view.tsx",
      "../forms/forms-view.tsx",
      "../integrations/integrations-view.tsx",
      "../members/members-view.tsx",
      "../billing/billing-view.tsx",
      "../time/time-view.tsx",
    ]) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      assert.doesNotMatch(source, /<Card[^\n>]*bg-white/);
    }
  });

  it("uses shared surfaces and controls in dashboard, docs, and form builder", () => {
    assert.match(dashboard, /<ScreenToolbar/);
    assert.match(dashboard, /border border-line bg-surface/);
    assert.match(docs, /border-b border-line bg-raised\/60/);
    assert.match(docs, /className=\{selectCls\}/);
    assert.match(formBuilder, /border border-line bg-surface/);
    assert.match(formBuilder, /className=\{`\$\{selectCls\}/);
    assert.match(formBuilder, /aria-label=\{t\("نقل الحقل إلى الأعلى"/);
  });

  it("keeps shared UI primitives on semantic theme tokens", () => {
    const ui = readFileSync(new URL("../../components/ui.tsx", import.meta.url), "utf8");
    assert.match(ui, /border border-line bg-surface\/80 text-ink-soft/);
    assert.match(ui, /rounded-2xl border border-line bg-surface\/80/);
    assert.match(ui, /border border-line bg-surface\/98/);
    assert.match(ui, /h-1\.5 w-full overflow-hidden rounded-full bg-line/);
    assert.match(ui, /uppercase tracking-wider text-ink-faint/);
  });

  it("uses shared controls across authentication, creation, and sprint movement", () => {
    assert.match(auth, /className=\{`\$\{inputCls\} h-11 text-sm`\}/);
    assert.match(auth, /<Btn[\s\S]*?variant="outline"[\s\S]*?oauthStartUrl/);
    assert.match(resetPassword, /className=\{`\$\{inputCls\} h-11 text-sm`\}/);
    assert.match(createModals, /border border-line bg-surface/);
    assert.match(sprintTaskRow, /className=\{`\$\{selectCls\}/);
    assert.doesNotMatch(auth, /focus:border-violet/);
    assert.doesNotMatch(createModals, /focus(?:-within)?:border-indigo/);
  });
});
