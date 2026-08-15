import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const verification = readFileSync(new URL("./verify-email-screen.tsx", import.meta.url), "utf8");
const reset = readFileSync(new URL("./reset-password-screen.tsx", import.meta.url), "utf8");

test("account action cards expose semantic status and submit external forms correctly", () => {
  assert.match(verification, /role=\{status === "error" \? "alert" : "status"\}/);
  assert.match(verification, /aria-live=\{status === "error" \? "assertive" : "polite"\}/);
  assert.match(verification, /type=\{actionForm \? "submit" : "button"\}/);
  assert.match(verification, /form=\{actionForm\}/);
  assert.match(verification, /disabled=\{status === "pending" \|\| actionDisabled\}/);
  assert.match(verification, /min-h-dvh/);
  assert.doesNotMatch(verification, /dark:bg-\[#101019\]/);
});

test("password reset validates token, length, and confirmation before mutation", () => {
  assert.match(reset, /id="reset-password-form"/);
  assert.match(reset, /actionForm="reset-password-form"/);
  assert.match(reset, /password\.length < 12 \|\| password\.length > 128/);
  assert.match(reset, /password !== confirmation/);
  assert.match(reset, /autoComplete="new-password"/);
  assert.match(reset, /htmlFor="password-confirmation"/);
  assert.match(reset, /actionDisabled=\{!token \|\| !password \|\| !confirmation\}/);
});

test("standalone recovery screens honor the interface locale and direction", () => {
  assert.match(verification, /useUiStore\(\(state\) => state\.locale\)/);
  assert.match(verification, /dir=\{locale === "ar" \? "rtl" : "ltr"\}/);
  assert.match(verification, /t\("التحقق من البريد", "Verify email"\)/);
  assert.match(reset, /useUiStore\(\(state\) => state\.locale\)/);
  assert.match(reset, /t\("إعادة تعيين كلمة المرور", "Reset password"\)/);
  assert.match(reset, /t\("كلمتا المرور غير متطابقتين\."/);
});
