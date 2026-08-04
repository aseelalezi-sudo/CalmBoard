import assert from "node:assert/strict";
import test from "node:test";
import { documentTaskTitle } from "./document-content";

test("document task title preserves legacy Markdown while removing presentation syntax", () => {
  assert.equal(documentTaskTitle("\n# Release **plan**\n\nDetails", "Fallback"), "Release plan");
  assert.equal(documentTaskTitle("- [ ] Review [security](https://example.test)", "Fallback"), "Review security");
  assert.equal(documentTaskTitle("", "Untitled document"), "Untitled document");
  assert.equal(documentTaskTitle("x".repeat(120), "Fallback").length, 100);
});
