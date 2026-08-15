import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const view = readFileSync(new URL("./goals-view.tsx", import.meta.url), "utf8");
const operations = readFileSync(new URL("../workspace/use-content-operations.ts", import.meta.url), "utf8");

test("goal mutations remain open and selected until persistence succeeds", () => {
  assert.match(view, /const \[pendingAction, setPendingAction\]/);
  assert.match(view, /await operation\(\)/);
  assert.match(view, /onSuccess\?\.\(\)/);
  assert.match(view, /aria-busy=\{pendingAction === `\$\{selectedGoal\.id\}:checkin`\}/);
  assert.match(view, /aria-busy=\{pendingAction === `\$\{goal\.id\}:link`\}/);
  assert.match(view, /aria-busy=\{pendingAction === `\$\{goal\.id\}:\$\{task\.id\}:unlink`\}/);
});

test("goal operation failures propagate after a localized notification", () => {
  for (const message of ["تعذر تسجيل تقدم الهدف", "تعذر ربط المهمة بالنتيجة الرئيسية", "تعذر إزالة ارتباط المهمة"]) {
    assert.match(operations, new RegExp(message));
  }
  const goalSection = operations.slice(
    operations.indexOf("const addGoalCheckin"),
    operations.indexOf("const toggleAutomation"),
  );
  assert.equal((goalSection.match(/throw error;/g) ?? []).length, 3);
});

test("goal controls are hidden by authorization and validate contribution weights", () => {
  assert.match(view, /const canManageGoals = ctx\.can\("goals\.manage"\)/);
  assert.match(view, /actions=\{\s*canManageGoals \? \(/);
  assert.match(view, /\{canManageGoals && \(/);
  assert.match(view, /!Number\.isFinite\(taskWeights\[goal\.id\] \?\? 1\)/);
  assert.match(view, /\(taskWeights\[goal\.id\] \?\? 1\) < 0\.1/);
  assert.match(view, /\(taskWeights\[goal\.id\] \?\? 1\) > 100/);
});

test("goal measurements and history use localized values and semantic surfaces", () => {
  assert.match(view, /fmtNumber\(goal\.currentValue, ctx\.locale\)/);
  assert.match(view, /new Intl\.NumberFormat/);
  assert.match(view, /fmtNumber\(goal\.progress, ctx\.locale\)/);
  assert.match(view, /dateTime=\{new Date\(checkin\.date\)\.toISOString\(\)\}/);
  assert.doesNotMatch(view, /🎯|text-slate-|dark:text-zinc-|border-slate-|bg-slate-/);
});
