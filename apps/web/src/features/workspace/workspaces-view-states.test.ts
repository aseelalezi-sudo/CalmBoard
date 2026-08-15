import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const view = readFileSync(new URL("./workspaces-view.tsx", import.meta.url), "utf8");
const api = readFileSync(new URL("./api.ts", import.meta.url), "utf8");
const dataHook = readFileSync(new URL("./use-workspace-data.ts", import.meta.url), "utf8");
const shell = readFileSync(new URL("../shell/calmboard-app.tsx", import.meta.url), "utf8");

test("workspace switching is serialized and navigation waits for success", () => {
  assert.match(view, /const \[pendingWorkspaceId, setPendingWorkspaceId\]/);
  assert.match(view, /await ctx\.switchWorkspace\(workspace\);\s*ctx\.setActiveView/);
  assert.match(view, /disabled=\{pendingWorkspaceId !== null\}/);
  assert.match(view, /aria-busy=\{pendingWorkspaceId === workspace\.id\}/);
  assert.match(view, /تعذر فتح مساحة العمل/);
});

test("workspace cards preserve brand identity on semantic surfaces", () => {
  assert.match(view, /border border-line bg-raised text-accent/);
  assert.match(view, /backgroundColor: workspace\.color/);
  assert.match(view, /<EntityIcon value=\{workspace\.icon\}/);
  assert.doesNotMatch(view, /className="[^"]*text-white"\s*style=\{\{ backgroundColor: workspace\.color/);
});

test("workspace editing remains open on failure and exposes localized feedback", () => {
  assert.match(view, /await ctx\.updateWorkspace/);
  assert.match(view, /تعذر تحديث مساحة العمل\. حاول مجدداً/);
  assert.match(view, /role="alert"/);
  assert.match(view, /disabled=\{saving\}/);
  assert.doesNotMatch(view, /error instanceof Error \? error\.message/);
});

test("workspace modules fail closed without false empty fallbacks", () => {
  assert.doesNotMatch(api, /optionalJson/);
  assert.match(api, /const permissions = new Set\(authorization\?\.permissions/);
  assert.match(api, /permissions\.has\("audit\.view"\)/);
  assert.match(api, /permissions\.has\("billing\.manage"\)/);
  assert.match(dataHook, /Failed modules were not replaced with empty data/);
  assert.doesNotMatch(dataHook, /const message = error instanceof Error \? error\.message/);
});

test("workspace load errors block stale screens and remain recoverable", () => {
  assert.match(dataHook, /const requestId = \+\+fetchRequestIdRef\.current/);
  assert.match(dataHook, /requestId !== fetchRequestIdRef\.current/);
  assert.match(dataHook, /moduleRequestIdRef\.current/);
  assert.match(shell, /if \(dataError\)/);
  assert.match(shell, /Workspace could not be prepared/);
  assert.match(shell, /onClick=\{\(\) => void reload\(\)\}/);
  assert.ok(shell.indexOf("if (dataError)") < shell.indexOf("if (!currentUser)"));
  assert.doesNotMatch(api, /error\.status === 401 \|\| error\.status === 0/);
});
