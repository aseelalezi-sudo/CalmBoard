import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { scanSecretContent, unsafeTrackedEnvironmentFile } from "./check-secrets.mjs";

describe("tracked secret scanner", () => {
  it("detects credential formats without returning the credential value", () => {
    const simulatedCredential = `AKIA${"ABCDEFGHIJKLMNOP"}`;
    const findings = scanSecretContent(`token=${simulatedCredential}`);
    assert.deepEqual(findings, ["AWS access key"]);
    assert.equal(findings.join(" ").includes(simulatedCredential), false);
  });

  it("requires a realistic encoded body before treating a PEM fixture as a private key", () => {
    const headerOnlyFixture = "-----BEGIN PRIVATE KEY-----\nprivate-material\n-----END PRIVATE KEY-----";
    const realisticFixture = `-----BEGIN PRIVATE KEY-----\n${"A".repeat(64)}\n-----END PRIVATE KEY-----`;
    assert.deepEqual(scanSecretContent(headerOnlyFixture), []);
    assert.deepEqual(scanSecretContent(realisticFixture), ["private key"]);
  });

  it("allows templates but rejects tracked plaintext environment files", () => {
    assert.equal(unsafeTrackedEnvironmentFile(".env"), true);
    assert.equal(unsafeTrackedEnvironmentFile("apps/web/.env.local"), true);
    assert.equal(unsafeTrackedEnvironmentFile("deploy/.env.production.example"), false);
  });

  it("does not flag documented placeholder credentials", () => {
    assert.deepEqual(scanSecretContent("replace-with-a-random-secret"), []);
    assert.deepEqual(scanSecretContent("sk_test_simulated_credential"), []);
  });
});
