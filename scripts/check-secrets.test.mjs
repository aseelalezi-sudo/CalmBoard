import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { describe, it } from "node:test";
import { scanSecretContent, scanTrackedFiles, unsafeTrackedEnvironmentFile } from "./check-secrets.mjs";

describe("tracked secret scanner", () => {
  it("scans index bytes for unstaged deletions and removes them only after a staged deletion", async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "calmboard-secret-test-"));
    t.after(async () => {
      const target = resolve(directory);
      assert.equal(dirname(target), resolve(tmpdir()));
      assert.ok(basename(target).startsWith("calmboard-secret-test-"));
      await rm(target, { recursive: true, force: true });
    });
    const git = (args) => execFileSync("git", args, { cwd: directory, stdio: "ignore" });
    git(["init", "--quiet"]);
    const path = join(directory, "credential.ts");
    await writeFile(path, `const key = "ghp_${"a".repeat(36)}";\n`);
    git(["add", "credential.ts"]);
    await unlink(path);
    assert.deepEqual(scanTrackedFiles(directory), [{ file: "credential.ts", kind: "GitHub token" }]);
    git(["add", "--update"]);
    assert.deepEqual(scanTrackedFiles(directory), []);
  });
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
