import assert from "node:assert/strict";
import test from "node:test";
import { assertDatabaseCommandAllowed, databaseEnvironment } from "./database-command.mjs";

test("database environment uses deployment scope before Node environment", () => {
  assert.equal(databaseEnvironment({ DEPLOY_ENV: "Staging", NODE_ENV: "test" }), "staging");
  assert.equal(databaseEnvironment({ NODE_ENV: "development" }), "development");
  assert.equal(databaseEnvironment({}), "development");
});

test("push is allowed only for local development and ephemeral CI", () => {
  assert.doesNotThrow(() => assertDatabaseCommandAllowed("push", { NODE_ENV: "development" }));
  assert.doesNotThrow(() => assertDatabaseCommandAllowed("push", { NODE_ENV: "test", CI: "true" }));
  assert.throws(
    () => assertDatabaseCommandAllowed("push", { DEPLOY_ENV: "staging", CI: "true", NODE_ENV: "test" }),
    /forbidden in staging/,
  );
  assert.throws(() => assertDatabaseCommandAllowed("push", { DEPLOY_ENV: "production" }), /forbidden in production/);
  assert.throws(() => assertDatabaseCommandAllowed("push", { DEPLOY_ENV: "qa" }), /allowed only/);
});

test("generate, check, and migrate remain available in protected environments", () => {
  for (const command of ["generate", "check", "migrate"]) {
    assert.doesNotThrow(() => assertDatabaseCommandAllowed(command, { DEPLOY_ENV: "production" }));
  }
  assert.throws(() => assertDatabaseCommandAllowed("drop", {}), /Unsupported database command/);
});
