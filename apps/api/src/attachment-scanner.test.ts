import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createAttachmentScanner } from "./attachment-scanner.js";

const input = {
  attachmentId: "attachment-1",
  fileName: "report.pdf",
  fileSize: 10,
  mimeType: "application/pdf",
  downloadUrl: "https://storage.example/report.pdf",
};

describe("attachment scanner hook", () => {
  it("fails closed in production when the scanner is disabled", () => {
    assert.throws(() => createAttachmentScanner({ NODE_ENV: "production", ATTACHMENT_SCAN_MODE: "disabled" }));
  });

  it("authenticates the webhook and accepts an explicit clean verdict", async () => {
    let request: RequestInit | undefined;
    const scanner = createAttachmentScanner(
      {
        NODE_ENV: "test",
        ATTACHMENT_SCAN_MODE: "webhook",
        ATTACHMENT_SCANNER_URL: "https://scanner.example/scan",
        ATTACHMENT_SCANNER_TOKEN: "scanner-token",
      },
      async (_url, init) => {
        request = init;
        return new Response(JSON.stringify({ status: "clean", engine: "clamav" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    );

    assert.deepEqual(await scanner.scan(input), { status: "clean", engine: "clamav" });
    assert.equal((request?.headers as Record<string, string>).Authorization, "Bearer scanner-token");
  });

  it("rejects malformed scanner responses", async () => {
    const scanner = createAttachmentScanner(
      { NODE_ENV: "test", ATTACHMENT_SCAN_MODE: "webhook", ATTACHMENT_SCANNER_URL: "https://scanner.example/scan" },
      async () => new Response(JSON.stringify({ status: "maybe" }), { status: 200 }),
    );
    await assert.rejects(() => scanner.scan(input), /invalid verdict/);
  });
});
