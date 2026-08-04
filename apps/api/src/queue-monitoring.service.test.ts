import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { Queue, QueueEvents, Worker } from "bullmq";
import { QueueMonitoringService } from "./queue-monitoring.service.js";

describe("real BullMQ queue monitoring", () => {
  it("reads failed jobs, retries them, and enqueues a manual cleanup", { skip: !process.env.REDIS_URL }, async () => {
    const previousQueueName = process.env.CALMBOARD_QUEUE_NAME;
    const queueName = `calmboard-monitoring-test-${randomUUID()}`;
    process.env.CALMBOARD_QUEUE_NAME = queueName;
    const connection = { url: process.env.REDIS_URL! };
    const queue = new Queue(queueName, { connection });
    const events = new QueueEvents(queueName, { connection });
    const worker = new Worker(
      queueName,
      async () => {
        throw new Error("intentional queue monitoring failure");
      },
      { connection },
    );
    const monitoring = new QueueMonitoringService();
    try {
      await events.waitUntilReady();
      const failed = await queue.add("monitoring.failure", {}, { attempts: 1, removeOnFail: false });
      await assert.rejects(() => failed.waitUntilFinished(events, 10_000), /intentional queue monitoring failure/);
      await worker.close();

      const failedSnapshot = await monitoring.snapshot();
      assert.equal(failedSnapshot.counts.failed, 1);
      assert.equal(failedSnapshot.jobs[0]?.id, `bullmq:${failed.id}`);
      assert.equal(failedSnapshot.jobs[0]?.status, "failed");
      assert.match(failedSnapshot.jobs[0]?.error ?? "", /intentional queue monitoring failure/);

      assert.equal(await monitoring.retry(failed.id!), true);
      assert.equal(await monitoring.retry(failed.id!), false);
      const waitingSnapshot = await monitoring.snapshot();
      assert.equal(waitingSnapshot.counts.failed, 0);
      assert.equal(
        waitingSnapshot.jobs.some((job) => job.id === `bullmq:${failed.id}`),
        true,
      );

      const cleanupId = await monitoring.triggerAttachmentCleanup();
      assert.match(cleanupId, /^bullmq:manual-cleanup-/);
      const cleanupSnapshot = await monitoring.snapshot();
      assert.equal(
        cleanupSnapshot.jobs.some((job) => job.id === cleanupId),
        true,
      );
    } finally {
      await worker.close().catch(() => undefined);
      await monitoring.onModuleDestroy();
      await events.close();
      await queue.obliterate({ force: true });
      await queue.close();
      if (previousQueueName === undefined) delete process.env.CALMBOARD_QUEUE_NAME;
      else process.env.CALMBOARD_QUEUE_NAME = previousQueueName;
    }
  });
});
