import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const hook = readFileSync(new URL("./use-integration-credentials.ts", import.meta.url), "utf8");
const view = readFileSync(new URL("./integrations-view.tsx", import.meta.url), "utf8");
const ui = readFileSync(new URL("../../components/ui.tsx", import.meta.url), "utf8");

test("integration status fails closed instead of presenting failed loads as disconnected", () => {
  assert.match(hook, /const \[loadError, setLoadError\]/);
  assert.match(hook, /setLoadError\(readableError/);
  assert.doesNotMatch(hook, /catch[\s\S]{0,180}setCredentials\(\[\]\)/);
  assert.match(view, /tone="permission"/);
  assert.match(view, /tone="loading"/);
  assert.match(view, /tone="error"/);
  assert.match(view, /onClick=\{\(\) => void refreshCredentials\(\)\}/);
});

test("integration mutations are named, confirmed, and serialized", () => {
  assert.match(hook, /const \[pendingProvider, setPendingProvider\]/);
  assert.match(hook, /await confirmAction\(/);
  assert.match(hook, /tone: "danger"/);
  assert.match(view, /ariaLabel=\{ctx\.t\(/);
  assert.match(view, /pendingProvider !== null/);
});

test("shared toggles require an accessible name and a mobile touch target", () => {
  assert.match(ui, /ariaLabel: string/);
  assert.match(ui, /aria-label=\{ariaLabel\}/);
  assert.match(ui, /grid h-10 w-11/);
  assert.match(ui, /focus-visible:ring-2/);
});
