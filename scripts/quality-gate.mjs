import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { finished } from "node:stream/promises";

export const qualityCommands = [
  ["audit", ["audit", "--audit-level", "moderate"]],
  ["environment", ["run", "check:env"]],
  ["secrets", ["run", "check:secrets"]],
  ["encoding", ["run", "check:encoding"]],
  ["cycles", ["run", "check:cycles"]],
  ["format", ["run", "format:check"]],
  ["migrations", ["run", "db:check"]],
  ["typegen", ["run", "typegen"]],
  ["types", ["run", "typecheck", "--force"]],
  ["lint", ["run", "lint", "--force"]],
];

function revision(cwd) {
  try {
    return execFileSync("git", ["rev-parse", "--verify", "HEAD"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function workingTreeDirty(cwd) {
  try {
    return Boolean(
      execFileSync("git", ["status", "--porcelain", "--untracked-files=normal"], {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim(),
    );
  } catch {
    return null;
  }
}

export async function runChecks({
  cwd,
  steps,
  outputDirectory = join(cwd, "artifacts", "quality"),
  env = process.env,
  streamOutput = true,
}) {
  await mkdir(outputDirectory, { recursive: true });
  const report = {
    startedAt: new Date().toISOString(),
    revision: revision(cwd),
    workingTreeDirty: workingTreeDirty(cwd),
    node: process.version,
    lockfileSha256: null,
    status: "running",
    checks: [],
  };
  try {
    report.lockfileSha256 = createHash("sha256")
      .update(await readFile(join(cwd, "pnpm-lock.yaml")))
      .digest("hex");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const save = () => writeFile(join(outputDirectory, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await save();
  for (const { name, executable, args } of steps) {
    if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new Error("Invalid quality check name.");
    const logFile = join(outputDirectory, `${name}.log`);
    const log = createWriteStream(logFile, { flags: "w" });
    const logFinished = finished(log);
    logFinished.catch(() => {});
    const started = performance.now();
    if (streamOutput) console.log(`[quality] ${name}`);
    let launchError = false;
    const exitCode = await new Promise((complete) => {
      const child = spawn(executable, args, { cwd, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      for (const [source, target] of [
        [child.stdout, process.stdout],
        [child.stderr, process.stderr],
      ]) {
        source.on("data", (chunk) => {
          log.write(chunk);
          if (streamOutput) target.write(chunk);
        });
      }
      child.on("error", () => {
        launchError = true;
        log.write("Check process could not start.\n");
      });
      child.on("close", (code) => complete(launchError ? 1 : (code ?? 1)));
    });
    log.end();
    await logFinished;
    report.checks.push({ name, exitCode, durationMs: Math.round(performance.now() - started), log: `${name}.log` });
    if (exitCode !== 0) {
      report.status = "failed";
      report.completedAt = new Date().toISOString();
      await save();
      return { exitCode, report };
    }
    await save();
  }
  report.status = "passed";
  report.completedAt = new Date().toISOString();
  await save();
  return { exitCode: 0, report };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) throw new Error("Run pnpm quality without extra arguments.");
  const pnpmCli = process.env.npm_execpath;
  if (!pnpmCli) throw new Error("Run this gate through pnpm quality.");
  const result = await runChecks({
    cwd: fileURLToPath(new URL("../", import.meta.url)),
    steps: qualityCommands.map(([name, args]) => ({ name, executable: process.execPath, args: [pnpmCli, ...args] })),
  });
  process.exitCode = result.exitCode;
}
