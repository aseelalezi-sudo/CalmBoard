import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import {
  createProjectWorkflowRepository,
  createTasksRepository,
  db,
  organizations,
  pool,
  projects,
  tasks,
  TenantConflictError,
  withTenantTransaction,
  workspaces,
} from "../src/index";
import { eq } from "drizzle-orm";

after(async () => {
  await pool.end();
});

describe("transactional Kanban ordering and WIP limits", () => {
  it("persists column order and rejects stale or over-limit moves", async () => {
    const organizationId = randomUUID();
    const workspaceId = randomUUID();
    const projectId = randomUUID();
    const firstId = randomUUID();
    const secondId = randomUUID();
    const thirdId = randomUUID();
    try {
      await db.insert(organizations).values({
        id: organizationId,
        name: "Board ordering integration",
        slug: `board-${organizationId}`,
      });
      await db.insert(workspaces).values({
        id: workspaceId,
        organizationId,
        name: "Board workspace",
        slug: `board-${workspaceId}`,
      });
      await db.insert(projects).values({
        id: projectId,
        organizationId,
        workspaceId,
        name: "Board project",
      });
      await db.insert(tasks).values([
        {
          id: firstId,
          organizationId,
          workspaceId,
          projectId,
          serial: "TSK-9901",
          title: "Move first",
          status: "todo",
          order: 0,
        },
        {
          id: secondId,
          organizationId,
          workspaceId,
          projectId,
          serial: "TSK-9902",
          title: "Keep second",
          status: "todo",
          order: 1,
        },
        {
          id: thirdId,
          organizationId,
          workspaceId,
          projectId,
          serial: "TSK-9903",
          title: "Keep third",
          status: "todo",
          order: 2,
        },
      ]);

      await withTenantTransaction({ organizationId, workspaceId }, async () => {
        const workflow = createProjectWorkflowRepository({ organizationId, workspaceId });
        const repository = createTasksRepository({ organizationId, workspaceId });
        assert.deepEqual(await workflow.setWipLimit(projectId, "in_progress", 1), { in_progress: 1 });

        const moved = await repository.move(firstId, {
          status: "in_progress",
          targetIndex: 0,
          expectedVersion: 1,
        });
        assert.equal(moved.task.status, "in_progress");
        assert.equal(moved.task.order, 0);
        assert.equal(moved.task.version, 2);

        const second = await repository.getById(secondId);
        await assert.rejects(
          () =>
            repository.move(secondId, {
              status: "in_progress",
              targetIndex: 1,
              expectedVersion: second.version,
            }),
          (error: unknown) => error instanceof TenantConflictError && /WIP limit/.test(error.message),
        );
        await assert.rejects(
          () =>
            repository.move(thirdId, {
              status: "todo",
              targetIndex: 0,
              expectedVersion: 1,
            }),
          (error: unknown) => error instanceof TenantConflictError && /modified by another request/.test(error.message),
        );

        const secondBeforeAnchoredMove = await repository.getById(secondId);
        const thirdBeforeAnchoredMove = await repository.getById(thirdId);
        const anchored = await repository.move(firstId, {
          status: "todo",
          targetIndex: 1,
          beforeTaskId: secondId,
          afterTaskId: thirdId,
          expectedVersion: moved.task.version,
        });
        const secondAfterAnchoredMove = await repository.getById(secondId);
        const thirdAfterAnchoredMove = await repository.getById(thirdId);

        assert.equal(anchored.task.version, moved.task.version + 1);
        assert.ok(anchored.task.order > secondBeforeAnchoredMove.order);
        assert.ok(anchored.task.order < thirdBeforeAnchoredMove.order);
        assert.equal(secondAfterAnchoredMove.version, secondBeforeAnchoredMove.version);
        assert.equal(thirdAfterAnchoredMove.version, thirdBeforeAnchoredMove.version);
      });
    } finally {
      await db.delete(tasks).where(eq(tasks.organizationId, organizationId));
      await db.delete(projects).where(eq(projects.organizationId, organizationId));
      await db.delete(workspaces).where(eq(workspaces.organizationId, organizationId));
      await db.delete(organizations).where(eq(organizations.id, organizationId));
    }
  });
});
