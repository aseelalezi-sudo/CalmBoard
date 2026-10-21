import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveTrustProxy } from "./trust-proxy.js";

describe("resolveTrustProxy", () => {
  it("trusts no proxy when hops are zero or invalid", () => {
    assert.equal(resolveTrustProxy({ TRUST_PROXY_HOPS: "0" }), false);
    assert.equal(resolveTrustProxy({}), false);
    assert.equal(resolveTrustProxy({ TRUST_PROXY_HOPS: "abc" }), false);
  });

  it("trusts only private peers within the hop depth by default", () => {
    const trust = resolveTrustProxy({ TRUST_PROXY_HOPS: "1" });
    assert.equal(typeof trust, "function");
    if (typeof trust !== "function") return;
    assert.equal(trust("10.0.0.5", 0), true);
    assert.equal(trust("::ffff:172.20.0.2", 0), true);
    assert.equal(trust("203.0.113.9", 0), false);
    assert.equal(trust("10.0.0.5", 1), false);
  });

  it("uses the configured CIDR list instead of the private defaults", () => {
    const trust = resolveTrustProxy({ TRUST_PROXY_HOPS: "2", TRUST_PROXY_CIDRS: "198.51.100.0/24, 2001:db8::1" });
    assert.equal(typeof trust, "function");
    if (typeof trust !== "function") return;
    assert.equal(trust("198.51.100.7", 1), true);
    assert.equal(trust("2001:db8::1", 0), true);
    assert.equal(trust("10.0.0.5", 0), false);
    assert.equal(trust("198.51.100.7", 2), false);
  });

  it("rejects malformed CIDR entries", () => {
    assert.throws(
      () => resolveTrustProxy({ TRUST_PROXY_HOPS: "1", TRUST_PROXY_CIDRS: "not-an-ip" }),
      /TRUST_PROXY_CIDRS/,
    );
  });
});
