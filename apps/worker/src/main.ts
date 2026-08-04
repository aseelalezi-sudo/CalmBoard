import "./instrumentation.js";
import { Queue, Worker } from "bullmq";
import { pino } from "pino";
import * as Sentry from "@sentry/node";
import { nodeProfilingIntegration } from "@sentry/profiling-node";
import {
  attachmentCleanupJobName,
  cleanupOrphanAttachments,
  createAttachmentCleanupPool,
  createCleanupStorage,
} from "./attachment-cleanup.js";
import {
  registerAuthEmailSchedule,
  registerAttachmentCleanupSchedule,
  registerAutomationDailySchedule,
  registerAutomationEventSchedule,
  registerFormSubmissionSchedule,
  registerNotificationEmailSchedule,
  registerTaskReminderSchedule,
  registerWorkspaceExportSchedule,
  registerScheduledReportSchedule,
  registerBillingGracePeriodSchedule,
} from "./job-scheduler.js";
import { authEmailJobName, createResendAuthEmailTransport, deliverAuthEmails } from "./auth-email.js";
import {
  automationDailyJobName,
  automationEventJobName,
  enqueueDailyAutomationEvents,
  processAutomationEvents,
} from "./automation-events.js";
import { formSubmissionJobName, processFormSubmissionTasks } from "./form-submissions.js";
import {
  createResendNotificationEmailTransport,
  deliverNotificationEmails,
  notificationEmailJobName,
} from "./notification-email.js";
import { dispatchDueTaskReminders, taskReminderJobName } from "./task-reminders.js";
import { createWorkspaceExportStorage, processWorkspaceExports, workspaceExportJobName } from "./workspace-exports.js";
import { enqueueScheduledReports, scheduledReportJobName } from "./scheduled-reports.js";
import { billingGracePeriodJobName, expireBillingGracePeriods } from "./billing-grace-periods.js";

const queueName = process.env.CALMBOARD_QUEUE_NAME ?? "calmboard-default";
const redisUrl = process.env.REDIS_URL ?? "redis://127.0.0.1:6379/0";
const sentryTracesSampleRate = Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1);
const sentryProfilesSampleRate = Number(process.env.SENTRY_PROFILES_SAMPLE_RATE ?? 0.1);

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  integrations: [nodeProfilingIntegration()],
  tracesSampleRate: Number.isFinite(sentryTracesSampleRate) ? sentryTracesSampleRate : 0.1,
  profilesSampleRate: Number.isFinite(sentryProfilesSampleRate) ? sentryProfilesSampleRate : 0.1,
  enabled: process.env.NODE_ENV === "production" && Boolean(process.env.SENTRY_DSN),
});

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport: process.env.NODE_ENV !== "production" ? { target: "pino-pretty" } : undefined,
});

type WorkerDependencies = {
  pool: ReturnType<typeof createAttachmentCleanupPool>;
  storage: ReturnType<typeof createCleanupStorage>;
  notificationEmail: ReturnType<typeof createResendNotificationEmailTransport>;
  authEmail: ReturnType<typeof createResendAuthEmailTransport>;
  workspaceExport: ReturnType<typeof createWorkspaceExportStorage>;
};

export function createWorker(dependencies: WorkerDependencies) {
  return new Worker(
    queueName,
    async (job) => {
      switch (job.name) {
        case attachmentCleanupJobName:
          return cleanupOrphanAttachments(dependencies.pool, dependencies.storage);
        case taskReminderJobName:
          return dispatchDueTaskReminders(dependencies.pool);
        case notificationEmailJobName:
          return deliverNotificationEmails(
            dependencies.pool,
            dependencies.notificationEmail,
            undefined,
            dependencies.workspaceExport.getObject ? { getObject: dependencies.workspaceExport.getObject } : undefined,
          );
        case authEmailJobName:
          return deliverAuthEmails(dependencies.pool, dependencies.authEmail);
        case automationEventJobName:
          return processAutomationEvents(dependencies.pool);
        case automationDailyJobName:
          return enqueueDailyAutomationEvents(dependencies.pool);
        case formSubmissionJobName:
          return processFormSubmissionTasks(dependencies.pool);
        case workspaceExportJobName:
          return processWorkspaceExports(dependencies.pool, dependencies.workspaceExport);
        case scheduledReportJobName:
          return enqueueScheduledReports(dependencies.pool);
        case billingGracePeriodJobName:
          return expireBillingGracePeriods(dependencies.pool);
        default:
          throw new Error(`Unsupported job: ${job.name}`);
      }
    },
    {
      connection: { url: redisUrl },
      concurrency: 1,
    },
  );
}

