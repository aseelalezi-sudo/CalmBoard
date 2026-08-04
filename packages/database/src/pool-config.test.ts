import assert from "node:assert/strict";
import test from "node:test";
import { databasePoolMax } from "./pool-config.js";

test("database pool keeps the conservative pg default unless configured", () => {
  assert.equal(databasePoolMax({}), 10);
});

test("database pool size is configurable within PostgreSQL's safe application range", () => {
  assert.equal(databasePoolMax({ DATABASE_POOL_MAX: "50" }), 50);
});

test("database pool size rejects malformed or unsafe values", () => {
  for (const value of ["0", "1.5", "101", "many", "-1"]) {
    assert.throws(() => databasePoolMax({ DATABASE_POOL_MAX: value }), /between 1 and 100/);
  }
});
