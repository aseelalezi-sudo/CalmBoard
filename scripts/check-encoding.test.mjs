import assert from "node:assert/strict";
import test from "node:test";
import { scanEncodingContent, scanUserFacingSources } from "./check-encoding.mjs";

test("encoding scan detects representative Arabic and punctuation mojibake", () => {
  assert.ok(
    scanEncodingContent("\u0637\u00A7\u0638\u201E").some((finding) => finding.kind === "Arabic UTF-8 mojibake"),
  );
  assert.ok(
    scanEncodingContent("\u00E2\u0080\u0094").some((finding) => finding.kind === "Windows punctuation mojibake"),
  );
  assert.ok(scanEncodingContent("broken \uFFFD text").some((finding) => finding.kind === "replacement character"));
});

test("valid Arabic and English product copy has no encoding findings", () => {
  assert.deepEqual(scanEncodingContent("مساحة العمل — جارٍ الحفظ… — Sprint backlog"), []);
});

test("user-facing source inventory is free from known corruption", () => {
  assert.deepEqual(scanUserFacingSources(), []);
});
