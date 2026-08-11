import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { Queue, type Job, type JobType } from "bullmq";
import { randomUUID } from "node:crypto";

const monitoredStates: JobType[] = ["active", "completed", "failed", "delayed", "waiting"];

export type BullQueueJob = {
  id: string;
  queue: string;
  name: string;
  status: "active" | "completed" | "failed" | "delayed";
  attempts: number;
  durationMs?: number;
  error?: string;
  createdAt: string;
};

function publicJob(job: Job, state: string, queueName: string): BullQueueJob {
  const status =
    state === "completed" ? "completed" : state === "failed" ? "failed" : state === "active" ? "active" : "delayed";
  const durationMs =
    typeof job.processedOn === "number" && typeof job.finishedOn === "number"
      ? Math.max(0, job.finishedOn - job.processedOn)
      : undefined;
  return {
    id: `bullmq:${job.id}`,
    queue: queueName,
    name: job.name,
    status,
    attempts: job.attemptsMade,
    ...(durationMs === undefined ? {} : { durationMs }),
    ...(job.failedReason ? { error: job.failedReason } : {}),
    createdAt: new Date(job.timestamp).toISOString(),
  };
}

@Injectable()
export class QueueMonitoringService implements OnModuleDestroy {
  private queue?: Queue;
  private queueName?: string;

  private getQueue() {
    if (!this.queue) {
      const redisUrl = process.env.REDIS_URL;
      if (!redisUrl) throw new Error("REDIS_URL is required for queue monitoring");
      this.queueName = process.env.CALMBOARD_QUEUE_NAME ?? "calmboard-default";
      this.queue = new Queue(this.queueName, {
        connection: {
          url: redisUrl,
          enableOfflineQueue: false,
          maxRetriesPerRequest: 1,
          connectTimeout: 2_000,
        },
      });
      this.queue.on("error", () => undefined);
    }
    return this.queue;
  }

  async snapshot(limit = 100) {
    const queue = this.getQueue();
    const [counts, jobs] = await Promise.all([
      queue.getJobCounts(...monitoredStates),
      queue.getJobs(monitoredStates, 0, Math.min(Math.max(limit, 1), 500) - 1, true),
    ]);
    const publicJobs = await Promise.all(
      jobs.map(async (job) => publicJob(job, await job.getState(), this.queueName!)),
    );
    return {
      counts: {
        active: counts.active ?? 0,
        completed: counts.completed ?? 0,
        failed: counts.failed ?? 0,
        delayed: (counts.delayed ?? 0) + (counts.waiting ?? 0),
        total:
          (counts.active ?? 0) +
          (counts.completed ?? 0) +
          (counts.failed ?? 0) +
          (counts.delayed ?? 0) +
          (counts.waiting ?? 0),
      },
      jobs: publicJobs,
    };
  }

  async retry(jobId: string) {
    const job = await this.getQueue().getJob(jobId);
    if (!job || (await job.getState()) !== "failed") return false;
    await job.retry("failed");
    return true;
  }

  async retryAllFailed(limit = 500) {
    const jobs = await this.getQueue().getJobs(["failed"], 0, Math.min(Math.max(limit, 1), 500) - 1, true);
    let retried = 0;
    for (const job of jobs) {
      if ((await job.getState()) !== "failed") continue;
      await job.retry("failed");
      retried += 1;
    }
    return retried;
  }

  async triggerAttachmentCleanup() {
    const job = await this.getQueue().add(
      "attachments.cleanup-orphans",
      {},
      {
        jobId: `manual-cleanup-${randomUUID()}`,
        attempts: 5,
        backoff: { type: "exponential", delay: 30_000 },
        removeOnComplete: 500,
        removeOnFail: 1_000,
      },
    );
    return `bullmq:${job.id}`;
  }

  async retryDataLifecycle(subjectType: "account" | "organization", requestId: string) {
    const job = await this.getQueue().add(
      "data-lifecycle.process",
      { action: "retry", subjectType, requestId },
      {
        jobId: `data-lifecycle-retry-${subjectType}-${requestId}-${randomUUID()}`,
        attempts: 3,
        backoff: { type: "exponential", delay: 5_000 },
        removeOnComplete: 500,
        removeOnFail: 1_000,
      },
    );
    return `bullmq:${job.id}`;
  }

  async onModuleDestroy() {
    await this.queue?.close();
  }
}
