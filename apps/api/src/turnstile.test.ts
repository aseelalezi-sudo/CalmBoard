import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException, ServiceUnavailableException } from "@nestjs/common";
import { publicTurnstileConfiguration, verifyTurnstileToken } from "./turnstile.js";

describe("Cloudflare Turnstile verification", () => {
  it("uses Cloudflare's official passing test site key outside production", () => {
    assert.deepEqual(publicTurnstileConfiguration(true, { NODE_ENV: "test" }), {
      enabled: true,
      siteKey: "1x00000000000000000000AA",
      configured: true,
    });
    assert.deepEqual(publicTurnstileConfiguration(false, { NODE_ENV: "production" }), { enabled: false });
  });

  it("skips the provider only when CAPTCHA is disabled", async () => {
    let calls = 0;
    await verifyTurnstileToken(false, "", undefined, async () => {
      calls += 1;
      return new Response();
    });
    assert.equal(calls, 0);
  });

  it("validates every enabled token at Siteverify without exposing the secret", async () => {
    let submittedBody = "";
    await verifyTurnstileToken(
      true,
      "XXXX.DUMMY.TOKEN.XXXX",
      "127.0.0.1",
      async (_url, init) => {
        submittedBody = String(init?.body);
        return Response.json({ success: true, hostname: "localhost", action: "test" });
      },
      { NODE_ENV: "test" },
    );
    assert.match(submittedBody, /response=XXXX.DUMMY.TOKEN.XXXX/);
    assert.match(submittedBody, /remoteip=127.0.0.1/);
    assert.match(submittedBody, /secret=/);
  });

  it("fails closed for rejected tokens and missing production keys", async () => {
    await assert.rejects(
      verifyTurnstileToken(
        true,
        "bad-token",
        undefined,
        async () => Response.json({ success: false, "error-codes": ["invalid-input-response"] }),
        { NODE_ENV: "test" },
      ),
      BadRequestException,
    );
    await assert.rejects(
      verifyTurnstileToken(true, "token", undefined, async () => Response.json({ success: true }), {
        NODE_ENV: "production",
      }),
      ServiceUnavailableException,
    );
  });
});
