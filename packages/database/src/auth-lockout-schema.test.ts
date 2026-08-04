import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getTableColumns } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { users } from "./schema.js";

describe("progressive account lockout schema", () => {
  it("persists failure, lock, and successful login state", () => {
    const columns = getTableColumns(users);
    assert.equal(columns.failedLoginAttempts.notNull, true);
    assert.equal(columns.failedLoginAttempts.default, 0);
    assert.ok(columns.lockedUntil);
    assert.ok(columns.lastFailedLoginAt);
    assert.ok(columns.lastLoginAt);
    const config = getTableConfig(users);
    assert.ok(config.indexes.some((index) => index.config.name === "users_locked_until_idx"));
    assert.ok(config.checks.some((constraint) => constraint.name === "users_login_lock_state_check"));
  });
});
