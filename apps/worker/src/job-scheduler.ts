import type { Queue } from "bullmq";
import { attachmentCleanupJobName } from "./attachment-cleanup.js";
import { automationDailyJobName, automationEventJobName } from "./automation-events.js";
import { formSubmissionJobName } from "./form-submissions.js";
import { authEmailJobName } from "./auth-email.js";
import { invitationEmailJobName } from "./invitation-email.js";
import { notificationEmailJobName } from "./notification-email.js";
import { taskReminderJobName } from "./task-reminders.js";
import { workspaceExportJobName } from "./workspace-exports.js";
import { scheduledReportJobName } from "./scheduled-reports.js";
import { billingGracePeriodJobName } from "./billing-grace-periods.js";
import { dataLifecycleJobName } from "./data-lifecycle.js";

export const attachmentCleanupSchedulerId = "attachment-orphan-cleanup-schedule";
export const taskReminderSchedulerId = "task-reminder-dispatch-schedule";
export const notificationEmailSchedulerId = "notification-email-delivery-schedule";
export const authEmailSchedulerId = "auth-email-delivery-schedule";
export const invitationEmailSchedulerId = "invitation-email-delivery-schedule";
export const automationEventSchedulerId = "automation-event-processing-schedule";
export const automationDailySchedulerId = "automation-daily-enqueue-schedule";
export const formSubmissionSchedulerId = "form-submission-task-creation-schedule";
export const workspaceExportSchedulerId = "workspace-export-processing-schedule";
export const scheduledReportSchedulerId = "scheduled-report-enqueue-schedule";
export const billingGracePeriodSchedulerId = "billing-grace-period-expiry-schedule";
export const dataLifecycleSchedulerId = "data-lifecycle-processing-schedule";

