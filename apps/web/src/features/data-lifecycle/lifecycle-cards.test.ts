import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./lifecycle-cards.tsx", import.meta.url), "utf8");

test("deletion lifecycle fails closed until the authoritative request state is known", () => {
  assert.match(source, /const \[loadError, setLoadError\]/);
  assert.match(source, /const \[reloadKey, setReloadKey\]/);
  assert.match(source, /tone="loading"/);
  assert.match(source, /tone="error"/);
  assert.match(source, /loaded &&\s*!loadError &&\s*\(cancellable \?/);
  assert.match(source, /setReloadKey\(\(value\) => value \+ 1\)/);
  assert.match(source, /if \(current\) setState\(nextState\)/);
  assert.doesNotMatch(source, /\.catch\(\(\) => setState\(null\)\)/);
});

test("deletion mutations are serialized before their first await", () => {
  assert.match(source, /const busyRef = useRef\(false\)/);
  assert.match(source, /if \(busyRef\.current\) return;/);
  assert.match(source, /busyRef\.current = true;\s*setBusy\(true\);\s*try \{\s*await cancelAccountDeletion/);
  assert.match(source, /busyRef\.current = true;\s*setBusy\(true\);\s*try \{\s*await cancelOrganizationDeletion/);
  assert.match(source, /busyRef\.current = false;\s*setBusy\(false\)/);
});

test("lifecycle failures stay localized and never expose raw server summaries", () => {
  assert.doesNotMatch(source, /error instanceof Error \? error\.message/);
  assert.doesNotMatch(source, /\{state\.lastErrorSummary\}/);
  assert.match(source, /The latest processing attempt failed/);
  assert.match(source, /Could not schedule account deletion\. Check your confirmation details/);
  assert.match(source, /Could not schedule organization deletion\. Check the name and confirmation details/);
});

test("organization changes cannot display a previous organization's mutation result", () => {
  assert.match(source, /const organizationIdRef = useRef\(organizationId\)/);
  assert.match(source, /organizationIdRef\.current = organizationId/);
  assert.match(source, /if \(organizationIdRef\.current !== organization\.id\) return;/);
  assert.match(source, /setState\(null\);\s*setConfirmedName\(""\)/);
});

test("reauthentication fields and dangerous actions lock while processing", () => {
  assert.match(source, /disabled=\{disabled\}/);
  assert.match(source, /maxLength=\{8\}/);
  assert.match(source, /replace\(\/\\D\/g, ""\)\.slice\(0, 8\)/);
  assert.match(source, /aria-busy=\{busy\}/);
  assert.match(source, /disabled=\{busy \|\| !confirmed/);
  assert.match(source, /disabled=\{busy \|\| confirmedName !== organization\.name/);
});
