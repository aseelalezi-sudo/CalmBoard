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
  registerInvitationEmailSchedule,
  registerAttachmentCleanupSchedule,
  registerAutomationDailySchedule,
  registerAutomationEventSchedule,
  registerFormSubmissionSchedule,
  registerNotificationEmailSchedule,
  registerTaskReminderSchedule,
  registerWorkspaceExportSchedule,
  registerScheduledReportSchedule,
  registerBillingGracePeriodSchedule,
  registerDataLifecycleSchedule,
} from "./job-scheduler.js";
import { authEmailJobName, createResendAuthEmailTransport, deliverAuthEmails } from "./auth-email.js";
import {
  createResendInvitationEmailTransport,
  deliverInvitationEmails,
  invitationEmailJobName,
} from "./invitation-email.js";
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
import {
  cleanupExpiredExports,
  createWorkspaceExportStorage,
  processWorkspaceExports,
  readWorkspaceExportOptions,
  workspaceExportJobName,
} from "./workspace-exports.js";
import { enqueueScheduledReports, scheduledReportJobName } from "./scheduled-reports.js";
import { billingGracePeriodJobName, expireBillingGracePeriods } from "./billing-grace-periods.js";
import { dataLifecycleJobName, processDataLifecycle, retryFailedDataLifecycleRequest } from "./data-lifecycle.js";

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
  invitationEmail: ReturnType<typeof createResendInvitationEmailTransport>;
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
        case invitationEmailJobName:
          return deliverInvitationEmails(dependencies.pool, dependencies.invitationEmail);
        case automationEventJobName:
          return processAutomationEvents(dependencies.pool);
        case automationDailyJobName:
          return enqueueDailyAutomationEvents(dependencies.pool);
        case formSubmissionJobName:
          return processFormSubmissionTasks(dependencies.pool);
        case workspaceExportJobName: {
          const options = readWorkspaceExportOptions();
          const processing = await processWorkspaceExports(dependencies.pool, dependencies.workspaceExport, options);
          const cleanup =
            dependencies.workspaceExport.deleteObject && dependencies.workspaceExport.objectExists
              ? await cleanupExpiredExports(dependencies.pool, dependencies.workspaceExport, options)
              : { selected: 0, cleaned: 0, failed: 0 };
          return { processing, cleanup };
        }
        case scheduledReportJobName:
          return enqueueScheduledReports(dependencies.pool);
        case billingGracePeriodJobName:
          return expireBillingGracePeriods(dependencies.pool);
        case dataLifecycleJobName:
          if (!dependencies.workspaceExport.deleteObject || !dependencies.workspaceExport.objectExists) {
            throw new Error("Workspace export storage deletion verification is unavailable");
          }
          if (job.data?.action === "retry") {
            const subjectType = job.data.subjectType;
            const requestId = job.data.requestId;
            if (
              (subjectType !== "account" && subjectType !== "organization") ||
              typeof requestId !== "string" ||
              !/^[0-9a-f-]{36}$/i.test(requestId)
            ) {
              throw new Error("Invalid trusted data lifecycle retry payload");
            }
            const retried = await retryFailedDataLifecycleRequest(dependencies.pool, subjectType, requestId);
            if (!retried) throw new Error("Failed data lifecycle request is unavailable");
          }
          return processDataLifecycle(dependencies.pool, undefined, {
            organizationStorage: {
              deleteReference: dependencies.storage.deleteReference,
              referenceExists: dependencies.storage.referenceExists,
              deleteObject: dependencies.workspaceExport.deleteObject,
              objectExists: dependencies.workspaceExport.objectExists,
            },
          });
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
  const invitationEmail = createResendInvitationEmailTransport();
  const workspaceExport = createWorkspaceExportStorage();
  const queue = new Queue(queueName, { connection: { url: redisUrl } });
  await Promise.all([
    registerAttachmentCleanupSchedule(queue),
    registerTaskReminderSchedule(queue),
    registerNotificationEmailSchedule(queue),
    registerAuthEmailSchedule(queue),
    registerInvitationEmailSchedule(queue),
    registerAutomationEventSchedule(queue),
    registerAutomationDailySchedule(queue),
    registerFormSubmissionSchedule(queue),
    registerWorkspaceExportSchedule(queue),
    registerScheduledReportSchedule(queue),
    registerBillingGracePeriodSchedule(queue),
    registerDataLifecycleSchedule(queue),
  ]);
  const worker = createWorker({ pool, storage, notificationEmail, authEmail, invitationEmail, workspaceExport });
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

  // PORT belongs to the web process in the shared root .env. The worker must
  // use its own setting so local `dev:all` never competes with Next.js.
  const healthPort = process.env.WORKER_HEALTH_PORT ? parseInt(process.env.WORKER_HEALTH_PORT, 10) : 3002;
  const healthServer = startHealthServer(healthPort, async () => {
    await queue.getJobCounts("waiting");
  });

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
