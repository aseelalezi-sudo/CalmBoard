import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { contentMatchesMimeType } from "./attachment-signature.js";

const bytes = (...values: number[]) => Uint8Array.from(values);
const text = (value: string) => new TextEncoder().encode(value);

describe("contentMatchesMimeType", () => {
  it("accepts content that matches its declared type", () => {
    assert.equal(contentMatchesMimeType("application/pdf", text("%PDF-1.7\n")), true);
    assert.equal(contentMatchesMimeType("image/png", bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0)), true);
    assert.equal(contentMatchesMimeType("image/jpeg", bytes(0xff, 0xd8, 0xff, 0xe0)), true);
    assert.equal(contentMatchesMimeType("image/gif", text("GIF89a....")), true);
    assert.equal(contentMatchesMimeType("image/webp", text("RIFF\0\0\0\0WEBPVP8 ")), true);
    assert.equal(
      contentMatchesMimeType(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        bytes(0x50, 0x4b, 0x03, 0x04),
      ),
      true,
    );
    assert.equal(
      contentMatchesMimeType("application/msword", bytes(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1)),
      true,
    );
    assert.equal(contentMatchesMimeType("text/csv", text("a,b\n1,2\n")), true);
  });

  it("rejects content whose bytes contradict the declared type", () => {
    assert.equal(contentMatchesMimeType("image/png", text("<html><script>alert(1)</script>")), false);
    assert.equal(contentMatchesMimeType("application/pdf", text("MZ\x90\0 executable")), false);
    assert.equal(contentMatchesMimeType("application/zip", text("not a zip")), false);
    assert.equal(contentMatchesMimeType("image/webp", text("RIFF\0\0\0\0WAVEfmt ")), false);
    assert.equal(contentMatchesMimeType("text/plain", bytes(0x4d, 0x5a, 0x00, 0x01)), false);
    assert.equal(contentMatchesMimeType("text/plain", new Uint8Array()), false);
  });

  it("leaves types without a known signature to the malware scan", () => {
    assert.equal(contentMatchesMimeType("application/octet-stream", text("anything")), true);
  });

  it("is case-insensitive on the declared type", () => {
    assert.equal(contentMatchesMimeType("Application/PDF", text("%PDF-1.4")), true);
  });
});
