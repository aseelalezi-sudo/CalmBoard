import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { apiSecurityHeaders } from "./security-headers.js";

describe("apiSecurityHeaders", () => {
  it("denies framing, sniffing and resource loading for API responses", () => {
    const headers = apiSecurityHeaders({ NODE_ENV: "development" });
    assert.equal(headers["Content-Security-Policy"], "default-src 'none'; frame-ancestors 'none'");
    assert.equal(headers["X-Content-Type-Options"], "nosniff");
    assert.equal(headers["X-Frame-Options"], "DENY");
    assert.equal(headers["Strict-Transport-Security"], undefined);
  });

  it("enables HSTS only for secure production deployments", () => {
    assert.match(apiSecurityHeaders({ NODE_ENV: "production" })["Strict-Transport-Security"] ?? "", /max-age=31536000/);
    assert.equal(
      apiSecurityHeaders({ NODE_ENV: "production", AUTH_COOKIE_SECURE: "false" })["Strict-Transport-Security"],
      undefined,
    );
  });
});
