import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { secureCookieAttribute } from "./cookie-security.js";

describe("secureCookieAttribute", () => {
  it("defaults to secure cookies in production", () => {
    assert.equal(secureCookieAttribute({ NODE_ENV: "production" }), "; Secure");
  });

  it("allows the explicitly configured local HTTP stack", () => {
    assert.equal(secureCookieAttribute({ NODE_ENV: "production", AUTH_COOKIE_SECURE: "false" }), "");
  });

  it("can require secure cookies outside production", () => {
    assert.equal(secureCookieAttribute({ NODE_ENV: "test", AUTH_COOKIE_SECURE: "true" }), "; Secure");
  });
});
