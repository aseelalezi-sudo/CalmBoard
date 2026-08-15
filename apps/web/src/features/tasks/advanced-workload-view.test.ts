import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./advanced-workload.tsx", import.meta.url), "utf8");

test("workload view localizes durations and distinguishes loading, failure, and empty states", () => {
  assert.match(source, /fmtMinutes\(minutes, locale\)/);
  assert.match(source, /const \[loadError, setLoadError\]/);
  assert.match(source, /tone="error"/);
  assert.match(source, /tone="loading"/);
  assert.match(source, /tone="empty"/);
  assert.match(source, /onClick=\{\(\) => void loadSettings\(\)\}/);
  assert.match(source, /ctx\.locale === "ar" \? "→" : "←"/);
  assert.match(source, /ctx\.locale === "ar" \? "←" : "→"/);
  assert.doesNotMatch(source, /toFixed\(1\)\}h/);
});
