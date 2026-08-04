import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import { eq, inArray } from "drizzle-orm";
import {
  createIdempotencyRepository,
  db,
  hashIdempotencyRequest,
  idempotencyKeys,
  IdempotencyKeyReuseError,
  IdempotencyRequestInProgressError,
  memberships,
  organizations,
  pool,
  users,
  workspaces,
} from "../src/index";

after(async () => {
  await pool.end();
});

describe("idempotency execution", () => {
  it("replays completed work, rejects conflicts, serializes concurrency, and recovers failed or stale work", async () => {
    const organizationId = randomUUID();
    const workspaceId = randomUUID();
    const otherWorkspaceId = randomUUID();
    const actorId = randomUUID();

    try {
      await db.insert(users).values({
        id: actorId,
        email: `idempotency-${actorId}@example.test`,
        name: "Idempotency actor",
      });
      await db.insert(organizations).values({
        id: organizationId,
        name: "Idempotency tenant",
        slug: `idempotency-${organizationId}`,
      });
      await db.insert(workspaces).values([
        { id: workspaceId, organizationId, name: "Idempotency workspace", slug: `idempotency-${workspaceId}` },
        {
          id: otherWorkspaceId,
          organizationId,
          name: "Other idempotency workspace",
          slug: `idempotency-${otherWorkspaceId}`,
        },
      ]);
      await db.insert(memberships).values({
        userId: actorId,
        organizationId,
        workspaceId,
        role: "member",
        status: "active",
      });

      const repository = createIdempotencyRepository({ organizationId, workspaceId, actorId });
      let completedExecutions = 0;
      const completedKey = `create-${randomUUID()}`;
      const first = await repository.execute({
        key: completedKey,
        scope: "tasks.create",
        request: { title: "Stable", nested: { priority: "high", order: 1 } },
        operation: async () => {
          completedExecutions += 1;
          return { body: { id: "task-1", created: true }, statusCode: 201 };
        },
      });
      const replay = await repository.execute({
        key: completedKey,
        scope: "tasks.create",
        request: { nested: { order: 1, priority: "high" }, title: "Stable" },
        operation: async () => {
          completedExecutions += 1;
          return { body: { id: "should-not-run" } };
        },
      });
      assert.deepEqual(first, { body: { id: "task-1", created: true }, statusCode: 201, replayed: false });
      assert.deepEqual(replay, { body: { id: "task-1", created: true }, statusCode: 201, replayed: true });
      assert.equal(completedExecutions, 1);

      const conflictKey = `conflict-${randomUUID()}`;
      await repository.execute({
        key: conflictKey,
        scope: "comments.create",
        request: { body: "First" },
        operation: async () => ({ body: { id: "comment-1" } }),
      });
      await assert.rejects(
        () =>
          repository.execute({
            key: conflictKey,
            scope: "comments.create",
            request: { body: "Changed" },
            operation: async () => ({ body: { id: "comment-2" } }),
          }),
        (error: unknown) => error instanceof IdempotencyKeyReuseError,
      );

      const concurrentKey = `concurrent-${randomUUID()}`;
      let releaseOperation!: () => void;
      let signalStarted!: () => void;
      const started = new Promise<void>((resolve) => {
        signalStarted = resolve;
      });
      const release = new Promise<void>((resolve) => {
        releaseOperation = resolve;
      });
      const running = repository.execute({
        key: concurrentKey,
        scope: "tasks.update",
        request: { id: "task-1", status: "done" },
        operation: async () => {
          signalStarted();
          await release;
          return { body: { updated: true } };
        },
      });
      await started;
      await assert.rejects(
        () =>
          repository.execute({
            key: concurrentKey,
            scope: "tasks.update",
            request: { id: "task-1", status: "done" },
            operation: async () => ({ body: { duplicate: true } }),
          }),
        (error: unknown) => error instanceof IdempotencyRequestInProgressError,
      );
      releaseOperation();
      await running;

      const retryKey = `retry-${randomUUID()}`;
      await assert.rejects(
        () =>
          repository.execute({
            key: retryKey,
            scope: "forms.submit",
            request: { response: 1 },
            operation: async () => {
              throw new Error("temporary failure");
            },
          }),
        /temporary failure/,
      );
      const retried = await repository.execute({
        key: retryKey,
        scope: "forms.submit",
        request: { response: 1 },
        operation: async () => ({ body: { accepted: true } }),
      });
      assert.equal(retried.replayed, false);
      const [retriedRow] = await db.select().from(idempotencyKeys).where(eq(idempotencyKeys.key, retryKey));
      assert.equal(retriedRow.attempts, 2);

      const staleKey = `stale-${randomUUID()}`;
      await db.insert(idempotencyKeys).values({
        organizationId,
        workspaceId,
        actorId,
        key: staleKey,
        scope: "webhooks.deliver",
        requestHash: hashIdempotencyRequest({ event: "task.created" }),
        lockToken: randomUUID(),
        lockedAt: new Date(Date.now() - 10 * 60 * 1_000),
        expiresAt: new Date(Date.now() + 60 * 60 * 1_000),
      });
      const recovered = await repository.execute({
        key: staleKey,
        scope: "webhooks.deliver",
        request: { event: "task.created" },
        staleLockMs: 60_000,
        operation: async () => ({ body: { delivered: true } }),
      });
      assert.deepEqual(recovered.body, { delivered: true });

      const [completedRow] = await db.select().from(idempotencyKeys).where(eq(idempotencyKeys.key, conflictKey));
      await assert.rejects(
        () =>
          db
            .update(idempotencyKeys)
            .set({ responseBody: { tampered: true } })
            .where(eq(idempotencyKeys.id, completedRow.id)),
        (error: unknown) =>
          (error as { cause?: { message?: string } }).cause?.message === "A completed idempotency result is immutable",
      );
      await assert.rejects(
        () =>
          db.insert(idempotencyKeys).values({
            organizationId,
            workspaceId: randomUUID(),
            actorId,
            key: `cross-${randomUUID()}`,
            scope: "tasks.create",
            requestHash: "a".repeat(64),
            lockToken: randomUUID(),
            expiresAt: new Date(Date.now() + 60_000),
          }),
        (error: unknown) =>
          (error as { cause?: { message?: string } }).cause?.message ===
          "Idempotency key workspace does not belong to its organization",
      );
    } finally {
      await db
        .delete(idempotencyKeys)
        .where(eq(idempotencyKeys.organizationId, organizationId))
        .catch(() => undefined);
      await db
        .delete(memberships)
        .where(eq(memberships.organizationId, organizationId))
        .catch(() => undefined);
      await db
        .delete(workspaces)
        .where(inArray(workspaces.id, [workspaceId, otherWorkspaceId]))
        .catch(() => undefined);
      await db
        .delete(organizations)
        .where(eq(organizations.id, organizationId))
        .catch(() => undefined);
      await db
        .delete(users)
        .where(eq(users.id, actorId))
        .catch(() => undefined);
    }
  });
});
