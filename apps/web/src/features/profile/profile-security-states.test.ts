import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const api = readFileSync(new URL("./api.ts", import.meta.url), "utf8");
const hook = readFileSync(new URL("./use-profile-security.ts", import.meta.url), "utf8");
const view = readFileSync(new URL("../../components/profile-security.tsx", import.meta.url), "utf8");

test("profile security fails closed instead of replacing failed loads with empty data", () => {
  assert.match(api, /await Promise\.all\(/);
  assert.doesNotMatch(api, /function optional/);
  assert.match(hook, /setLoadError\("تعذر تحميل إعدادات الحساب والأمان/);
  assert.match(view, /tone="error"/);
  assert.match(view, /onClick=\{\(\) => void reload\(\)\}/);
});

test("profile security mutations are serialized and preference failures roll back", () => {
  assert.match(hook, /pendingActionRef\.current/);
  assert.match(hook, /if \(pendingActionRef\.current\) return null/);
  assert.match(hook, /const previous = preferences/);
  assert.match(hook, /setPreferences\(previous\)/);
  assert.match(hook, /تمت استعادة الإعدادات السابقة/);
});

test("session revocation is named, confirmed, and hides technical failures", () => {
  assert.match(view, /title: ctx\.t\("إنهاء الجلسات الأخرى"/);
  assert.match(view, /title: ctx\.t\("إنهاء كل الجلسات"/);
  assert.match(hook, /تعذر إنهاء الجلسات\. لم تتغير الجلسات النشطة/);
  assert.doesNotMatch(view, /cause instanceof Error \? cause\.message/);
});

test("account security uses shared navigation and permission-aware branch management", () => {
  assert.match(view, /<ScreenHeader/);
  assert.match(view, /<SegmentedTabs/);
  assert.match(view, /ctx\.can\("branches\.manage"\)/);
  assert.match(view, /disabled=\{pendingAction !== null\}/);
  assert.doesNotMatch(view, /عرض الفرع/);
});

test("security metrics, sessions, and surfaces follow the localized semantic contract", () => {
  assert.match(view, /fmtNumber\(mfa\.recoveryCodesRemaining, ctx\.locale\)/);
  assert.match(view, /toLocaleTimeString\(ctx\.locale === "ar" \? "ar-u-nu-latn" : "en-US"/);
  assert.match(view, /border-line bg-raised/);
  assert.doesNotMatch(view, /🚫|📱|💻|📍|🏢/);
});
