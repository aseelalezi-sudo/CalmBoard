import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./settings-view.tsx", import.meta.url), "utf8");

test("workspace identity uses a synchronized local draft and one serialized save", () => {
  assert.match(source, /const \[color, setColor\]/);
  assert.match(source, /setName\(ctx\.activeWorkspace\?\.name \|\| ""\)/);
  assert.match(source, /setDescription\(ctx\.activeWorkspace\?\.description \|\| ""\)/);
  assert.match(source, /setColor\(ctx\.activeWorkspace\?\.color \|\| "#6366f1"\)/);
  assert.match(source, /await ctx\.updateWorkspace\(\{ name: name\.trim\(\), description, color \}\)/);
  assert.match(source, /const \[savingGeneral, setSavingGeneral\]/);
  assert.doesNotMatch(source, /onChange=\{\(e\) => ctx\.updateWorkspace\(\{ color:/);
});

test("data export authorization distinguishes permission, loading, and recoverable failure", () => {
  assert.match(source, /const \[organizationAuthorizationLoading/);
  assert.match(source, /const \[organizationAuthorizationError/);
  assert.match(source, /setOrganizationAuthorizationKey\(\(value\) => value \+ 1\)/);
  assert.match(source, /tone="permission"/);
  assert.match(source, /tone="loading"/);
  assert.match(source, /tone="error"/);
  assert.match(source, /function exportStatusLabel/);
});

test("custom field deletion is named, permission-aware, and confirmed", () => {
  assert.match(source, /await confirmAction\(/);
  assert.match(source, /tone: "danger"/);
  assert.match(source, /aria-label=\{ctx\.t\(`/);
  assert.match(source, /disabled=\{!ctx\.can\("custom_fields\.manage"\)\}/);
  assert.match(source, /void deleteField\(f\.id, f\.name\)/);
});
