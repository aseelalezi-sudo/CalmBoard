import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getTableColumns } from "drizzle-orm";
import { users } from "./schema.js";

describe("platform administration schema", () => {
  it("stores an explicit platform administrator flag that defaults to false", () => {
    const columns = getTableColumns(users);
    assert.equal(columns.isPlatformAdmin.notNull, true);
    assert.equal(columns.isPlatformAdmin.default, false);
  });
});
