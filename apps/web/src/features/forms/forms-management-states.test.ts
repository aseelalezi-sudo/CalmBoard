import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const view = readFileSync(new URL("./forms-view.tsx", import.meta.url), "utf8");
const builder = readFileSync(new URL("./form-builder.tsx", import.meta.url), "utf8");
const operations = readFileSync(new URL("../workspace/use-workspace-operations.ts", import.meta.url), "utf8");

test("form builder waits for persistence and remains open on failure", () => {
  assert.match(builder, /onSave: \(input: FormInput\) => void \| Promise<void>/);
  assert.match(builder, /const \[saving, setSaving\]/);
  assert.match(builder, /await onSave\(/);
  assert.match(builder, /catch \{/);
  assert.match(builder, /تعذر حفظ النموذج/);
  assert.match(builder, /aria-busy=\{saving\}/);
  assert.match(builder, /await onSave\([^;]+;\s*onClose\(\)/);
});

test("form status restores the optimistic value when persistence fails", () => {
  assert.match(operations, /await updateFormStatusRecord/);
  assert.match(operations, /isActive: !isActive/);
  assert.match(operations, /تعذر تحديث حالة النموذج/);
  assert.match(view, /const \[pendingFormId, setPendingFormId\]/);
  assert.match(view, /await ctx\.toggleForm/);
});

test("forms expose only authorized controls and announce clipboard outcomes", () => {
  assert.match(view, /const canManageForms = ctx\.can\("forms\.manage"\)/);
  assert.match(view, /canManageForms \? \(/);
  assert.match(view, /navigator\.clipboard\.writeText/);
  assert.match(view, /تم نسخ رابط النموذج/);
  assert.match(view, /تعذر نسخ الرابط/);
  assert.match(view, /fmtNumber\(form\.responses, ctx\.locale\)/);
  assert.doesNotMatch(view, /text-slate-|dark:text-zinc-/);
});
