import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import {
  createTaskFollowersRepository,
  createTasksRepository,
  db,
  memberships,
  organizations,
  pool,
  projects,
  taskFollowers,
  tasks,
  TenantPermissionDeniedError,
  TenantResourceNotFoundError,
  users,
  workspaces,
} from "../src/index";

after(async () => {
  await pool.end();
});

describe("task followers (watchers) domain and repository", () => {
  it("enforces history preservation, delta mutations, auto-watch invariants, and isolation", async () => {
    const organizationId = randomUUID();
    const workspaceId = randomUUID();
    const otherOrgId = randomUUID();
    const otherWorkspaceId = randomUUID();
    const projectId = randomUUID();
    const actorId = randomUUID();
    const userA = randomUUID();
    const userB = randomUUID();
    const userC = randomUUID();
    const userD = randomUUID();
    const userInactive = randomUUID();
    const userCrossTenant = randomUUID();

    try {
      await db.insert(users).values([
        { id: actorId, email: `${actorId}@example.test`, name: "Actor" },
        { id: userA, email: `${userA}@example.test`, name: "User A" },
        { id: userB, email: `${userB}@example.test`, name: "User B" },
        { id: userC, email: `${userC}@example.test`, name: "User C" },
        { id: userD, email: `${userD}@example.test`, name: "User D" },
        { id: userInactive, email: `${userInactive}@example.test`, name: "Inactive User" },
        { id: userCrossTenant, email: `${userCrossTenant}@example.test`, name: "Cross Tenant User" },
      ]);

      await db.insert(organizations).values([
        {
          id: organizationId,
          name: "Watcher Domain Tenant",
          slug: `watcher-domain-${organizationId}`,
          ownerId: actorId,
        },
        {
          id: otherOrgId,
          name: "Other Tenant",
          slug: `other-tenant-${otherOrgId}`,
          ownerId: userCrossTenant,
        },
      ]);

      await db.insert(workspaces).values([
        {
          id: workspaceId,
          organizationId,
          name: "Watcher Workspace",
          slug: `watcher-ws-${workspaceId}`,
        },
        {
          id: otherWorkspaceId,
          organizationId: otherOrgId,
          name: "Other Workspace",
          slug: `other-ws-${otherWorkspaceId}`,
        },
      ]);

      await db.insert(memberships).values([
        { organizationId, workspaceId, userId: actorId, status: "active" },
        { organizationId, workspaceId, userId: userA, status: "active" },
        { organizationId, workspaceId, userId: userB, status: "active" },
        { organizationId, workspaceId, userId: userC, status: "active" },
        { organizationId, workspaceId, userId: userD, status: "active" },
        { organizationId, workspaceId, userId: userInactive, status: "inactive" },
        { organizationId: otherOrgId, workspaceId: otherWorkspaceId, userId: userCrossTenant, status: "active" },
      ]);

      await db.insert(projects).values({
        id: projectId,
        organizationId,
        workspaceId,
        name: "Watcher Project",
      });

      const tasksRepo = createTasksRepository({ organizationId, workspaceId, actorId });
      const followersRepo = createTaskFollowersRepository({ organizationId, workspaceId, actorId });

      // Scenario 12, 13, 14: Reporter, Lead, and Contributor auto-watch on task creation
      const createdTask = await tasksRepo.create({
        projectId,
        title: "Initial Auto Watch Task",
        reporterId: userA,
        assigneeId: userB,
        assigneeIds: [userB, userC],
        followerIds: [userD],
      });

      assert.equal(createdTask.version, 1);
      const initialWatchers = await followersRepo.activeWatcherIds(createdTask.id);
      // userA (reporter), userB (lead), userC (contributor), userD (explicit follower)
      assert.deepEqual(initialWatchers.sort(), [userA, userB, userC, userD].sort());

      // Scenario 1: self Watch creates active row
      const standaloneTask = await tasksRepo.create({
        projectId,
        title: "Standalone Task",
      });
      const watchRes1 = await followersRepo.watch(standaloneTask.id, userA);
      assert.equal(watchRes1.changed, true);
      assert.ok(watchRes1.row);
      assert.equal(watchRes1.row?.userId, userA);
      assert.equal(watchRes1.row?.unfollowedAt, null);

      // Scenario 17: dedicated Watch does not modify task.version or updatedAt
      const taskAfterWatch = await tasksRepo.getById(standaloneTask.id);
      assert.equal(taskAfterWatch.version, standaloneTask.version);
      assert.equal(new Date(taskAfterWatch.updatedAt).getTime(), new Date(standaloneTask.updatedAt).getTime());

      // Scenario 2: duplicate Watch is no-op
      const watchRes2 = await followersRepo.watch(standaloneTask.id, userA);
      assert.equal(watchRes2.changed, false);
      const allRowsForA1 = await db
        .select()
        .from(taskFollowers)
        .where(and(eq(taskFollowers.taskId, standaloneTask.id), eq(taskFollowers.userId, userA)));
      assert.equal(allRowsForA1.length, 1);

      // Scenario 3: Unwatch closes active row
      const unwatchRes1 = await followersRepo.unwatch(standaloneTask.id, userA);
      assert.equal(unwatchRes1.changed, true);

      const activeAfterUnwatch = await followersRepo.activeWatcherIds(standaloneTask.id);
      assert.ok(!activeAfterUnwatch.includes(userA));

      const closedRow1 = (
        await db
          .select()
          .from(taskFollowers)
          .where(and(eq(taskFollowers.taskId, standaloneTask.id), eq(taskFollowers.userId, userA)))
      )[0]!;
      assert.ok(closedRow1.unfollowedAt !== null);

      // Scenario 4: duplicate Unwatch is no-op
      const unwatchRes2 = await followersRepo.unwatch(standaloneTask.id, userA);
      assert.equal(unwatchRes2.changed, false);

      // Scenario 5 & 6: Watch → Unwatch → Watch creates a new historical row; historical row never reopened
      const watchRes3 = await followersRepo.watch(standaloneTask.id, userA);
      assert.equal(watchRes3.changed, true);
      assert.notEqual(watchRes3.row?.id, closedRow1.id);

      const allRowsForA2 = await db
        .select()
        .from(taskFollowers)
        .where(and(eq(taskFollowers.taskId, standaloneTask.id), eq(taskFollowers.userId, userA)))
        .orderBy(taskFollowers.followedAt);

      assert.equal(allRowsForA2.length, 2);
      // Row 1 remains closed
      assert.equal(allRowsForA2[0]!.id, closedRow1.id);
      assert.ok(allRowsForA2[0]!.unfollowedAt !== null);
      // Row 2 is fresh and active
      assert.equal(allRowsForA2[1]!.id, watchRes3.row?.id);
      assert.equal(allRowsForA2[1]!.unfollowedAt, null);

      // Scenario 7, 8, 9: replaceWatchersDelta preserves retained row ID, followedAt, and closes removed rows
      // Current active watchers on standaloneTask: [userA]
      // Let's add userB and userC
      await followersRepo.ensureWatchers(standaloneTask.id, [userB, userC]);
      const rowsBeforeDelta = await followersRepo.listActive(standaloneTask.id);
      const rowBBefore = rowsBeforeDelta.find((r) => r.userId === userB)!;
      assert.ok(rowBBefore);

      // Mutate delta: retain userB, remove userA, remove userC, add userD
      const deltaResult = await followersRepo.replaceWatchersDelta(standaloneTask.id, [userB, userD]);
      assert.equal(deltaResult.changed, true);
      assert.deepEqual(deltaResult.retainedWatcherIds, [userB]);
      assert.deepEqual(deltaResult.addedWatcherIds, [userD]);
      assert.deepEqual(deltaResult.removedWatcherIds.sort(), [userA, userC].sort());

      const rowsAfterDelta = await followersRepo.listActive(standaloneTask.id);
      const rowBAfter = rowsAfterDelta.find((r) => r.userId === userB)!;
      assert.ok(rowBAfter);
      // Scenario 7: retained row ID preserved
      assert.equal(rowBAfter.id, rowBBefore.id);
      // Scenario 8: retained followedAt preserved
      assert.equal(new Date(rowBAfter.followedAt).getTime(), new Date(rowBBefore.followedAt).getTime());

      // Scenario 9: removed watcher active row closed with unfollowedAt
      const closedRowA = (
        await db
          .select()
          .from(taskFollowers)
          .where(and(eq(taskFollowers.taskId, standaloneTask.id), eq(taskFollowers.id, watchRes3.row!.id)))
      )[0]!;
      assert.ok(closedRowA.unfollowedAt !== null);

      // Scenario 10: cross-tenant Watcher rejected
      await assert.rejects(
        () => followersRepo.watch(standaloneTask.id, userCrossTenant),
        (err: unknown) => err instanceof TenantPermissionDeniedError,
      );

      // Scenario 11: inactive member rejected
      await assert.rejects(
        () => followersRepo.watch(standaloneTask.id, userInactive),
        (err: unknown) => err instanceof TenantPermissionDeniedError,
      );

      // Scenario 15: removed assignee remains Watcher
      const taskWithAssignees = await tasksRepo.create({
        projectId,
        title: "Task with Assignees to Remove",
        assigneeIds: [userA, userB],
      });
      // Both userA and userB are watching
      const watchersBeforeRemoval = await followersRepo.activeWatcherIds(taskWithAssignees.id);
      assert.deepEqual(watchersBeforeRemoval.sort(), [userA, userB].sort());

      // Update task to remove userB from assignees (only userA remains)
      await tasksRepo.update(taskWithAssignees.id, {
        expectedVersion: 1,
        assigneeIds: [userA],
      });
      // userB was removed from assignees, but MUST remain a watcher!
      const watchersAfterRemoval = await followersRepo.activeWatcherIds(taskWithAssignees.id);
      assert.deepEqual(watchersAfterRemoval.sort(), [userA, userB].sort());

      // Scenario 18: concurrency safety
      const concurrentResults = await Promise.all([
        followersRepo.watch(standaloneTask.id, userA),
        followersRepo.watch(standaloneTask.id, userA),
        followersRepo.watch(standaloneTask.id, userA),
      ]);
      const changedCount = concurrentResults.filter((r) => r.changed).length;
      assert.equal(changedCount, 1);

      // Scenario 16: task soft-delete closes active Watchers
      const taskToDelete = await tasksRepo.create({
        projectId,
        title: "Task to Delete",
        assigneeIds: [userA],
      });
      const watchersBeforeDelete = await followersRepo.activeWatcherIds(taskToDelete.id);
      assert.equal(watchersBeforeDelete.length, 1);

      await tasksRepo.softDelete(taskToDelete.id);

      const activeFollowersAfterDelete = await db
        .select()
        .from(taskFollowers)
        .where(and(eq(taskFollowers.taskId, taskToDelete.id), isNull(taskFollowers.unfollowedAt)));
      assert.equal(activeFollowersAfterDelete.length, 0);

      // Scenario 19: Contributor role retention does NOT re-watch manually unwatched users, but re-adding after removal does
      const taskRoleChange = await tasksRepo.create({
        projectId,
        title: "Role change task",
        assigneeId: userA, // Lead
        assigneeIds: [userA, userB], // userB is contributor
      });
      // userB manually unwatches
      await followersRepo.unwatch(taskRoleChange.id, userB);
      const watchersAfterManualUnwatch = await followersRepo.activeWatcherIds(taskRoleChange.id);
      assert.ok(!watchersAfterManualUnwatch.includes(userB));

      // Adding new contributor userC does not re-watch userB (who was already an assignee)
      await tasksRepo.update(taskRoleChange.id, {
        expectedVersion: 1,
        assigneeIds: [userA, userB, userC],
      });
      const watchersAfterAddingC = await followersRepo.activeWatcherIds(taskRoleChange.id);
      assert.ok(watchersAfterAddingC.includes(userC)); // userC auto-watched
      assert.ok(!watchersAfterAddingC.includes(userB)); // userB remains unwatched

      // If userB is completely removed from assignees, userB still stays in current watch state (unwatched)
      await tasksRepo.update(taskRoleChange.id, {
        expectedVersion: 2,
        assigneeIds: [userA, userC],
      });
      const watchersAfterRemovingB = await followersRepo.activeWatcherIds(taskRoleChange.id);
      assert.ok(!watchersAfterRemovingB.includes(userB));

      // If userB is newly assigned again, auto-watch triggers again!
      await tasksRepo.update(taskRoleChange.id, {
        expectedVersion: 3,
        assigneeIds: [userA, userB, userC],
      });
      const watchersAfterReassigningB = await followersRepo.activeWatcherIds(taskRoleChange.id);
      assert.ok(watchersAfterReassigningB.includes(userB));
    } finally {
      await db
        .delete(taskFollowers)
        .where(eq(taskFollowers.organizationId, organizationId))
        .catch(() => undefined);
      await db
        .delete(tasks)
        .where(eq(tasks.organizationId, organizationId))
        .catch(() => undefined);
      await db
        .delete(projects)
        .where(eq(projects.organizationId, organizationId))
        .catch(() => undefined);
      await db
        .delete(memberships)
        .where(eq(memberships.organizationId, organizationId))
        .catch(() => undefined);
      await db
        .delete(memberships)
        .where(eq(memberships.organizationId, otherOrgId))
        .catch(() => undefined);
      await db
        .delete(workspaces)
        .where(eq(workspaces.organizationId, organizationId))
        .catch(() => undefined);
      await db
        .delete(workspaces)
        .where(eq(workspaces.organizationId, otherOrgId))
        .catch(() => undefined);
      await db
        .delete(organizations)
        .where(eq(organizations.id, organizationId))
        .catch(() => undefined);
      await db
        .delete(organizations)
        .where(eq(organizations.id, otherOrgId))
        .catch(() => undefined);
      await db
        .delete(users)
        .where(and(eq(users.id, actorId)))
        .catch(() => undefined);
      for (const uid of [userA, userB, userC, userD, userInactive, userCrossTenant]) {
        await db
          .delete(users)
          .where(eq(users.id, uid))
          .catch(() => undefined);
      }
    }
  });
});
