import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getTableColumns, getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { timeLogs, timesheets } from "./schema.js";

describe("timesheet persistence schema", () => {
  it("stores tenant-scoped review and locking state", () => {
    assert.equal(getTableName(timesheets), "timesheets");
    const columns = getTableColumns(timesheets);
    assert.equal(columns.organizationId.notNull, true);
    assert.equal(columns.workspaceId.notNull, true);
    assert.equal(columns.userId.notNull, true);
    assert.equal(columns.periodStart.notNull, true);
    assert.equal(columns.periodEnd.notNull, true);
    assert.equal(columns.status.notNull, true);
    assert.equal(columns.version.notNull, true);
    assert.equal(getTableConfig(timesheets).indexes.length, 2);
  });

  it("assigns every time entry to one period with an immutable audit lifecycle", () => {
    const columns = getTableColumns(timeLogs);
    assert.equal(columns.timesheetId.notNull, true);
    assert.equal(columns.endedAt.notNull, true);
    assert.equal(columns.billable.notNull, true);
    assert.equal(columns.updatedAt.notNull, true);
    assert.equal(columns.deletedAt.notNull, false);
    assert.equal(getTableConfig(timeLogs).indexes.length, 2);
  });
});
