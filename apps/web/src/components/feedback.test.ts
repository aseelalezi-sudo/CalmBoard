import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import test from "node:test";

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return [".ts", ".tsx"].includes(extname(entry.name)) && !entry.name.endsWith(".test.ts") ? [path] : [];
  });
}

test("user actions use CalmBoard feedback instead of blocking browser dialogs", () => {
  const violations = sourceFiles(join(process.cwd(), "src"))
    .map((path) => ({ path, content: readFileSync(path, "utf8") }))
    .filter(({ content }) => /\b(?:window\.)?(?:alert|confirm|prompt)\s*\(/.test(content))
    .map(({ path }) => path);

  assert.deepEqual(violations, []);
});
