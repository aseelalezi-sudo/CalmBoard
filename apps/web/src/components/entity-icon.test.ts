import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveEntityIcon } from "./entity-icon";

describe("stored entity icons", () => {
  it("maps persisted icon names to SVG components", () => {
    assert.equal(resolveEntityIcon("folder", "project").type, "named");
    assert.equal(resolveEntityIcon("briefcase", "workspace").type, "named");
    assert.equal(resolveEntityIcon("file_text", "document").type, "named");
    assert.equal(resolveEntityIcon("code-2", "project").type, "named");
  });

  it("keeps emoji values and replaces unknown textual names", () => {
    assert.deepEqual(resolveEntityIcon("🚀", "project"), { type: "emoji", value: "🚀" });
    assert.equal(resolveEntityIcon("unknown-icon-name", "document").type, "fallback");
    assert.equal(resolveEntityIcon("", "workspace").type, "fallback");
  });
});
