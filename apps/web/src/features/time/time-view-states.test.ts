import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const view = readFileSync(new URL("./time-view.tsx", import.meta.url), "utf8");
const operations = readFileSync(new URL("./use-timesheet-operations.ts", import.meta.url), "utf8");

test("time tracking derives the visible section from explicit permissions", () => {
  assert.match(view, /const canManageTime = ctx\.can\("time_logs\.manage"\)/);
  assert.match(view, /const canReviewTimesheets = ctx\.can\("timesheets\.review"\)/);
  assert.match(view, /const activeSection =/);
  assert.match(view, /tone="permission"/);
  assert.match(view, /canManageTime \? \[\{ value: "timer"/);
});

test("timer remains active until its entry is persisted", () => {
  assert.match(view, /Promise\.resolve\(ctx\.logTime/);
  assert.match(view, /\.then\(\(\) => ctx\.setTimerRunning\(false\)\)/);
  assert.match(view, /ما زال المؤقت يعمل/);
  assert.match(view, /disabled=\{ctx\.timerRunning \|\| savingTimer\}/);
  assert.match(view, /aria-busy=\{savingTimer\}/);
});

test("timesheet mutations are serialized and failures stay localized", () => {
  assert.match(view, /const \[pendingTimesheetId, setPendingTimesheetId\]/);
  assert.match(view, /const \[pendingTimesheetAction, setPendingTimesheetAction\]/);
  assert.match(view, /await ctx\.submitTimesheet/);
  assert.match(view, /await ctx\.reviewTimesheet/);
  assert.match(operations, /تعذر إرسال الجدول\. حاول مجدداً/);
  assert.match(operations, /تعذر تحديث الجدول\. حاول مجدداً/);
  assert.doesNotMatch(operations, /error instanceof Error \? error\.message/);
});

test("time lists use semantic surfaces, localized counts, and complete empty states", () => {
  assert.match(view, /fmtNumber\(timesheet\.entriesCount, ctx\.locale\)/);
  assert.match(view, /fmtNumber\(timesheet\.tasksCount, ctx\.locale\)/);
  assert.match(view, /لا توجد سجلات وقت/);
  assert.match(view, /divide-y divide-line/);
  assert.doesNotMatch(view, /text-slate-|dark:text-zinc-|divide-slate-/);
});
