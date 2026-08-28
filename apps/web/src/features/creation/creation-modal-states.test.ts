import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const modals = readFileSync(new URL("./create-modals.tsx", import.meta.url), "utf8");
const iconPicker = readFileSync(new URL("../../components/icon-picker.tsx", import.meta.url), "utf8");
const taskOperations = readFileSync(new URL("../tasks/use-task-operations.ts", import.meta.url), "utf8");
const types = readFileSync(new URL("../../lib/types.ts", import.meta.url), "utf8");

test("workspace creation is serialized and hides technical failures", () => {
  assert.match(modals, /onClose=\{\(\) => !submitting && onClose\(\)\}/);
  assert.match(modals, /await onCreate\(\{/);
  assert.match(modals, /تعذر إنشاء مساحة العمل\. تحقق من الاتصال/);
  assert.match(modals, /aria-busy=\{submitting\}/);
  assert.doesNotMatch(modals, /submitError instanceof Error/);
});

test("task creation waits for persistence and stays open on failure", () => {
  assert.match(types, /createTask: \(data: Partial<Task> & \{ title: string \}\) => boolean \| Promise<boolean>/);
  assert.match(modals, /const created = await onCreate\(\{/);
  assert.match(modals, /if \(!created\) \{/);
  assert.match(modals, /تعذر إنشاء المهمة\. راجع البيانات وحاول مجدداً/);
  assert.match(taskOperations, /if \(!created\.id\) throw new Error/);
  assert.match(taskOperations, /return true/);
  assert.match(taskOperations, /return false/);
});

test("project creation is localized, failure-safe, and does not reload the application", () => {
  assert.match(modals, /const PROJECT_TEMPLATES =/);
  assert.match(modals, /Standard blank/);
  assert.match(modals, /Quarterly roadmap/);
  assert.match(modals, /if \(!r\.id\) throw new Error/);
  assert.match(modals, /تعذر إنشاء المشروع\. تحقق من البيانات والاتصال/);
  assert.doesNotMatch(modals, /window\.location\.reload/);
});

test("creation controls remain inside the viewport and restore emoji picker focus", () => {
  assert.match(iconPicker, /triggerRef\.current\?\.focus\(\)/);
  assert.match(iconPicker, /grid grid-cols-6/);
  assert.match(modals, /flex flex-col-reverse gap-2[^"]*sm:flex-row/);
});

test("document creation stays open on failure and exposes accessible icon choices", () => {
  assert.match(modals, /if \(!r\.id\) throw new Error\("document_not_created"\)/);
  assert.match(modals, /تعذر إنشاء المستند\. تحقق من الاتصال/);
  assert.match(modals, /aria-label=\{t\(`اختيار الأيقونة/);
  assert.match(modals, /peer-checked:border-accent peer-checked:bg-accent-soft/);
});

test("goal creation validates ownership, hierarchy, and measurements before persistence", () => {
  assert.match(modals, /type === "key_result" && !parentId/);
  assert.match(modals, /اربط النتيجة الرئيسية بهدف أعلى/);
  assert.match(modals, /weight <= 0 \|\| weight > 100/);
  assert.match(modals, /startValue === targetValue/);
  assert.match(modals, /if \(!r\.id\) throw new Error\("goal_not_created"\)/);
});

test("automation creation validates paired conditions and uses semantic workflow surfaces", () => {
  assert.match(modals, /conditionField && !conditionValue/);
  assert.match(modals, /أدخل قيمة للشرط المحدد/);
  assert.match(modals, /if \(!r\.id\) throw new Error\("automation_not_created"\)/);
  assert.match(modals, /border border-accent\/25 bg-accent-soft/);
});

test("invitation creation localizes roles and never exposes the server error payload", () => {
  assert.match(modals, /const INVITATION_ROLES =/);
  assert.match(modals, /مسؤول/);
  assert.match(modals, /مشاهد/);
  assert.match(modals, /if \(r\.error\) throw new Error/);
  assert.match(modals, /تعذر إرسال الدعوة\. تحقق من البريد والاتصال/);
  assert.doesNotMatch(modals, /notify\(r\.error/);
});

test("saved views hide technical filter keys and serialize persistence", () => {
  assert.match(modals, /const activeFilterCount = Object\.values\(taskFilter\)\.filter\(Boolean\)\.length/);
  assert.match(modals, /localizedActiveFilterCount/);
  assert.match(modals, /if \(!r\.id\) throw new Error\("saved_view_not_created"\)/);
  assert.match(modals, /تعذر حفظ العرض\. تحقق من الاتصال/);
  assert.doesNotMatch(modals, /\.map\(\(\[k, v\]\) => `\$\{k\}=\$\{v\}`\)/);
});
