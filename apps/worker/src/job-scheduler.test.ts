import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { Queue } from "bullmq";
import { attachmentCleanupJobName } from "./attachment-cleanup.js";
import {
  attachmentCleanupSchedulerId,
  authEmailSchedulerId,
  automationDailySchedulerId,
  automationEventSchedulerId,
  billingGracePeriodSchedulerId,
  formSubmissionSchedulerId,
  notificationEmailSchedulerId,
  registerAttachmentCleanupSchedule,
  registerAutomationDailySchedule,
  registerAuthEmailSchedule,
  registerAutomationEventSchedule,
  registerBillingGracePeriodSchedule,
  registerFormSubmissionSchedule,
  registerNotificationEmailSchedule,
  registerTaskReminderSchedule,
  registerWorkspaceExportSchedule,
  registerScheduledReportSchedule,
  scheduledReportSchedulerId,
  taskReminderSchedulerId,
  workspaceExportSchedulerId,
} from "./job-scheduler.js";
import { authEmailJobName } from "./auth-email.js";
import { automationDailyJobName, automationEventJobName } from "./automation-events.js";
import { formSubmissionJobName } from "./form-submissions.js";
import { notificationEmailJobName } from "./notification-email.js";
import { taskReminderJobName } from "./task-reminders.js";
import { workspaceExportJobName } from "./workspace-exports.js";
import { scheduledReportJobName } from "./scheduled-reports.js";
import { billingGracePeriodJobName } from "./billing-grace-periods.js";

