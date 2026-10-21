import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "node:test";

const sourceRoot = join(import.meta.dirname, "..");
const allowedLatinTerms = new Set(["PRD", "Enter"]);

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : sourceFiles(path);
    return path.endsWith(".tsx") && !path.includes(".test.") ? [path] : [];
  });
}

it("keeps Arabic interface copy free of English parenthetical terms", () => {
  const findings: string[] = [];
  const arabicCopy = /\bt\("([^"]*[؀-ۿ][^"]*)"/g;
  for (const file of sourceFiles(sourceRoot)) {
    for (const [, copy] of readFileSync(file, "utf8").matchAll(arabicCopy)) {
      for (const [, term] of copy!.matchAll(/\(([A-Za-z][A-Za-z ./&-]*)\)/g)) {
        if (!allowedLatinTerms.has(term!)) findings.push(`${file.slice(sourceRoot.length + 1)}: ${copy}`);
      }
    }
  }
  assert.deepEqual(findings, []);
});
