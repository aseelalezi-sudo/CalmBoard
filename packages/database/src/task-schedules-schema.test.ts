import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getTableColumns } from "drizzle-orm";
import { taskRecurrenceRules, taskReminders } from "./schema.js";

describe("task schedules schema", () => {
  it("keeps reminders and recurrence rules directly tenant and project scoped", () => {
    for (const table of [taskReminders, taskRecurrenceRules]) {
      const columns = getTableColumns(table);
      assert.equal(columns.organizationId.notNull, true);
      assert.equal(columns.workspaceId.notNull, true);
      assert.equal(columns.projectId.notNull, true);
      assert.equal(columns.taskId.notNull, true);
      assert.equal(columns.deletedAt.notNull, false);
    }
  });

  it("stores worker-ready schedule state", () => {
    const reminderColumns = getTableColumns(taskReminders);
    const recurrenceColumns = getTableColumns(taskRecurrenceRules);

    assert.equal(reminderColumns.remindAt.notNull, true);
    assert.equal(reminderColumns.status.notNull, true);
    assert.equal(recurrenceColumns.frequency.notNull, true);
    assert.equal(recurrenceColumns.timezone.notNull, true);
    assert.equal(recurrenceColumns.nextOccurrenceAt.notNull, true);
    assert.equal(recurrenceColumns.occurrencesCreated.notNull, true);
  });
});