describe("attachment cleanup scheduler", () => {
  it("rejects unsafe scheduling intervals", async () => {
    const queue = {} as Queue;
    await assert.rejects(
      () => registerAttachmentCleanupSchedule(queue, { ATTACHMENT_CLEANUP_INTERVAL_MS: "1000" }),
      /between 60000 and 86400000/,
    );
  });

  it("registers the real repeatable BullMQ jobs", { skip: !process.env.REDIS_URL }, async () => {
    const queue = new Queue(`calmboard-worker-integration-${randomUUID()}`, {
      connection: { url: process.env.REDIS_URL! },
    });
    try {
      await registerAttachmentCleanupSchedule(queue, { ATTACHMENT_CLEANUP_INTERVAL_MS: "60000" });
      await registerTaskReminderSchedule(queue, { TASK_REMINDER_INTERVAL_MS: "60000" });
      await registerNotificationEmailSchedule(queue, { NOTIFICATION_EMAIL_INTERVAL_MS: "30000" });
      await registerAuthEmailSchedule(queue, { AUTH_EMAIL_INTERVAL_MS: "15000" });
      await registerAutomationEventSchedule(queue, { AUTOMATION_EVENT_INTERVAL_MS: "10000" });
      await registerAutomationDailySchedule(queue);
      await registerFormSubmissionSchedule(queue, { FORM_SUBMISSION_INTERVAL_MS: "10000" });
      await registerWorkspaceExportSchedule(queue, { WORKSPACE_EXPORT_INTERVAL_MS: "10000" });
      await registerScheduledReportSchedule(queue, { REPORT_SCHEDULE_INTERVAL_MS: "60000" });
      await registerBillingGracePeriodSchedule(queue, { BILLING_GRACE_PERIOD_INTERVAL_MS: "300000" });
      const cleanupScheduler = await queue.getJobScheduler(attachmentCleanupSchedulerId);
      const reminderScheduler = await queue.getJobScheduler(taskReminderSchedulerId);
      const emailScheduler = await queue.getJobScheduler(notificationEmailSchedulerId);
      const authEmailScheduler = await queue.getJobScheduler(authEmailSchedulerId);
      const automationScheduler = await queue.getJobScheduler(automationEventSchedulerId);
      const automationDailyScheduler = await queue.getJobScheduler(automationDailySchedulerId);
      const formSubmissionScheduler = await queue.getJobScheduler(formSubmissionSchedulerId);
      const workspaceExportScheduler = await queue.getJobScheduler(workspaceExportSchedulerId);
      const scheduledReportScheduler = await queue.getJobScheduler(scheduledReportSchedulerId);
      const billingGracePeriodScheduler = await queue.getJobScheduler(billingGracePeriodSchedulerId);
      assert.equal(cleanupScheduler?.name, attachmentCleanupJobName);
      assert.equal(cleanupScheduler?.every, 60_000);
      assert.equal(reminderScheduler?.name, taskReminderJobName);
      assert.equal(reminderScheduler?.every, 60_000);
      assert.equal(emailScheduler?.name, notificationEmailJobName);
      assert.equal(emailScheduler?.every, 30_000);
      assert.equal(authEmailScheduler?.name, authEmailJobName);
      assert.equal(authEmailScheduler?.every, 15_000);
      assert.equal(automationScheduler?.name, automationEventJobName);
      assert.equal(automationScheduler?.every, 10_000);
      assert.equal(automationDailyScheduler?.name, automationDailyJobName);
      assert.equal(automationDailyScheduler?.pattern, "0 0 * * *");
      assert.equal(formSubmissionScheduler?.name, formSubmissionJobName);
      assert.equal(formSubmissionScheduler?.every, 10_000);
      assert.equal(workspaceExportScheduler?.name, workspaceExportJobName);
      assert.equal(workspaceExportScheduler?.every, 10_000);
      assert.equal(scheduledReportScheduler?.name, scheduledReportJobName);
      assert.equal(scheduledReportScheduler?.every, 60_000);
      assert.equal(billingGracePeriodScheduler?.name, billingGracePeriodJobName);
      assert.equal(billingGracePeriodScheduler?.every, 300_000);
    } finally {
      await queue.removeJobScheduler(attachmentCleanupSchedulerId);
      await queue.removeJobScheduler(taskReminderSchedulerId);
      await queue.removeJobScheduler(notificationEmailSchedulerId);
      await queue.removeJobScheduler(authEmailSchedulerId);
      await queue.removeJobScheduler(automationEventSchedulerId);
      await queue.removeJobScheduler(automationDailySchedulerId);
      await queue.removeJobScheduler(formSubmissionSchedulerId);
      await queue.removeJobScheduler(workspaceExportSchedulerId);
      await queue.removeJobScheduler(scheduledReportSchedulerId);
      await queue.removeJobScheduler(billingGracePeriodSchedulerId);
      await queue.close();
    }
  });

  it("rejects unsafe reminder polling intervals", async () => {
    const queue = {} as Queue;
    await assert.rejects(
      () => registerTaskReminderSchedule(queue, { TASK_REMINDER_INTERVAL_MS: "1000" }),
      /between 10000 and 900000/,
    );
  });

  it("registers reminder retries with exponential backoff", async () => {
    let scheduler: unknown;
    const queue = {
      async upsertJobScheduler(...args: unknown[]) {
        scheduler = args;
      },
    } as unknown as Queue;

    await registerTaskReminderSchedule(queue, { TASK_REMINDER_INTERVAL_MS: "60000" });
    assert.deepEqual(scheduler, [
      taskReminderSchedulerId,
      { every: 60_000 },
      {
        name: taskReminderJobName,
        data: {},
        opts: {
          attempts: 5,
          backoff: { type: "exponential", delay: 5_000 },
          removeOnComplete: 500,
          removeOnFail: 1_000,
        },
      },
    ]);
  });

  it("registers notification email retries with exponential backoff", async () => {
    let scheduler: unknown;
    const queue = {
      async upsertJobScheduler(...args: unknown[]) {
        scheduler = args;
      },
    } as unknown as Queue;

    await registerNotificationEmailSchedule(queue, { NOTIFICATION_EMAIL_INTERVAL_MS: "30000" });
    assert.deepEqual(scheduler, [
      notificationEmailSchedulerId,
      { every: 30_000 },
      {
        name: notificationEmailJobName,
        data: {},
        opts: {
          attempts: 5,
          backoff: { type: "exponential", delay: 5_000 },
          removeOnComplete: 500,
          removeOnFail: 1_000,
        },
      },
    ]);
  });

  it("registers authentication email retries with exponential backoff", async () => {
    let scheduler: unknown;
    const queue = {
      async upsertJobScheduler(...args: unknown[]) {
        scheduler = args;
      },
    } as unknown as Queue;

    await registerAuthEmailSchedule(queue, { AUTH_EMAIL_INTERVAL_MS: "15000" });
    assert.deepEqual(scheduler, [
      authEmailSchedulerId,
      { every: 15_000 },
      {
        name: authEmailJobName,
        data: {},
        opts: {
          attempts: 5,
          backoff: { type: "exponential", delay: 5_000 },
          removeOnComplete: 500,
          removeOnFail: 1_000,
        },
      },
    ]);
  });

  it("registers automation event retries with exponential backoff", async () => {
    let scheduler: unknown;
    const queue = {
      async upsertJobScheduler(...args: unknown[]) {
        scheduler = args;
      },
    } as unknown as Queue;

    await registerAutomationEventSchedule(queue, { AUTOMATION_EVENT_INTERVAL_MS: "10000" });
    assert.deepEqual(scheduler, [
      automationEventSchedulerId,
      { every: 10_000 },
      {
        name: automationEventJobName,
        data: {},
        opts: {
          attempts: 5,
          backoff: { type: "exponential", delay: 5_000 },
          removeOnComplete: 500,
          removeOnFail: 1_000,
        },
      },
    ]);
  });

  it("registers the daily automation event source", async () => {
    let scheduler: unknown;
    const queue = {
      async upsertJobScheduler(...args: unknown[]) {
        scheduler = args;
      },
    } as unknown as Queue;

    await registerAutomationDailySchedule(queue);
    assert.deepEqual(scheduler, [
      automationDailySchedulerId,
      { pattern: "0 0 * * *" },
      {
        name: automationDailyJobName,
        data: {},
        opts: {
          attempts: 5,
          backoff: { type: "exponential", delay: 30_000 },
          removeOnComplete: 100,
          removeOnFail: 500,
        },
      },
    ]);
  });

  it("registers form task creation retries with exponential backoff", async () => {
    let scheduler: unknown;
    const queue = {
      async upsertJobScheduler(...args: unknown[]) {
        scheduler = args;
      },
    } as unknown as Queue;

    await registerFormSubmissionSchedule(queue, { FORM_SUBMISSION_INTERVAL_MS: "10000" });
    assert.deepEqual(scheduler, [
      formSubmissionSchedulerId,
      { every: 10_000 },
      {
        name: formSubmissionJobName,
        data: {},
        opts: {
          attempts: 5,
          backoff: { type: "exponential", delay: 5_000 },
          removeOnComplete: 500,
          removeOnFail: 1_000,
        },
      },
    ]);
  });

  it("registers workspace export retries with exponential backoff", async () => {
    let scheduler: unknown;
    const queue = {
      async upsertJobScheduler(...args: unknown[]) {
        scheduler = args;
      },
    } as unknown as Queue;

    await registerWorkspaceExportSchedule(queue, { WORKSPACE_EXPORT_INTERVAL_MS: "10000" });
    assert.deepEqual(scheduler, [
      workspaceExportSchedulerId,
      { every: 10_000 },
      {
        name: workspaceExportJobName,
        data: {},
        opts: {
          attempts: 5,
          backoff: { type: "exponential", delay: 30_000 },
          removeOnComplete: 500,
          removeOnFail: 1_000,
        },
      },
    ]);
  });

  it("registers scheduled report retries with exponential backoff", async () => {
    let scheduler: unknown;
    const queue = {
      async upsertJobScheduler(...args: unknown[]) {
        scheduler = args;
      },
    } as unknown as Queue;

    await registerScheduledReportSchedule(queue, { REPORT_SCHEDULE_INTERVAL_MS: "60000" });
    assert.deepEqual(scheduler, [
      scheduledReportSchedulerId,
      { every: 60_000 },
      {
        name: scheduledReportJobName,
        data: {},
        opts: {
          attempts: 5,
          backoff: { type: "exponential", delay: 30_000 },
          removeOnComplete: 500,
          removeOnFail: 1_000,
        },
      },
    ]);
  });

  it("registers grace-period expiry retries with exponential backoff", async () => {
    let scheduler: unknown;
    const queue = {
      async upsertJobScheduler(...args: unknown[]) {
        scheduler = args;
      },
    } as unknown as Queue;

    await registerBillingGracePeriodSchedule(queue, { BILLING_GRACE_PERIOD_INTERVAL_MS: "300000" });
    assert.deepEqual(scheduler, [
      billingGracePeriodSchedulerId,
      { every: 300_000 },
      {
        name: billingGracePeriodJobName,
        data: {},
        opts: {
          attempts: 5,
          backoff: { type: "exponential", delay: 30_000 },
          removeOnComplete: 500,
          removeOnFail: 1_000,
        },
      },
    ]);
  });
});
