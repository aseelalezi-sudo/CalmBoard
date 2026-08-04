import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import { and, count, eq } from "drizzle-orm";
import {
  createIdempotencyRepository,
  createTasksRepository,
  db,
  IdempotencyKeyReuseError,
  organizations,
  pool,
  projects,
  tasks,
  withTenantTransaction,
  workspaces,
} from "../src/index";

after(async () => {
  await pool.end();
});

describe("idempotent task import", () => {
  it("replays completed imports and rolls back partial batches", async () => {
    const organizationId = randomUUID();
    const workspaceId = randomUUID();
    const projectId = randomUUID();
    const context = { organizationId, workspaceId };
    const importKey = `task-import-${randomUUID()}`;

    try {
      await db.insert(organizations).values({
        id: organizationId,
        name: "Task import tenant",
        slug: `task-import-${organizationId}`,
      });
      await db.insert(workspaces).values({
        id: workspaceId,
        organizationId,
        name: "Task import workspace",
        slug: `task-import-${workspaceId}`,
      });
      await db.insert(projects).values({ id: projectId, organizationId, workspaceId, name: "Imported tasks" });

      let executions = 0;
      const importTasks = (request: Array<{ projectId: string; title: string }>) =>
        withTenantTransaction(context, () =>
          createIdempotencyRepository(context).execute({
            key: importKey,
            scope: "tasks.import",
            request,
            operation: async () => {
              executions += 1;
              const repository = createTasksRepository(context);
              const items = [];
              for (const input of request) items.push(await repository.create(input));
              return { body: { ids: items.map((task) => task.id), importedCount: items.length }, statusCode: 201 };
            },
          }),
        );

      const request = [
        { projectId, title: "Imported one" },
        { projectId, title: "Imported two" },
      ];
      const first = await importTasks(request);
      const replay = await importTasks(request);
      assert.equal(first.replayed, false);
      assert.equal(replay.replayed, true);
      assert.deepEqual(replay.body, first.body);
      assert.equal(executions, 1);
      assert.equal(
        (await db.select({ value: count() }).from(tasks).where(eq(tasks.projectId, projectId)))[0]?.value,
        2,
      );

      await assert.rejects(
        () => importTasks([{ projectId, title: "Different request" }]),
        (error: unknown) => error instanceof IdempotencyKeyReuseError,
      );

      const failedKey = `task-import-${randomUUID()}`;
      await assert.rejects(() =>
        withTenantTransaction(context, () =>
          createIdempotencyRepository(context).execute({
            key: failedKey,
            scope: "tasks.import",
            request: "partial batch",
            operation: async () => {
              const repository = createTasksRepository(context);
              await repository.create({ projectId, title: "Must roll back" });
              await repository.create({ projectId: randomUUID(), title: "Invalid project" });
              return { body: { ok: true } };
            },
          }),
        ),
      );
      assert.equal(
        (
          await db
            .select({ value: count() })
            .from(tasks)
            .where(and(eq(tasks.projectId, projectId), eq(tasks.title, "Must roll back")))
        )[0]?.value,
        0,
      );
    } finally {
      await db
        .delete(tasks)
        .where(eq(tasks.organizationId, organizationId))
        .catch(() => undefined);
      await db
        .delete(projects)
        .where(eq(projects.id, projectId))
        .catch(() => undefined);
      await db
        .delete(workspaces)
        .where(eq(workspaces.id, workspaceId))
        .catch(() => undefined);
      await db
        .delete(organizations)
        .where(eq(organizations.id, organizationId))
        .catch(() => undefined);
    }
  });
});
