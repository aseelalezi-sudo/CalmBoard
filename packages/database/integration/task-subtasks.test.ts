import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import { and, eq, isNull } from "drizzle-orm";
import {
  createTasksRepository,
  db,
  organizations,
  pool,
  projects,
  tasks,
  TenantConflictError,
  TenantResourceNotFoundError,
  workspaces,
} from "../src/index";

after(async () => {
  await pool.end();
});

describe("task and subtask domain invariants", () => {
  it("enforces complete subtask lifecycle, query isolation, stats aggregation, and cascade soft-delete", async () => {
    const organizationId = randomUUID();
    const workspaceId = randomUUID();
    const projectId = randomUUID();
    const otherProjectId = randomUUID();
    const otherWorkspaceId = randomUUID();

    try {
      await db.insert(organizations).values({
        id: organizationId,
        name: "Subtask Tenant",
        slug: `subtask-tenant-${organizationId}`,
      });
      await db.insert(workspaces).values([
        {
          id: workspaceId,
          organizationId,
          name: "Subtask Workspace",
          slug: `subtask-ws-${workspaceId}`,
        },
        {
          id: otherWorkspaceId,
          organizationId,
          name: "Other Workspace",
          slug: `other-ws-${otherWorkspaceId}`,
        },
      ]);
      await db.insert(projects).values([
        {
          id: projectId,
          organizationId,
          workspaceId,
          name: "Subtask Main Project",
        },
        {
          id: otherProjectId,
          organizationId,
          workspaceId,
          name: "Other Project",
        },
      ]);

      const repo = createTasksRepository({ organizationId, workspaceId });

      // 1. Create top-level parent task
      const parent = await repo.create({
        projectId,
        title: "Parent Feature Task",
        status: "in_progress",
      });
      assert.equal(parent.parentId, null);
      assert.deepEqual(parent.subtaskStats, { total: 0, done: 0 });

      // 2. Create subtasks under parent
      const subtask1 = await repo.create({
        projectId,
        parentId: parent.id,
        title: "Child Subtask 1",
        status: "todo",
      });
      assert.equal(subtask1.parentId, parent.id);

      const subtask2 = await repo.create({
        projectId,
        parentId: parent.id,
        title: "Child Subtask 2",
        status: "done",
      });
      assert.equal(subtask2.parentId, parent.id);

      // 3. Top-level query (default) excludes subtasks
      const topLevelList = await repo.list({ projectId });
      assert.equal(topLevelList.length, 1);
      assert.equal(topLevelList[0]?.id, parent.id);
      // Verify subtaskStats is computed: 2 total, 1 done
      assert.deepEqual(topLevelList[0]?.subtaskStats, { total: 2, done: 1 });

      // 4. includeSubtasks query returns parent and all subtasks
      const fullList = await repo.list({ projectId, includeSubtasks: true });
      assert.equal(fullList.length, 3);

      // 5. Query by parentId returns only the 2 subtasks
      const childList = await repo.list({ projectId, parentId: parent.id });
      assert.equal(childList.length, 2);
      assert.ok(childList.some((t) => t.id === subtask1.id));
      assert.ok(childList.some((t) => t.id === subtask2.id));

      // 6. Complete subtask 1 and verify parent subtaskStats becomes 2/2
      const updatedSubtask1 = await repo.update(subtask1.id, {
        expectedVersion: subtask1.version,
        status: "done",
      });
      assert.equal(updatedSubtask1.task.status, "done");

      const refreshedParent = await repo.getById(parent.id);
      const parentWithStats = (await repo.list({ projectId })).find((t) => t.id === parent.id);
      assert.deepEqual(parentWithStats?.subtaskStats, { total: 2, done: 2 });

      // 7. Invariant: Task cannot be its own parent
      await assert.rejects(
        () =>
          repo.update(parent.id, {
            expectedVersion: parent.version,
            parentId: parent.id,
          }),
        (err: unknown) => err instanceof TenantConflictError && (err as Error).message.includes("own parent"),
      );

      // 8. Invariant: Cross-project parent assignment is rejected
      await assert.rejects(
        () =>
          repo.create({
            projectId: otherProjectId,
            parentId: parent.id,
            title: "Invalid cross-project subtask",
          }),
        (err: unknown) => err instanceof TenantResourceNotFoundError,
      );

      // 9. Invariant: Cross-workspace parent assignment is rejected
      const otherRepo = createTasksRepository({ organizationId, workspaceId: otherWorkspaceId });
      await assert.rejects(
        () =>
          otherRepo.create({
            projectId,
            parentId: parent.id,
            title: "Invalid cross-workspace subtask",
          }),
        (err: unknown) => err instanceof TenantResourceNotFoundError,
      );

      // 10. Invariant: Cycle in hierarchy is rejected
      await assert.rejects(
        () =>
          repo.update(parent.id, {
            expectedVersion: parent.version,
            parentId: subtask1.id,
          }),
        (err: unknown) => err instanceof TenantConflictError && (err as Error).message.includes("cycle"),
      );

      // 11. Invariant: Optimistic version mismatch is rejected
      await assert.rejects(
        () =>
          repo.update(subtask1.id, {
            expectedVersion: 999,
            title: "Stale version edit",
          }),
        (err: unknown) => err instanceof TenantConflictError,
      );

      // 12. Detach subtask to make it top-level
      const detached = await repo.update(subtask2.id, {
        expectedVersion: subtask2.version,
        parentId: null,
      });
      assert.equal(detached.task.parentId, null);

      const topLevelAfterDetach = await repo.list({ projectId });
      assert.equal(topLevelAfterDetach.length, 2);

      // 13. Delete individual subtask: child is soft-deleted, parent remains intact
      await repo.softDelete(subtask1.id);
      const remainingParent = await repo.getById(parent.id);
      assert.equal(remainingParent.id, parent.id);

      await assert.rejects(
        () => repo.getById(subtask1.id),
        (err: unknown) => err instanceof TenantResourceNotFoundError,
      );

      // 14. Invariant: Soft-deleted task cannot become a valid parent
      await assert.rejects(
        () =>
          repo.create({
            projectId,
            parentId: subtask1.id,
            title: "Child of deleted parent",
          }),
        (err: unknown) => err instanceof TenantResourceNotFoundError,
      );

      // 15. Delete parent: cascades soft-delete to child subtasks
      const freshChild = await repo.create({
        projectId,
        parentId: parent.id,
        title: "Fresh child to test cascade delete",
      });
      await repo.softDelete(parent.id);

      await assert.rejects(
        () => repo.getById(parent.id),
        (err: unknown) => err instanceof TenantResourceNotFoundError,
      );
      await assert.rejects(
        () => repo.getById(freshChild.id),
        (err: unknown) => err instanceof TenantResourceNotFoundError,
      );

      const checkDbDeleted = await db
        .select()
        .from(tasks)
        .where(and(eq(tasks.id, freshChild.id), isNull(tasks.deletedAt)));
      assert.equal(checkDbDeleted.length, 0);
    } finally {
      await db.delete(tasks).where(eq(tasks.organizationId, organizationId));
      await db.delete(projects).where(eq(projects.organizationId, organizationId));
      await db.delete(workspaces).where(eq(workspaces.organizationId, organizationId));
      await db.delete(organizations).where(eq(organizations.id, organizationId));
    }
  });
});
