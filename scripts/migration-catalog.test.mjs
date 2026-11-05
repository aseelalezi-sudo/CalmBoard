import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { compareReviewedCatalog } from "./migration-catalog.mjs";

test("catalog review accepts only the exact reviewed function definitions, never arbitrary formatting", async () => {
  const reviewed = JSON.parse(
    await readFile(new URL("./testing/reviewed-goal-functions.json", import.meta.url), "utf8"),
  );
  const actual = reviewed.map(({ key, actual }) => ({
    kind: "function",
    key: key.slice("function:".length),
    definition: actual,
  }));
  const expected = reviewed.map(({ key, expected }) => ({
    kind: "function",
    key: key.slice("function:".length),
    definition: expected,
  }));
  assert.equal(compareReviewedCatalog(actual, expected).reviewed.length, 2);
  assert.equal(compareReviewedCatalog(expected, expected).reviewed.length, 0);
  const changed = actual.map((row) => ({ ...row, definition: `${row.definition}\n` }));
  assert.throws(() => compareReviewedCatalog(changed, expected), /Unreviewed/);
  assert.throws(() => compareReviewedCatalog(actual, expected.slice(1)), /Unreviewed/);
  assert.throws(
    () => compareReviewedCatalog([...actual, { kind: "table", key: "untracked", definition: {} }], expected),
    /Unreviewed/,
  );
});
