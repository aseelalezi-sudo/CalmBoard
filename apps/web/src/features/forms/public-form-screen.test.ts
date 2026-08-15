import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const hook = readFileSync(new URL("./use-public-form.ts", import.meta.url), "utf8");
const page = readFileSync(new URL("../../app/f/[id]/page.tsx", import.meta.url), "utf8");

test("public forms distinguish not-found responses from recoverable load failures", () => {
  assert.match(hook, /error instanceof ApiError && error\.status === 404/);
  assert.match(hook, /const \[loadError, setLoadError\]/);
  assert.match(hook, /const \[reloadKey, setReloadKey\]/);
  assert.match(hook, /if \(current\) setLoading\(false\)/);
  assert.match(page, /description=\{loadError\}/);
  assert.match(page, /onClick=\{retryLoad\}/);
  assert.match(page, /tone="loading"/);
  assert.match(page, /tone="error"/);
  assert.match(page, /tone="empty"/);
});

test("public form controls expose labels, errors, and touch-friendly semantic surfaces", () => {
  assert.match(page, /htmlFor=\{controlId\}/);
  assert.match(page, /aria-describedby=\{describedBy\}/);
  assert.match(page, /aria-invalid=\{Boolean\(error\)\}/);
  assert.match(page, /role="radiogroup"/);
  assert.match(page, /className=\{areaCls\}/);
  assert.match(page, /className=\{selectCls\}/);
  assert.match(page, /className=\{inputCls\}/);
  assert.match(page, /<main className="rounded-2xl border border-line bg-surface\/95/);
  assert.doesNotMatch(page, /dark:bg-\[#0e0e16\]/);
});
