import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import {
  automationEvents,
  createTasksRepository,
  db,
  memberships,
  organizations,
  pool,
  projects,
  tasks,
  TenantConflictError,
  users,
  workspaces,
} from "../src/index";

after(async () => {
  await pool.end();
});

describe("task collaboration and concurrency", () => {
  it("persists multiple participants, limits nesting, and rejects stale updates", async () => {
    const organizationId = randomUUID();
    const workspaceId = randomUUID();
    const projectId = randomUUID();
    const actorId = randomUUID();
    const assigneeId = randomUUID();
    const followerId = randomUUID();

    try {
      await db.insert(users).values([
        { id: actorId, email: `${actorId}@example.test`, name: "Actor" },
        { id: assigneeId, email: `${assigneeId}@example.test`, name: "Assignee" },
        { id: followerId, email: `${followerId}@example.test`, name: "Follower" },
      ]);
      await db.insert(organizations).values({
        id: organizationId,
        name: "Task collaboration tenant",
        slug: `task-collaboration-${organizationId}`,
        ownerId: actorId,
      });
      await db.insert(workspaces).values({
        id: workspaceId,
        organizationId,
        name: "Task collaboration workspace",
        slug: `task-collaboration-${workspaceId}`,
      });
      await db.insert(memberships).values(
        [actorId, assigneeId, followerId].map((userId) => ({
          organizationId,
          workspaceId,
          userId,
          status: "active",
        })),
      );
      await db.insert(projects).values({ id: projectId, organizationId, workspaceId, name: "Project" });

      const repository = createTasksRepository({ organizationId, workspaceId, actorId });
      const task = await repository.create({
        projectId,
        title: "Collaborative task",
        assigneeIds: [actorId, assigneeId],
        followerIds: [followerId],
        priority: "high",
        tags: ["release"],
        timezone: "Asia/Riyadh",
        delayReason: "Waiting for approval",
      });
      assert.deepEqual(task.assigneeIds, [actorId, assigneeId]);
      assert.deepEqual([...task.followerIds].sort(), [actorId, followerId].sort());
      assert.equal(task.delayReason, "Waiting for approval");
      assert.equal(task.version, 1);

      const filtered = await repository.list({
        projectId,
        assigneeId,
        priority: "high",
        tag: "release",
        sortBy: "title",
        sortDirection: "asc",
      });
      assert.deepEqual(
        filtered.map((item) => item.id),
        [task.id],
      );

      const updated = await repository.update(task.id, {
        expectedVersion: 1,
        assigneeIds: [assigneeId],
        delayReason: null,
      });
      assert.equal(updated.task.version, 2);
      assert.deepEqual(updated.task.assigneeIds, [assigneeId]);
      const queuedAutomationEvents = await db
        .select({
          trigger: automationEvents.trigger,
          taskVersion: automationEvents.taskVersion,
          depth: automationEvents.depth,
        })
        .from(automationEvents)
        .where(eq(automationEvents.taskId, task.id));
      assert.deepEqual(
        queuedAutomationEvents.sort((left, right) => left.taskVersion - right.taskVersion),
        [
          { trigger: "task_created", taskVersion: 1, depth: 0 },
          { trigger: "task_assignee_changed", taskVersion: 2, depth: 0 },
        ],
      );
      await assert.rejects(
        () => repository.update(task.id, { expectedVersion: 1, title: "Stale title" }),
        (error: unknown) => error instanceof TenantConflictError && /modified by another request/.test(error.message),
      );

      let parent = await repository.create({ projectId, title: "Root" });
      for (let depth = 1; depth <= 5; depth += 1) {
        parent = await repository.create({ projectId, parentId: parent.id, title: `Depth ${depth}` });
      }
      await assert.rejects(
        () => repository.create({ projectId, parentId: parent.id, title: "Too deep" }),
        (error: unknown) => error instanceof TenantConflictError && /cannot exceed 5 levels/.test(error.message),
      );

      const firstPage = await repository.listPage({ projectId, includeSubtasks: true, limit: 3 });
      assert.equal(firstPage.items.length, 3);
      assert.equal(firstPage.total, 7);
      assert.ok(firstPage.nextCursor);
      const secondPage = await repository.listPage({
        projectId,
        includeSubtasks: true,
        limit: 3,
        cursor: firstPage.nextCursor!,
      });
      assert.equal(secondPage.items.length, 3);
      assert.equal(secondPage.total, firstPage.total);
      assert.equal(
        firstPage.items.some((first) => secondPage.items.some((second) => second.id === first.id)),
        false,
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
        .delete(memberships)
        .where(eq(memberships.organizationId, organizationId))
        .catch(() => undefined);
      await db
        .delete(workspaces)
        .where(eq(workspaces.id, workspaceId))
        .catch(() => undefined);
      await db
        .delete(organizations)
        .where(eq(organizations.id, organizationId))
        .catch(() => undefined);
      await db
        .delete(users)
        .where(eq(users.id, actorId))
        .catch(() => undefined);
      await db
        .delete(users)
        .where(eq(users.id, assigneeId))
        .catch(() => undefined);
      await db
        .delete(users)
        .where(eq(users.id, followerId))
        .catch(() => undefined);
    }
  });
});
