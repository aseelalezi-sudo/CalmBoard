import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { runChecks } from "./quality-gate.mjs";

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "calmboard-quality-test-"));
  t.after(async () => {
    const target = resolve(directory);
    assert.equal(dirname(target), resolve(tmpdir()));
    assert.ok(basename(target).startsWith("calmboard-quality-test-"));
    await rm(target, { recursive: true, force: true });
  });
  await writeFile(join(directory, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  return directory;
}

test("quality gate captures stdout/stderr and stops before later checks when a real process fails", async (t) => {
  const cwd = await fixture(t);
  const result = await runChecks({
    cwd,
    streamOutput: false,
    steps: [
      {
        name: "first",
        executable: process.execPath,
        args: ["-e", "console.log('captured stdout'); console.error('captured stderr'); process.exitCode=7"],
      },
      { name: "never", executable: process.execPath, args: ["-e", "process.exitCode=0"] },
    ],
  });
  assert.equal(result.exitCode, 7);
  const report = JSON.parse(await readFile(join(cwd, "artifacts/quality/report.json"), "utf8"));
  assert.equal(report.status, "failed");
  assert.deepEqual(
    report.checks.map((check) => check.name),
    ["first"],
  );
  assert.match(report.lockfileSha256, /^[a-f0-9]{64}$/);
  const log = await readFile(join(cwd, "artifacts/quality/first.log"), "utf8");
  assert.match(log, /captured stdout/);
  assert.match(log, /captured stderr/);
  await assert.rejects(readFile(join(cwd, "artifacts/quality/never.log")), { code: "ENOENT" });
});

test("quality gate runs successful checks in order and records launch failures", async (t) => {
  const cwd = await fixture(t);
  const steps = ["one", "two"].map((name) => ({
    name,
    executable: process.execPath,
    args: ["-e", `console.log('${name}')`],
  }));
  const success = await runChecks({ cwd, steps, streamOutput: false });
  assert.equal(success.report.status, "passed");
  assert.deepEqual(
    success.report.checks.map((check) => check.name),
    ["one", "two"],
  );
  const failure = await runChecks({
    cwd,
    steps: [{ name: "missing", executable: join(cwd, "does-not-exist"), args: [] }],
    streamOutput: false,
  });
  assert.equal(failure.exitCode, 1);
  assert.equal(failure.report.status, "failed");
});
