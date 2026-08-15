import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const backlog = readFileSync(new URL("./sprint-backlog-view.tsx", import.meta.url), "utf8");
const board = readFileSync(new URL("./sprint-board-view.tsx", import.meta.url), "utf8");
const section = readFileSync(new URL("./sprint-section.tsx", import.meta.url), "utf8");
const dialogs = readFileSync(new URL("./sprint-dialogs.tsx", import.meta.url), "utf8");
const taskRow = readFileSync(new URL("./sprint-task-row.tsx", import.meta.url), "utf8");

test("sprint board distinguishes permission, loading, failure, and empty states", () => {
  assert.match(board, /ctx\.can\("sprints\.view"\)/);
  assert.match(board, /tone="permission"/);
  assert.match(board, /tone="loading"/);
  assert.match(board, /tone="error"/);
  assert.match(board, /onClick=\{\(\) => void refetch\(\)\}/);
  assert.match(board, /لا يوجد سبرنت نشط/);
});

test("sprint planning serializes lifecycle and task movement operations", () => {
  assert.match(backlog, /operationLockRef = useRef\(false\)/);
  assert.match(backlog, /if \(operationLockRef\.current\) return false/);
  assert.match(backlog, /const completed = await runExclusive/);
  assert.match(backlog, /pending=\{busy \|\| operations\.pendingAction\}/);
  assert.match(section, /const disabled = readOnly \|\| historical \|\| pending/);
});

test("sprint failures are localized and never expose raw server messages", () => {
  assert.match(backlog, /تعذر تنفيذ إجراء السبرنت/);
  assert.doesNotMatch(backlog, /error instanceof Error[\s\S]{0,80}error\.message/);
  assert.match(backlog, /ctx\.setTaskSprintMembership\(task\.id, expectedFromSprintId\)/);
});

test("sprint dialogs remain stable and disable mutable fields while saving", () => {
  assert.match(dialogs, /onClose=\{pending \? \(\) => undefined : onClose\}/);
  assert.match(dialogs, /disabled=\{pending\}/);
  assert.match(dialogs, /aria-invalid=\{Boolean\(error && !name\.trim\(\)\)\}/);
  assert.match(dialogs, /min-h-10 items-center/);
});

test("sprint planning uses localized metrics and semantic task surfaces", () => {
  assert.match(section, /fmtNumber\(summary\.taskCount, ctx\.locale\)/);
  assert.match(dialogs, /fmtNumber\(summary\.completedCount, ctx\.locale\)/);
  assert.match(taskRow, /fmtNumber\(task\.storyPoints, ctx\.locale\)/);
  assert.match(taskRow, /border-line bg-raised/);
  assert.match(backlog, /`السبرنت \$\{fmtNumber/);
});
