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

  it("fails closed when the scanner is unavailable, times out, or rejects the request", async () => {
    const environment = {
      NODE_ENV: "production",
      ATTACHMENT_SCAN_MODE: "webhook",
      ATTACHMENT_SCANNER_URL: "https://scanner.example/scan",
      ATTACHMENT_SCANNER_TOKEN: "scanner-token",
    };
    const unavailable = createAttachmentScanner(environment, async () => {
      throw new TypeError("connection refused");
    });
    const timedOut = createAttachmentScanner(environment, async () => {
      throw new DOMException("timed out", "AbortError");
    });
    const rejected = createAttachmentScanner(environment, async () => new Response(null, { status: 503 }));

    await assert.rejects(() => unavailable.scan(input), /unavailable/);
    await assert.rejects(() => timedOut.scan(input), /unavailable/);
    await assert.rejects(() => rejected.scan(input), /rejected/);
  });

  it("returns an explicit malicious verdict without treating it as clean", async () => {
    const scanner = createAttachmentScanner(
      {
        NODE_ENV: "production",
        ATTACHMENT_SCAN_MODE: "webhook",
        ATTACHMENT_SCANNER_URL: "https://scanner.example/scan",
        ATTACHMENT_SCANNER_TOKEN: "scanner-token",
      },
      async () => Response.json({ status: "infected", engine: "clamav", signature: "Eicar-Test-Signature" }),
    );
    assert.deepEqual(await scanner.scan(input), {
      status: "infected",
      engine: "clamav",
      signature: "Eicar-Test-Signature",
    });
  });
});
