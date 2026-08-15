import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./auth-screen.tsx", import.meta.url), "utf8");
const providers = readFileSync(new URL("../../app/providers.tsx", import.meta.url), "utf8");

test("authentication modes use accessible tabs and dedicated recovery context", () => {
  assert.match(source, /<SegmentedTabs/);
  assert.match(source, /label=\{t\("طريقة المصادقة", "Authentication method"\)\}/);
  assert.match(source, /mode !== "forgot" &&/);
  assert.match(source, /استعادة كلمة المرور/);
  assert.match(source, /التحقق بخطوتين/);
  assert.match(source, /inputMode="numeric"/);
  assert.match(source, /autoFocus/);
});

test("registration confirms passwords and authentication feedback is announced", () => {
  assert.match(source, /data\.get\("passwordConfirmation"\)/);
  assert.match(source, /كلمتا المرور غير متطابقتين/);
  assert.match(source, /name="passwordConfirmation"/);
  assert.match(source, /role="alert"/);
  assert.match(source, /role="status"\s*aria-live="polite"/);
  assert.match(source, /disabled=\{pending\}/);
  assert.match(source, /min-h-dvh/);
});

test("authentication follows the persisted interface locale and direction", () => {
  assert.match(source, /useUiStore\(\(state\) => state\.locale\)/);
  assert.match(source, /dir=\{locale === "ar" \? "rtl" : "ltr"\}/);
  assert.match(source, /t\("تسجيل الدخول", "Sign in"\)/);
  assert.match(source, /t\("إنشاء حساب", "Create account"\)/);
  assert.match(source, /t\("تعذر إكمال المصادقة", "Authentication could not be completed"\)/);
  assert.match(providers, /hydratePreferences\(\)/);
});
