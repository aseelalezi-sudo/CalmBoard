import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./acceptance-screen.tsx", import.meta.url), "utf8");

test("invitation inspection distinguishes invalid links from recoverable service failures", () => {
  assert.match(source, /const \[loadError, setLoadError\]/);
  assert.match(source, /inspectInvitationToken\(rawToken\)/);
  assert.match(source, /setLoadError\(readableError/);
  assert.match(source, /setReloadKey\(\(value\) => value \+ 1\)/);
  assert.match(source, /if \(current\) setLoading\(false\)/);
  assert.doesNotMatch(source, /Promise\.all\(\[inspectInvitationToken/);
  assert.doesNotMatch(source, /catch\(\(\) => setInvitation\(\{ status: "invalid" \}\)\)/);
});

test("invitation acceptance supports safe account switching and decline confirmation", () => {
  assert.match(source, /useAuthOperations\(\)/);
  assert.match(source, /await logout\(\)/);
  assert.match(source, /setUser\(null\)/);
  assert.match(source, /await confirmAction\(/);
  assert.match(source, /tone: "danger"/);
  assert.match(source, /<PublicShell/);
  assert.match(source, /tone="loading"/);
  assert.match(source, /tone="error"/);
});
