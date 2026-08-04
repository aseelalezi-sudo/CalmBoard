import assert from "node:assert/strict";
import { describe, it } from "node:test";
import sharp from "sharp";
import { createAttachmentPreview } from "./attachment-preview.js";

describe("attachment previews", () => {
  it("uses the clean source for browser-safe documents", async () => {
    const result = await createAttachmentPreview(
      { readObject: async () => Buffer.alloc(0), putObject: async () => "unused" },
      { key: "report.pdf", mimeType: "application/pdf" },
    );
    assert.deepEqual(result, { status: "source", mimeType: "application/pdf" });
  });

  it("creates bounded WebP thumbnails for images", async () => {
    const original = await sharp({ create: { width: 800, height: 400, channels: 3, background: "#336699" } })
      .png()
      .toBuffer();
    let uploaded: Uint8Array | undefined;
    const result = await createAttachmentPreview(
      {
        readObject: async () => original,
        putObject: async (_key, body) => {
          uploaded = body;
          return "s3://bucket/image.preview.webp";
        },
      },
      { key: "image.png", mimeType: "image/png" },
    );
    assert.equal(result.status, "ready");
    assert.equal(result.width, 512);
    assert.equal(result.height, 256);
    assert.ok(uploaded && uploaded.byteLength > 0);
  });

  it("marks unsupported formats without reading their content", async () => {
    const result = await createAttachmentPreview(
      { readObject: async () => assert.fail("must not read"), putObject: async () => "unused" },
      { key: "archive.zip", mimeType: "application/zip" },
    );
    assert.deepEqual(result, { status: "unsupported" });
  });
});
