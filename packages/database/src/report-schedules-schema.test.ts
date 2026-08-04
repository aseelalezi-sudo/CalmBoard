import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getTableColumns } from "drizzle-orm";
import { exportJobs, notificationEmailOutbox, reportScheduleRecipients, reportSchedules } from "./schema.js";

describe("scheduled report persistence schema", () => {
  it("stores tenant-scoped recurrence and relational recipients", () => {
    const schedule = getTableColumns(reportSchedules);
    const recipient = getTableColumns(reportScheduleRecipients);
    assert.equal(schedule.organizationId.notNull, true);
    assert.equal(schedule.workspaceId.notNull, true);
    assert.equal(schedule.createdBy.notNull, true);
    assert.equal(schedule.nextRunAt.notNull, true);
    assert.equal(schedule.version.notNull, true);
    assert.equal(recipient.scheduleId.notNull, true);
    assert.equal(recipient.userId.notNull, true);
  });

  it("links scheduled exports and optional email attachments", () => {
    const job = getTableColumns(exportJobs);
    const email = getTableColumns(notificationEmailOutbox);
    assert.equal(job.reportScheduleId.notNull, false);
    assert.equal(job.scheduledFor.notNull, false);
    assert.equal(email.attachmentObjectKey.notNull, false);
    assert.equal(email.attachmentFileName.notNull, false);
  });
});
