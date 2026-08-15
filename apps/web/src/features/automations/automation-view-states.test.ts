import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const view = readFileSync(new URL("./automation-view.tsx", import.meta.url), "utf8");
const operations = readFileSync(new URL("../workspace/use-content-operations.ts", import.meta.url), "utf8");

test("automation UI does not expose a fake test run that mutates a real task", () => {
  assert.doesNotMatch(view, /useAutomationTest|testRun|تشغيل تجريبي|Test Run Now|updateTaskRecord/);
  assert.equal(existsSync(new URL("./use-automation-test.ts", import.meta.url)), false);
});

test("automation toggles are serialized and restore state on failure", () => {
  assert.match(view, /const \[pendingAutomationId, setPendingAutomationId\]/);
  assert.match(view, /await ctx\.toggleAutomation/);
  assert.match(view, /disabled=\{pendingAutomationId !== null\}/);
  assert.match(view, /role="status"/);
  const toggleSection = operations.slice(operations.indexOf("const toggleAutomation"));
  assert.match(toggleSection, /enabled: !enabled/);
  assert.match(toggleSection, /تعذر تحديث قاعدة الأتمتة/);
  assert.match(toggleSection, /throw error/);
});

test("automation controls are permission-aware and empty states are actionable only when authorized", () => {
  assert.match(view, /const canManageAutomations = ctx\.can\("automations\.manage"\)/);
  assert.match(view, /actions=\{\s*canManageAutomations \? \(/);
  assert.match(view, /canManageAutomations \? \(/);
  assert.match(view, /لا توجد قواعد أتمتة/);
  assert.match(view, /action=\{\s*canManageAutomations \? \(/);
});

test("automation execution history hides technical failures and localizes known outcomes", () => {
  assert.match(view, /function runStatus/);
  assert.match(view, /function runMessage/);
  assert.match(view, /Conditions did not match/);
  assert.match(view, /Rule is disabled or no longer matches the event/);
  assert.match(view, /\^Executed \(\\d\+\) actions\$/);
  assert.match(view, /run\.status === "failed"/);
  assert.match(view, /dateTime=\{run\.createdAt\}/);
  assert.doesNotMatch(view, /\{run\.message\}|⌛|▶️|⚡|❓|🎯|opacity-65/);
});