import { startHealthServer, workerJobDurationSeconds, workerJobsTotal, workerQueueJobs } from "./health.js";

async function startWorker() {
  if (!process.env.REDIS_URL && process.env.NODE_ENV === "production") {
    throw new Error("REDIS_URL is required by the worker in production");
  }
  const pool = createAttachmentCleanupPool();
  const storage = createCleanupStorage();
  const notificationEmail = createResendNotificationEmailTransport();
  const authEmail = createResendAuthEmailTransport();
  const workspaceExport = createWorkspaceExportStorage();
  const queue = new Queue(queueName, { connection: { url: redisUrl } });
  await Promise.all([
    registerAttachmentCleanupSchedule(queue),
    registerTaskReminderSchedule(queue),
    registerNotificationEmailSchedule(queue),
    registerAuthEmailSchedule(queue),
    registerAutomationEventSchedule(queue),
    registerAutomationDailySchedule(queue),
    registerFormSubmissionSchedule(queue),
    registerWorkspaceExportSchedule(queue),
    registerScheduledReportSchedule(queue),
    registerBillingGracePeriodSchedule(queue),
  ]);
  const worker = createWorker({ pool, storage, notificationEmail, authEmail, workspaceExport });
  worker.on("failed", (job, error) => {
    workerJobsTotal.inc({ job_name: job?.name ?? "unknown", result: "failed" });
    if (job?.processedOn && job.finishedOn) {
      workerJobDurationSeconds.observe({ job_name: job.name }, (job.finishedOn - job.processedOn) / 1000);
    }
    logger.error({ err: error, jobId: job?.id, jobName: job?.name }, `CalmBoard job ${job?.name ?? "unknown"} failed`);
    Sentry.captureException(error, { extra: { jobId: job?.id, jobName: job?.name } });
  });
  worker.on("completed", (job) => {
    workerJobsTotal.inc({ job_name: job.name, result: "completed" });
    if (job.processedOn && job.finishedOn) {
      workerJobDurationSeconds.observe({ job_name: job.name }, (job.finishedOn - job.processedOn) / 1000);
    }
  });
  logger.info({ queue: queueName, redis: redisUrl }, `CalmBoard worker listening`);

  const collectQueueMetrics = async () => {
    try {
      const counts = await queue.getJobCounts(
        "active",
        "completed",
        "delayed",
        "failed",
        "paused",
        "prioritized",
        "waiting",
      );
      for (const [state, count] of Object.entries(counts)) workerQueueJobs.set({ state }, count);
    } catch (error) {
      logger.warn({ err: error }, "Unable to collect queue metrics");
    }
  };
  await collectQueueMetrics();
  const queueMetricsTimer = setInterval(() => void collectQueueMetrics(), 30_000);
  queueMetricsTimer.unref();

  const healthPort = process.env.PORT ? parseInt(process.env.PORT, 10) : 3002;
  const healthServer = startHealthServer(healthPort);

  const shutdown = async () => {
    clearInterval(queueMetricsTimer);
    healthServer.close();
    await worker.close();
    await queue.close();
    await pool.end();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

if (process.env.NODE_ENV !== "test") {
  void startWorker().catch((error: unknown) => {
    logger.fatal({ err: error }, "Worker crashed");
    Sentry.captureException(error);
    process.exit(1);
  });
}