export async function registerAttachmentCleanupSchedule(queue: Queue, env: NodeJS.ProcessEnv = process.env) {
  const interval = Number(env.ATTACHMENT_CLEANUP_INTERVAL_MS ?? 15 * 60 * 1000);
  if (!Number.isInteger(interval) || interval < 60_000 || interval > 24 * 60 * 60 * 1000) {
    throw new Error("ATTACHMENT_CLEANUP_INTERVAL_MS must be between 60000 and 86400000");
  }
  await queue.upsertJobScheduler(
    attachmentCleanupSchedulerId,
    { every: interval },
    {
      name: attachmentCleanupJobName,
      data: {},
      opts: {
        attempts: 5,
        backoff: { type: "exponential", delay: 5_000 },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    },
  );
}

export async function registerTaskReminderSchedule(queue: Queue, env: NodeJS.ProcessEnv = process.env) {
  const interval = Number(env.TASK_REMINDER_INTERVAL_MS ?? 60_000);
  if (!Number.isInteger(interval) || interval < 10_000 || interval > 15 * 60 * 1000) {
    throw new Error("TASK_REMINDER_INTERVAL_MS must be between 10000 and 900000");
  }
  await queue.upsertJobScheduler(
    taskReminderSchedulerId,
    { every: interval },
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
  );
}

export async function registerNotificationEmailSchedule(queue: Queue, env: NodeJS.ProcessEnv = process.env) {
  const interval = Number(env.NOTIFICATION_EMAIL_INTERVAL_MS ?? 30_000);
  if (!Number.isInteger(interval) || interval < 5_000 || interval > 15 * 60 * 1000) {
    throw new Error("NOTIFICATION_EMAIL_INTERVAL_MS must be between 5000 and 900000");
  }
  await queue.upsertJobScheduler(
    notificationEmailSchedulerId,
    { every: interval },
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
  );
}

export async function registerAuthEmailSchedule(queue: Queue, env: NodeJS.ProcessEnv = process.env) {
  const interval = Number(env.AUTH_EMAIL_INTERVAL_MS ?? 15_000);
  if (!Number.isInteger(interval) || interval < 5_000 || interval > 15 * 60 * 1000) {
    throw new Error("AUTH_EMAIL_INTERVAL_MS must be between 5000 and 900000");
  }
  await queue.upsertJobScheduler(
    authEmailSchedulerId,
    { every: interval },
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
  );
}

export async function registerInvitationEmailSchedule(queue: Queue, env: NodeJS.ProcessEnv = process.env) {
  const interval = Number(env.INVITATION_EMAIL_INTERVAL_MS ?? 15_000);
  if (!Number.isInteger(interval) || interval < 5_000 || interval > 15 * 60 * 1000) {
    throw new Error("INVITATION_EMAIL_INTERVAL_MS must be between 5000 and 900000");
  }
  await queue.upsertJobScheduler(
    invitationEmailSchedulerId,
    { every: interval },
    {
      name: invitationEmailJobName,
      data: {},
      opts: {
        attempts: 5,
        backoff: { type: "exponential", delay: 5_000 },
        removeOnComplete: 500,
        removeOnFail: 1_000,
      },
    },
  );
}

export async function registerAutomationEventSchedule(queue: Queue, env: NodeJS.ProcessEnv = process.env) {
  const interval = Number(env.AUTOMATION_EVENT_INTERVAL_MS ?? 10_000);
  if (!Number.isInteger(interval) || interval < 5_000 || interval > 15 * 60 * 1000) {
    throw new Error("AUTOMATION_EVENT_INTERVAL_MS must be between 5000 and 900000");
  }
  await queue.upsertJobScheduler(
    automationEventSchedulerId,
    { every: interval },
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
  );
}

export async function registerAutomationDailySchedule(queue: Queue) {
  await queue.upsertJobScheduler(
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
  );
}

export async function registerFormSubmissionSchedule(queue: Queue, env: NodeJS.ProcessEnv = process.env) {
  const interval = Number(env.FORM_SUBMISSION_INTERVAL_MS ?? 10_000);
  if (!Number.isInteger(interval) || interval < 5_000 || interval > 15 * 60 * 1000) {
    throw new Error("FORM_SUBMISSION_INTERVAL_MS must be between 5000 and 900000");
  }
  await queue.upsertJobScheduler(
    formSubmissionSchedulerId,
    { every: interval },
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
  );
}

export async function registerWorkspaceExportSchedule(queue: Queue, env: NodeJS.ProcessEnv = process.env) {
  const interval = Number(env.WORKSPACE_EXPORT_INTERVAL_MS ?? 10_000);
  if (!Number.isInteger(interval) || interval < 5_000 || interval > 15 * 60 * 1000) {
    throw new Error("WORKSPACE_EXPORT_INTERVAL_MS must be between 5000 and 900000");
  }
  await queue.upsertJobScheduler(
    workspaceExportSchedulerId,
    { every: interval },
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
  );
}

export async function registerScheduledReportSchedule(queue: Queue, env: NodeJS.ProcessEnv = process.env) {
  const interval = Number(env.REPORT_SCHEDULE_INTERVAL_MS ?? 60_000);
  if (!Number.isInteger(interval) || interval < 10_000 || interval > 15 * 60 * 1000) {
    throw new Error("REPORT_SCHEDULE_INTERVAL_MS must be between 10000 and 900000");
  }
  await queue.upsertJobScheduler(
    scheduledReportSchedulerId,
    { every: interval },
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
  );
}

export async function registerBillingGracePeriodSchedule(queue: Queue, env: NodeJS.ProcessEnv = process.env) {
  const interval = Number(env.BILLING_GRACE_PERIOD_INTERVAL_MS ?? 5 * 60 * 1000);
  if (!Number.isInteger(interval) || interval < 60_000 || interval > 60 * 60 * 1000) {
    throw new Error("BILLING_GRACE_PERIOD_INTERVAL_MS must be between 60000 and 3600000");
  }
  await queue.upsertJobScheduler(
    billingGracePeriodSchedulerId,
    { every: interval },
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
  );
}

export async function registerDataLifecycleSchedule(queue: Queue, env: NodeJS.ProcessEnv = process.env) {
  const interval = Number(env.DATA_LIFECYCLE_INTERVAL_MS ?? 60_000);
  if (!Number.isInteger(interval) || interval < 10_000 || interval > 15 * 60 * 1000) {
    throw new Error("DATA_LIFECYCLE_INTERVAL_MS must be between 10000 and 900000");
  }
  await queue.upsertJobScheduler(
    dataLifecycleSchedulerId,
    { every: interval },
    {
      name: dataLifecycleJobName,
      data: {},
      opts: {
        attempts: 1,
        removeOnComplete: 500,
        removeOnFail: 1_000,
      },
    },
  );
}
