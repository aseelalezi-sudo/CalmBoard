import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./advanced-task-table.tsx", import.meta.url), "utf8");

test("advanced task table uses localized dense surfaces and a dismissible column menu", () => {
  assert.match(source, /fmtMinutes\(value \* 60, ctx\.locale\)/);
  assert.match(source, /fmtNumber\(value, ctx\.locale\)/);
  assert.match(source, /document\.addEventListener\("pointerdown", handlePointerDown\)/);
  assert.match(source, /event\.key === "Escape"/);
  assert.match(source, /columnsTriggerRef\.current\?\.focus/);
  assert.match(source, /sticky top-0 z-20 flex border-b border-line bg-raised/);
  assert.match(source, /max-w-\[calc\(100%-1rem\)\]/);
  assert.match(source, /className=\{`\$\{selectCls\}/);
  assert.doesNotMatch(source, /`\$\{value\}h`/);
});
