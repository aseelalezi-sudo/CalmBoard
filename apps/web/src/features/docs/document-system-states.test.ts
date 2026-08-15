import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const view = readFileSync(new URL("./docs-view.tsx", import.meta.url), "utf8");
const versions = readFileSync(new URL("./use-document-versions.ts", import.meta.url), "utf8");
const permissions = readFileSync(new URL("./use-document-permissions.ts", import.meta.url), "utf8");

test("document versions expose recoverable load and mutation failures", () => {
  assert.match(versions, /const \[versionError, setVersionError\]/);
  assert.match(versions, /const \[versionActionBusy, setVersionActionBusy\]/);
  assert.match(versions, /getDocumentVersions\(doc\)[\s\S]*catch \(error\)/);
  assert.match(versions, /restoreDocumentVersion\(doc, versionId\)[\s\S]*catch \(error\)/);
  assert.match(view, /description=\{versionError\}/);
  assert.match(view, /onClick=\{\(\) => void loadVersions\(\)\}/);
  assert.match(view, /fmtNumber\(ver\.versionNumber, ctx\.locale\)/);
});

test("document access stays open and distinguishes loading, failure, and empty states", () => {
  assert.match(permissions, /const \[permissionError, setPermissionError\]/);
  assert.match(permissions, /const \[permissionActionBusy, setPermissionActionBusy\]/);
  assert.doesNotMatch(permissions, /catch[\s\S]{0,250}setShowPermissions\(false\)/);
  assert.match(view, /description=\{permissionError\}/);
  assert.match(view, /onClick=\{\(\) => void loadPermissions\(\)\}/);
  assert.match(view, /tone="loading"/);
  assert.match(view, /tone="error"/);
  assert.match(view, /tone="empty"/);
});
