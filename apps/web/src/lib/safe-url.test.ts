import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { safeExternalUrl } from "./safe-url.js";

describe("safeExternalUrl", () => {
  it("accepts http, https and mailto links", () => {
    assert.equal(safeExternalUrl("https://figma.com/design/x"), "https://figma.com/design/x");
    assert.equal(safeExternalUrl("  http://example.com  "), "http://example.com/");
    assert.equal(safeExternalUrl("mailto:team@example.com"), "mailto:team@example.com");
  });

  it("rejects script-capable, relative and malformed values", () => {
    assert.equal(safeExternalUrl("javascript:alert(1)"), undefined);
    assert.equal(safeExternalUrl(" JaVaScRiPt:alert(1)"), undefined);
    assert.equal(safeExternalUrl("data:text/html,<script>alert(1)</script>"), undefined);
    assert.equal(safeExternalUrl("vbscript:msgbox(1)"), undefined);
    assert.equal(safeExternalUrl("/relative/path"), undefined);
    assert.equal(safeExternalUrl(""), undefined);
    assert.equal(safeExternalUrl(undefined), undefined);
    assert.equal(safeExternalUrl(42), undefined);
  });
});
