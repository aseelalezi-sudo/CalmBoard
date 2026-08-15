import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const checklist = readFileSync(new URL("./onboarding-checklist.tsx", import.meta.url), "utf8");
const shell = readFileSync(new URL("../shell/calmboard-app.tsx", import.meta.url), "utf8");

test("derived creation steps refresh from persisted workspace data", () => {
  assert.match(checklist, /progressKey: string/);
  assert.match(checklist, /\[scope, props\.progressKey, retryKey\]/);
  assert.match(shell, /progressKey=\{`\$\{projects\.length\}:\$\{tasks\.length\}:\$\{invitations\.length\}`\}/);
  assert.match(checklist, /step !== "board_explored"/);
  assert.doesNotMatch(
    checklist,
    /completedSteps: \[\.\.\.progress\.completedSteps, step\][\s\S]*?step !== "board_explored"/,
  );
});

test("onboarding distinguishes initial loading and recoverable load failure", () => {
  assert.match(checklist, /const \[loading, setLoading\]/);
  assert.match(checklist, /const \[loadError, setLoadError\]/);
  assert.match(checklist, /tone="loading"/);
  assert.match(checklist, /tone="error"/);
  assert.match(checklist, /setRetryKey\(\(value\) => value \+ 1\)/);
});

test("onboarding actions respect permissions and announce mutation failures", () => {
  assert.match(checklist, /canCreateProject: boolean/);
  assert.match(checklist, /canCreateTask: boolean/);
  assert.match(checklist, /canInvite: boolean/);
  assert.match(
    checklist,
    /allSteps\.filter\(\(step\) => step\.available \|\| progress\.completedSteps\.includes\(step\.id\)\)/,
  );
  assert.match(checklist, /role="alert"/);
  assert.match(checklist, /aria-busy=\{pending\}/);
  assert.match(shell, /canCreateProject=\{can\("projects\.create"\)\}/);
});

test("onboarding uses semantic surfaces and localized progress counts", () => {
  assert.match(checklist, /border border-accent\/25 bg-accent\/5/);
  assert.match(checklist, /fmtNumber\(completed/);
  assert.match(checklist, /min-h-10/);
  assert.doesNotMatch(checklist, /text-slate-|dark:text-zinc-|border-indigo-|bg-indigo-/);
});
