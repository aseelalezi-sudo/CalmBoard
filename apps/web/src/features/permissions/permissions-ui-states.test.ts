import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";

const source = readFileSync(new URL("./permissions-view.tsx", import.meta.url), "utf8");

it("ignores obsolete catalog requests and does not expose raw API errors", () => {
  assert.match(source, /const requestId = \+\+requestIdRef\.current/);
  assert.match(source, /if \(requestId !== requestIdRef\.current\) return;/);
  assert.match(source, /requestIdRef\.current \+= 1/);
  assert.doesNotMatch(source, /readableError/);
  assert.match(source, /The permissions center could not be loaded/);
});

it("serializes role mutations and locks the editor while saving", () => {
  assert.match(source, /if \(roleMutationRef\.current \|\| !organizationId/);
  assert.match(source, /roleMutationRef\.current = true/);
  assert.match(source, /roleMutationRef\.current = false/);
  assert.match(source, /pendingRoleId=\{archivingRoleId\}/);
  assert.match(source, /onClose=\{saving \? \(\) => undefined : \(\) => setDraft\(null\)\}/);
  assert.match(source, /disabled=\{saving\}/);
});

it("serializes member access changes before their first await", () => {
  assert.match(source, /const busyRef = useRef\(""\)/);
  assert.match(source, /if \(busyRef\.current\) return;/);
  assert.match(source, /busyRef\.current = "assign"/);
  assert.match(source, /busyRef\.current = binding\.id/);
  assert.match(source, /busyRef\.current = `override:\$\{permission\.key\}`/);
});

it("requires an audit reason for direct allow or deny overrides", () => {
  assert.match(source, /effect !== "inherit" && !overrideReason\.trim\(\)/);
  assert.match(source, /Provide a clear reason before adding a direct allow or deny override/);
  assert.match(source, /reason: overrideReason\.trim\(\) \|\| null/);
});

it("keeps permission states localized, semantic, and touch accessible", () => {
  assert.match(source, /Select an organization to manage its permissions/);
  assert.match(source, /fmtNumber\(effective\.size, ctx\.locale\)/);
  assert.match(source, /role="img"/);
  assert.match(source, /aria-label=\{granted/);
  assert.match(source, /min-h-10 min-w-10/);
  assert.match(source, /height: "min\(640px, calc\(100dvh - 1rem\)\)"/);
});
