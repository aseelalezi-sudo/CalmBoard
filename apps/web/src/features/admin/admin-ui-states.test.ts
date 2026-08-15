import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const hooks = readFileSync(new URL("./hooks.ts", import.meta.url), "utf8");
const controls = readFileSync(new URL("../../components/admin-controls.tsx", import.meta.url), "utf8");
const security = readFileSync(new URL("../../components/security-test-runner.tsx", import.meta.url), "utf8");
const page = readFileSync(new URL("../../app/admin/page.tsx", import.meta.url), "utf8");
const errorPage = readFileSync(new URL("../../app/admin/error.tsx", import.meta.url), "utf8");
const loadingPage = readFileSync(new URL("../../app/admin/loading.tsx", import.meta.url), "utf8");

test("admin queue operations are serialized and failures do not expose server details", () => {
  assert.match(hooks, /const \[pendingAction, setPendingAction\]/);
  assert.match(hooks, /const actionRef = useRef\(false\)/);
  assert.match(hooks, /if \(actionRef\.current\) return false/);
  assert.match(hooks, /تعذر تنفيذ إجراء الطابور/);
  assert.doesNotMatch(hooks, /cause instanceof Error \? cause\.message/);
  assert.doesNotMatch(controls, /redis\?\.error/);
  assert.doesNotMatch(controls, />\s*\{job\.error\}\s*</);
});

test("destructive cleanup is confirmed and queue failures remain retryable", () => {
  assert.match(controls, /await confirmAction\(/);
  assert.match(controls, /tone: "danger"/);
  assert.match(controls, /if \(confirmed\) await act\("trigger_cleanup"\)/);
  assert.match(controls, /role="alert"/);
  assert.match(controls, /onClick=\{\(\) => void reload\(\)\}/);
});

test("queue jobs have dedicated mobile and desktop layouts with localized values", () => {
  assert.match(controls, /space-y-3 md:hidden/);
  assert.match(controls, /hidden overflow-x-auto[\s\S]*md:block/);
  assert.match(controls, /fmtNumber\(job\.attempts, "ar"\)/);
  assert.match(controls, /مللي ثانية/);
  assert.match(controls, /مكتملة/);
});

test("security report is Arabic-first and exposes safe operational states", () => {
  assert.match(hooks, /تعذر تشغيل فحص الأمان/);
  assert.match(hooks, /if \(runRef\.current\) return false/);
  assert.match(hooks, /setReport\(null\)/);
  assert.match(security, /aria-busy=\{loading\}/);
  assert.match(security, /fmtNumber\(report\.summary\.passed, "ar"\)/);
  assert.match(security, /testResult\.details_ar/);
  assert.doesNotMatch(security, /testResult\.details_en/);
  assert.match(security, /الأمان والعزل/);
});

test("admin loads ignore obsolete responses and unmounted updates", () => {
  assert.match(hooks, /const requestId = \+\+requestIdRef\.current/);
  assert.match(hooks, /requestId !== requestIdRef\.current/);
  assert.match(hooks, /mountedRef\.current = false/);
  assert.match(hooks, /requestIdRef\.current \+= 1/);
});

test("admin route has recoverable loading and error boundaries", () => {
  assert.match(loadingPage, /tone="loading"/);
  assert.match(errorPage, /onClick=\{reset\}/);
  assert.match(errorPage, /إعادة المحاولة/);
  assert.doesNotMatch(errorPage, /error\.message/);
});

test("admin overview uses localized metrics without duplicate English labels", () => {
  assert.match(page, /fmtNumber\(/);
  assert.match(page, /غير معروفة/);
  assert.doesNotMatch(page, /\{s\.en\}/);
});
