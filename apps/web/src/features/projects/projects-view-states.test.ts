import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const view = readFileSync(new URL("./projects-view.tsx", import.meta.url), "utf8");

test("project cards and rows expose native keyboard-safe open controls", () => {
  assert.match(view, /<button\s+type="button"\s+onClick=\{\(event\) => \{/);
  assert.match(view, /event\.stopPropagation\(\);\s*openProject\(project\)/);
  assert.match(view, /hover:text-accent hover:underline focus-ring/);
  assert.doesNotMatch(view, /role="link"/);
});

test("project progress and counts are normalized and localized", () => {
  assert.match(view, /function normalizedProgress/);
  assert.match(view, /function progressLabel/);
  assert.match(view, /fmtNumber\(project\.completedTasks \?\? 0, ctx\.locale\)/);
  assert.match(view, /fmtNumber\(project\.memberCount \?\? 0, ctx\.locale\)/);
  assert.doesNotMatch(view, /\{project\.progress\}%/);
  assert.doesNotMatch(view, /width: `\$\{project\.progress\}%`/);
});

test("project identity uses a readable semantic icon surface", () => {
  assert.match(view, /function ProjectIconTile/);
  assert.match(view, /bg-accent-soft text-accent/);
  assert.match(view, /backgroundColor: project\.color/);
  assert.doesNotMatch(view, /text-white[^"]*"\s*style=\{\{ backgroundColor: project\.color/);
});

test("project mutations and form validation fail safely", () => {
  assert.match(view, /تعذر تنفيذ الإجراء على المشروع\. حاول مجدداً/);
  assert.match(view, /تعذر تحديث المشروع\. حاول مجدداً/);
  assert.match(view, /تعذر حذف المشروع\. حاول مجدداً/);
  assert.match(view, /يجب ألا يسبق تاريخ الانتهاء تاريخ البدء/);
  assert.match(view, /progress < 0 \|\| progress > 100/);
  assert.match(view, /role="alert"/);
  assert.doesNotMatch(view, /error instanceof Error \? error\.message/);
});
