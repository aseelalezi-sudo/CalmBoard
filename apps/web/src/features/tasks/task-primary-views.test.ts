import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const views = readFileSync(new URL("./task-views.tsx", import.meta.url), "utf8");
const operations = readFileSync(new URL("./use-task-operations.ts", import.meta.url), "utf8");

test("My Work uses only assigned tasks and real calendar sections", () => {
  assert.match(
    views,
    /ctx\.tasks\.filter\(\(task\) => !task\.deletedAt && isTaskAssignedTo\(task, ctx\.currentUser\?\.id\)\)/,
  );
  assert.match(views, /const dueToday = open[\s\S]*?\.filter/);
  assert.match(views, /const overdue = open[\s\S]*?\.filter/);
  assert.match(views, /const completed = mine[\s\S]*?\.filter/);
  assert.doesNotMatch(views, /5 أيام متتالية|5 days in a row|Array\.from\(\{ length: 7 \}\)/);
  assert.match(views, /الأرقام مشتقة من المهام المحمّلة والمسندة إليك/);
});

test("My Work serializes completion and exposes recoverable failures", () => {
  assert.match(views, /const \[pendingTaskId, setPendingTaskId\]/);
  assert.match(views, /saved = await ctx\.updateTask/);
  assert.match(views, /aria-busy=\{pendingTaskId === task\.id\}/);
  assert.match(views, /تعذر تحديث المهمة\. بقيت حالتها السابقة/);
  assert.match(views, /role="alert"/);
  assert.match(views, /tone="permission"/);
});

test("the task board uses accessible controls, localized limits, and permission-safe empty columns", () => {
  assert.match(views, /aria-label=\{ctx\.t\(`اسحب/);
  assert.match(views, /hover:text-accent hover:underline focus-ring/);
  assert.match(views, /fmtNumber\(total, ctx\.locale\)/);
  assert.match(views, /tasks\.length === 0 && !ctx\.can\("tasks\.create"\)/);
  assert.match(views, /loadMoreStatus\(status\)\.catch\(\(\) => undefined\)/);
  assert.match(views, /تعذر تحميل لوحة المهام/);
});

test("the list has a native phone layout and protects inline mutations", () => {
  assert.match(views, /space-y-3 md:hidden/);
  assert.match(views, /hidden overflow-hidden md:block/);
  assert.match(views, /disabled=\{!ctx\.can\("tasks\.update"\)\}/);
  assert.match(views, /normalizedTaskProgress\(task\)/);
  assert.match(views, /fmtNumber\(progress, ctx\.locale\)/);
  assert.match(views, /تعذر تحميل قائمة المهام/);
});

test("task movement and WIP failures hide technical server messages", () => {
  assert.match(operations, /تعذر نقل المهمة\. أُعيد ترتيب اللوحة السابق/);
  assert.match(operations, /تعذر حفظ حد العمل الجاري\. حاول مجدداً/);
  assert.match(operations, /تعذر تحديث المهمة الفرعية\. تمت استعادة حالتها/);
  assert.match(operations, /تعذر رفع المرفق\. تحقق من الملف والاتصال/);
  assert.doesNotMatch(operations, /error instanceof Error \? error\.message/);
});
