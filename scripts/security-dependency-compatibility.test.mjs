import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import test from "node:test";

const requireRoot = createRequire(new URL("../package.json", import.meta.url));
const requireWeb = createRequire(new URL("../apps/web/package.json", import.meta.url));
const requireApi = createRequire(new URL("../apps/api/package.json", import.meta.url));
const childRequire = (parent, name) => createRequire(parent.resolve(name));

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "calmboard-dependency-test-"));
  t.after(async () => {
    const target = resolve(directory);
    assert.equal(dirname(target), resolve(tmpdir()));
    assert.ok(basename(target).startsWith("calmboard-dependency-test-"));
    await rm(target, { recursive: true, force: true });
  });
  return directory;
}

async function checkedFiles(directory, matches) {
  for (const match of matches) {
    const target = resolve(match);
    const within = relative(directory, target);
    assert.ok(within && !within.startsWith(`..${sep}`) && within !== ".." && !isAbsolute(within));
    assert.ok((await lstat(target)).isFile());
  }
}

test("Sentry's actual glob wrapper preserves map discovery and stops an already-aborted traversal", async (t) => {
  const directory = await fixture(t);
  await mkdir(join(directory, "dist/nested"), { recursive: true });
  await mkdir(join(directory, "node_modules"));
  for (const file of ["dist/app.js.map", "dist/nested/chunk.js.map", "node_modules/ignored.js.map", "dist/keep.txt"])
    await writeFile(join(directory, file), "fixture");
  const sentry = childRequire(requireWeb, "@sentry/nextjs");
  const entry = sentry.resolve("@sentry/bundler-plugins/core");
  // Exercise the installed consumer, not a reimplementation of its wrapper.
  const { globFiles } = sentry(join(dirname(entry), "glob.js"));
  const matches = await globFiles(["**/*.map"], { cwd: directory, ignore: ["**/node_modules/**"] });
  assert.deepEqual(
    matches.map((file) => resolve(file)).sort(),
    [join(directory, "dist/app.js.map"), join(directory, "dist/nested/chunk.js.map")].sort(),
  );
  assert.ok(matches.every(isAbsolute));

  let reads = 0;
  const countingFs = {
    ...fs,
    readdir(...args) {
      reads++;
      return fs.readdir(...args);
    },
    promises: {
      ...fs.promises,
      readdir(...args) {
        reads++;
        return fs.promises.readdir(...args);
      },
    },
  };
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(globFiles("**/*", { cwd: directory, signal: controller.signal, fs: countingFs }), {
    name: "AbortError",
  });
  await new Promise((done) => setImmediate(done));
  assert.equal(reads, 0, "aborted traversal must not keep reading directories");
});

test("the Google metadata transport's Rimraf keeps async/sync glob deletion within its fixture", async (t) => {
  const directory = await fixture(t);
  await mkdir(join(directory, "cache"));
  const auto = childRequire(requireApi, "@opentelemetry/auto-instrumentations-node");
  const detector = childRequire(auto, "@opentelemetry/resource-detector-gcp");
  const metadata = childRequire(detector, "gcp-metadata");
  const transport = childRequire(metadata, "gaxios");
  const rimraf = transport("rimraf");
  const glob = childRequire(transport, "rimraf")("glob");
  const options = { cwd: directory, absolute: true, nodir: true };
  const keep = join(directory, "cache/keep.json");
  await writeFile(keep, "keep");
  await writeFile(join(directory, "cache/one.tmp"), "one");
  const asyncMatches = await glob.glob("**/*.tmp", options);
  assert.equal(asyncMatches.length, 1);
  await checkedFiles(directory, asyncMatches);
  await rimraf.rimraf("**/*.tmp", { glob: options });
  await assert.rejects(readFile(join(directory, "cache/one.tmp")), { code: "ENOENT" });
  assert.deepEqual(await glob.glob("**/*.tmp", options), []);
  await writeFile(join(directory, "cache/two.tmp"), "two");
  const syncMatches = glob.globSync("**/*.tmp", options);
  assert.equal(syncMatches.length, 1);
  await checkedFiles(directory, syncMatches);
  rimraf.rimrafSync("**/*.tmp", { glob: options });
  await assert.rejects(readFile(join(directory, "cache/two.tmp")), { code: "ENOENT" });
  assert.deepEqual(glob.globSync("**/*.tmp", options), []);
  assert.equal(await readFile(keep, "utf8"), "keep");
});

test("the TypeScript parser's matcher retains project-glob behavior and bounds hostile preprocessing", () => {
  const next = childRequire(requireRoot, "eslint-config-next");
  const typescript = childRequire(next, "typescript-eslint");
  const parser = childRequire(typescript, "@typescript-eslint/parser");
  const estree = childRequire(parser, "@typescript-eslint/typescript-estree");
  const { minimatch, Minimatch } = estree("minimatch");
  assert.equal(minimatch(".config/check.ts", "**/*.ts", { dot: true }), true);
  assert.equal(minimatch("src/check.js", "**/*.ts", { dot: true }), false);
  assert.equal(new Minimatch("src/*.{ts,tsx}").match("src/check.tsx"), true);
  const modulePath = estree.resolve("minimatch");
  const code = `const {Minimatch}=require(${JSON.stringify(modulePath)});try{new Minimatch('**/../'.repeat(30)+'*.ts',{optimizationLevel:2}).match('src/check.ts')}catch{}console.log('bounded')`;
  // A child bounds the CPU/memory impact even if a later dependency regresses.
  assert.equal(
    execFileSync(process.execPath, ["--max-old-space-size=128", "-e", code], {
      encoding: "utf8",
      timeout: 3000,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    }).trim(),
    "bounded",
  );
});
