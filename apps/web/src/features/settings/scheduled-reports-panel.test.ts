import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./scheduled-reports-panel.tsx", import.meta.url), "utf8");

test("scheduled reports distinguish permission, loading, failure, and empty states", () => {
  assert.match(source, /tone="permission"/);
  assert.match(source, /tone="loading"/);
  assert.match(source, /tone="error"/);
  assert.match(source, /tone="empty"/);
  assert.match(source, /const \[loadError, setLoadError\]/);
  assert.match(source, /setReloadKey\(\(value\) => value \+ 1\)/);
  assert.match(source, /loading \|\| loadError \|\| saving \|\| !scope/);
});

test("scheduled reports localize persisted cadence, weekdays, and recipient counts", () => {
  assert.match(source, /function cadenceLabel/);
  assert.match(source, /\["الأحد", "Sunday"\]/);
  assert.match(source, /ctx\.t\(\.\.\.label\)/);
  assert.match(source, /fmtNumber\(schedule\.recipientIds\.length, ctx\.locale\)/);
  assert.doesNotMatch(source, /\{schedule\.cadence\}/);
  assert.doesNotMatch(source, /\{schedule\.recipientIds\.length\}/);
});
