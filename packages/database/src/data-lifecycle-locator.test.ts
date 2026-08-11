import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canonicalJson, purgeLocatorFingerprint, validatePurgeLocator } from "./data-lifecycle-locator.js";

describe("data lifecycle locator canonicalization", () => {
  it("produces the same fingerprint for recursively equivalent object key orders", () => {
    const first = {
      bucket: "private",
      metadata: { version: 1, nullable: null, flags: [true, false] },
      key: "organizations/α/ملف.txt",
    };
    const reordered = {
      key: "organizations/α/ملف.txt",
      metadata: { flags: [true, false], nullable: null, version: 1 },
      bucket: "private",
    };

    assert.equal(
      purgeLocatorFingerprint("attachments", "object_key", first),
      purgeLocatorFingerprint("attachments", "object_key", reordered),
    );
  });

  it("uses stable JSON representations for numbers, Unicode, null and nested values", () => {
    assert.equal(
      canonicalJson({ zero: -0, decimal: 1.25, exponent: 1e30, text: "مرحباً 👋", nested: [null, { b: 2, a: 1 }] }),
      '{"decimal":1.25,"exponent":1e+30,"nested":[null,{"a":1,"b":2}],"text":"مرحباً 👋","zero":0}',
    );
  });

  it("rejects values that are not valid deterministic JSON", () => {
    assert.throws(() => canonicalJson({ value: undefined }), /does not support undefined/);
    assert.throws(() => canonicalJson({ value: Number.NaN }), /non-finite/);
    assert.throws(() => canonicalJson(new Date()), /plain objects/);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    assert.throws(() => canonicalJson(cyclic), /cyclic/);
  });

  it("separates domain and locator kind in the fingerprint contract", () => {
    const locator = { key: "same" };
    assert.notEqual(
      purgeLocatorFingerprint("attachments", "object_key", locator),
      purgeLocatorFingerprint("documents", "object_key", locator),
    );
    assert.notEqual(
      purgeLocatorFingerprint("attachments", "object_key", locator),
      purgeLocatorFingerprint("attachments", "provider_resource", locator),
    );
  });

  it("rejects arbitrary SQL, credentials, and signed URLs from executable locators", () => {
    assert.throws(
      () =>
        validatePurgeLocator("organization_relational", "sql_keyset", {
          table: "tasks; drop table users",
          cursor: null,
        }),
      /not allow-listed/,
    );
    assert.throws(
      () =>
        validatePurgeLocator("attachments", "object_key", {
          attachmentId: "a",
          reference: "https://signed.example/file?token=x",
        }),
      /credentials|HTTP URLs/,
    );
    assert.throws(
      () =>
        validatePurgeLocator("billing_provider", "provider_resource", {
          subscriptionId: "a",
          provider: "stripe",
          providerSubscriptionId: "sub_1",
          secret: "bad",
        }),
      /credentials/,
    );
    assert.doesNotThrow(() =>
      validatePurgeLocator("exports", "object_key", { exportJobId: "job-1", key: "exports/org/job.zip" }),
    );
  });
});
