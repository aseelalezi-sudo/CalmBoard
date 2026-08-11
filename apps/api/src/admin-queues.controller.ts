import { BadRequestException, Body, Controller, Get, Post } from "@nestjs/common";
import { createDeadLetterQueueRepository } from "@calmboard/database";
import { PlatformAdmin } from "./platform-admin.guard.js";
import { QueueMonitoringService } from "./queue-monitoring.service.js";
import { requiredString, type JsonObject } from "./request-validation.js";

function emptyBullSnapshot(error: unknown) {
  return {
    counts: { active: 0, completed: 0, failed: 0, delayed: 0, total: 0 },
    jobs: [],
    redis: {
      available: false,
      error: error instanceof Error ? error.message : "Redis queue is unavailable",
    },
  };
}

@Controller("admin/queues")
@PlatformAdmin()
export class AdminQueuesController {
  constructor(private readonly queues: QueueMonitoringService) {}

  @Get()
  async snapshot() {
    const [bullResult, deadLetters] = await Promise.all([
      this.queues
        .snapshot()
        .then((snapshot) => ({ ...snapshot, redis: { available: true as const } }))
        .catch(emptyBullSnapshot),
      createDeadLetterQueueRepository().list(),
    ]);
    const deadJobs = deadLetters.map((entry) => ({
      id: `dlq:${entry.source}:${entry.sourceId}`,
      queue: entry.queue,
      name: entry.jobName,
      status: "failed" as const,
      attempts: entry.attempts,
      error: entry.error ?? "The durable job exhausted its retry limit",
      createdAt: entry.failedAt,
    }));
    const jobs = [...deadJobs, ...bullResult.jobs]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, 200);
    return {
      jobs,
      counts: {
        active: bullResult.counts.active,
        completed: bullResult.counts.completed,
        failed: bullResult.counts.failed + deadJobs.length,
        delayed: bullResult.counts.delayed,
        total: bullResult.counts.total + deadJobs.length,
      },
      redis: bullResult.redis,
      durableDeadLetters: deadJobs.length,
    };
  }

  @Post()
  async action(@Body() body: JsonObject) {
    const action = requiredString(body.action, "action");
    if (action === "retry") {
      const jobId = requiredString(body.jobId, "jobId");
      const retried = jobId.startsWith("dlq:")
        ? await this.retryDeadLetter(jobId)
        : jobId.startsWith("bullmq:")
          ? await this.queues.retry(jobId.slice("bullmq:".length))
          : false;
      if (!retried) throw new BadRequestException("The failed job is unavailable or was already retried");
      return { ok: true, retried: 1 };
    }
    if (action === "retry_all_failed") {
      const durable = await createDeadLetterQueueRepository().retryAll();
      try {
        const bull = await this.queues.retryAllFailed();
        return { ok: true, retried: durable + bull, durable, bullmq: bull, redis: { available: true } };
      } catch (error) {
        return {
          ok: true,
          retried: durable,
          durable,
          bullmq: 0,
          redis: {
            available: false,
            error: error instanceof Error ? error.message : "Redis queue is unavailable",
          },
        };
      }
    }
    if (action === "trigger_cleanup") {
      return { ok: true, jobId: await this.queues.triggerAttachmentCleanup() };
    }
    if (action === "retry_data_lifecycle") {
      const subjectType = requiredString(body.subjectType, "subjectType");
      if (subjectType !== "account" && subjectType !== "organization") {
        throw new BadRequestException("subjectType must be account or organization");
      }
      const requestId = requiredString(body.requestId, "requestId");
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
        throw new BadRequestException("requestId must be a UUID");
      }
      return { ok: true, jobId: await this.queues.retryDataLifecycle(subjectType, requestId) };
    }
    throw new BadRequestException("Unsupported queue action");
  }

  private retryDeadLetter(jobId: string) {
    const match = /^dlq:([^:]+):([0-9a-f-]{36})$/i.exec(jobId);
    if (!match) return Promise.resolve(false);
    return createDeadLetterQueueRepository().retry(match[1]!, match[2]!);
  }
}
