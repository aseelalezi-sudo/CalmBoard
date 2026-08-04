import assert from "node:assert/strict";
import test from "node:test";
import { getTableColumns, getTableName } from "drizzle-orm";
import { workloadCapacities, workloadTimeOff } from "./schema.js";

test("workload persistence schema", async (suite) => {
  await suite.test("stores workspace member capacity in minutes and workdays", () => {
    assert.equal(getTableName(workloadCapacities), "workload_capacities");
    const columns = getTableColumns(workloadCapacities);
    assert.equal(columns.organizationId.notNull, true);
    assert.equal(columns.workspaceId.notNull, true);
    assert.equal(columns.userId.notNull, true);
    assert.equal(columns.weeklyMinutes.notNull, true);
    assert.equal(columns.workdayMask.notNull, true);
  });

  await suite.test("stores dated member leave and workspace holidays", () => {
    assert.equal(getTableName(workloadTimeOff), "workload_time_off");
    const columns = getTableColumns(workloadTimeOff);
    assert.equal(columns.organizationId.notNull, true);
    assert.equal(columns.workspaceId.notNull, true);
    assert.equal(columns.userId.notNull, false);
    assert.equal(columns.startsOn.notNull, true);
    assert.equal(columns.endsOn.notNull, true);
    assert.equal(columns.status.notNull, true);
  });
});
