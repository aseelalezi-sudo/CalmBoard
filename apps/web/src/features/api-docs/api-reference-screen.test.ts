import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const hook = readFileSync(new URL("./use-openapi-document.ts", import.meta.url), "utf8");
const page = readFileSync(new URL("../../app/api-reference/page.tsx", import.meta.url), "utf8");

test("API reference loading is recoverable and ignores obsolete requests", () => {
  assert.match(hook, /catch \{/);
  assert.match(hook, /تعذر تحميل مرجع واجهة البرمجة/);
  assert.match(hook, /reload: load/);
  assert.match(hook, /requestId !== requestIdRef\.current/);
  assert.match(page, /tone="error"/);
  assert.match(page, /onClick=\{\(\) => void reload\(\)\}/);
});

test("API reference exposes every documented HTTP operation instead of only the first method", () => {
  assert.match(page, /Object\.entries\(methods\)\.map/);
  assert.match(page, /item\.path === selection\.path && item\.method === selection\.method/);
  assert.match(page, /aria-pressed=\{selected\}/);
});

test("API reference uses real response descriptions and no simulated operational payloads", () => {
  assert.match(page, /Object\.entries\(operation\.responses \?\? \{\}\)/);
  assert.match(page, /response\.description/);
  assert.doesNotMatch(page, /CalmBoard Engineering/);
  assert.doesNotMatch(page, /تم تنفيذ العملية وحفظ التغييرات في PostgreSQL/);
});

test("API reference is mobile-safe and clipboard outcomes are announced", () => {
  assert.match(page, /grid gap-2 md:hidden/);
  assert.match(page, /hidden overflow-x-auto[\s\S]*md:block/);
  assert.match(page, /await navigator\.clipboard\.writeText/);
  assert.match(page, /تعذر نسخ ملف OpenAPI/);
  assert.match(page, /max-w-full overflow-x-auto/);
});
