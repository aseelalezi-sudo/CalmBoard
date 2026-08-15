import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const hook = readFileSync(new URL("./use-dashboard-layout.ts", import.meta.url), "utf8");
const view = readFileSync(new URL("./dashboard-view.tsx", import.meta.url), "utf8");

test("dashboard layout fails closed until a trusted server version is loaded", () => {
  assert.match(hook, /const \[loadError, setLoadError\]/);
  assert.match(hook, /if \(!activeOrg \|\| !activeWorkspace \|\| loading \|\| loadError\) return/);
  assert.match(hook, /setLoadError\(\s*readableError/);
  assert.doesNotMatch(hook, /catch[\s\S]{0,220}setWidgets\(defaultDashboardWidgets\)/);
  assert.doesNotMatch(hook, /catch[\s\S]{0,220}versionRef\.current = 0/);
  assert.match(view, /tone="error"/);
  assert.match(view, /onClick=\{\(\) => void retry\(\)\}/);
});

test("dashboard customization is serialized, keyboard navigable, and reset with confirmation", () => {
  assert.match(view, /<SegmentedTabs/);
  assert.match(view, /label=\{ctx\.t\("نطاق التقرير"/);
  assert.match(view, /disabled=\{loading \|\| Boolean\(loadError\) \|\| saving\}/);
  assert.match(view, /await confirmAction\(/);
  assert.match(view, /tone: "warning"/);
  assert.match(view, /disabled=\{saving\}/);
});
