import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import {
  createCommentsRepository,
  createTaskFollowersRepository,
  createTasksRepository,
  db,
  dispatchWatcherNotifications,
  memberships,
  notificationEmailOutbox,
  notificationPreferences,
  notifications,
  organizations,
  pool,
  projects,
  taskFollowers,
  tasks,
  TenantPermissionDeniedError,
  TenantResourceNotFoundError,
  usageLimits,
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
    const userDual = randomUUID();
    const userDeactivated = randomUUID();
    const userNoInApp = randomUUID();
    const userNoEmail = randomUUID();
    const userNoDelivery = randomUUID();
    const userDedup = randomUUID();

    try {
      await db.insert(users).values([
        { id: actorId, email: `${actorId}@example.test`, name: "Actor" },
        { id: userA, email: `${userA}@example.test`, name: "User A" },
        { id: userB, email: `${userB}@example.test`, name: "User B" },
        { id: userC, email: `${userC}@example.test`, name: "User C" },
        { id: userD, email: `${userD}@example.test`, name: "User D" },
        { id: userInactive, email: `${userInactive}@example.test`, name: "Inactive User" },
        { id: userCrossTenant, email: `${userCrossTenant}@example.test`, name: "Cross Tenant User" },
        { id: userDual, email: `${userDual}@example.test`, name: "Dual Member" },
        { id: userDeactivated, email: `${userDeactivated}@example.test`, name: "Deactivated User" },
        { id: userNoInApp, email: `${userNoInApp}@example.test`, name: "No In-App" },
        { id: userNoEmail, email: `${userNoEmail}@example.test`, name: "No Email" },
        { id: userNoDelivery, email: `${userNoDelivery}@example.test`, name: "No Delivery" },
        { id: userDedup, email: `${userDedup}@example.test`, name: "Dedup User" },
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

      await db.update(usageLimits).set({ maxSeats: 100 }).where(eq(usageLimits.organizationId, organizationId));

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

      // Scenario 20: Dual membership (active org-wide AND active workspace-specific) succeeds for watch and ensureWatchers
      await db.insert(memberships).values([
        { organizationId, workspaceId: null, userId: userDual, status: "active" },
        { organizationId, workspaceId, userId: userDual, status: "active" },
      ]);
      const taskDual = await tasksRepo.create({
        projectId,
        title: "Dual membership task",
        assigneeId: actorId,
      });
      await followersRepo.watch(taskDual.id, userDual);
      const watchersDual = await followersRepo.activeWatcherIds(taskDual.id);
      assert.ok(watchersDual.includes(userDual));
      await followersRepo.ensureWatchers(taskDual.id, [userDual]);

      // Scenario 21: Inactive historical Watcher does not break comment creation or task notifications and receives no notifications
      const [deactivatedMembership] = await db
        .insert(memberships)
        .values({
          organizationId,
          workspaceId,
          userId: userDeactivated,
          status: "active",
        })
        .returning();
      const taskDeactivated = await tasksRepo.create({
        projectId,
        title: "Deactivation test task",
        assigneeId: actorId,
      });
      await followersRepo.watch(taskDeactivated.id, userDeactivated);
      assert.ok((await followersRepo.activeWatcherIds(taskDeactivated.id)).includes(userDeactivated));

      // Deactivate user's membership
      await db.update(memberships).set({ status: "inactive" }).where(eq(memberships.id, deactivatedMembership.id));

      // Comment create succeeds and deactivated watcher is safely skipped (receives NO notification)
      const commentsRepo = createCommentsRepository({ organizationId, workspaceId, actorId });
      const createdComment = await commentsRepo.create({
        taskId: taskDeactivated.id,
        userId: actorId,
        content: "Testing comment with inactive watcher",
      });
      assert.ok(createdComment.id);

      const deactivatedNotifs = await db
        .select()
        .from(notifications)
        .where(and(eq(notifications.organizationId, organizationId), eq(notifications.userId, userDeactivated)));
      assert.equal(deactivatedNotifs.length, 0);

      // Task status update notification dispatch succeeds and deactivated watcher is skipped
      const dispatchResult = await dispatchWatcherNotifications(
        { organizationId, workspaceId, actorId },
        {
          taskId: taskDeactivated.id,
          actorId,
          type: "task_watch_update",
          title: "Status update",
          body: "Status changed to in_progress",
          deduplicationKeyTemplate: (uid) => `task-watch/${taskDeactivated.id}/status_changed/v2/${uid}`,
        },
      );
      assert.ok(!dispatchResult.notifiedUserIds.includes(userDeactivated));

      // Scenario 22: Real delivery preferences respected (inAppEnabled=false, emailEnabled=false, both false)
      await db.insert(memberships).values([
        { organizationId, workspaceId, userId: userNoInApp, status: "active" },
        { organizationId, workspaceId, userId: userNoEmail, status: "active" },
        { organizationId, workspaceId, userId: userNoDelivery, status: "active" },
      ]);
      await db.insert(notificationPreferences).values([
        { userId: userNoInApp, inAppEnabled: false, emailEnabled: true },
        { userId: userNoEmail, inAppEnabled: true, emailEnabled: false },
        { userId: userNoDelivery, inAppEnabled: false, emailEnabled: false },
      ]);

      const taskPref = await tasksRepo.create({
        projectId,
        title: "Preference task",
        assigneeId: actorId,
      });
      await followersRepo.ensureWatchers(taskPref.id, [userNoInApp, userNoEmail, userNoDelivery]);

      await dispatchWatcherNotifications(
        { organizationId, workspaceId, actorId },
        {
          taskId: taskPref.id,
          actorId,
          type: "task_watch_update",
          title: "Preference update",
          body: "Testing delivery preferences",
          deduplicationKeyTemplate: (uid) => `task-watch/${taskPref.id}/pref/v1/${uid}`,
        },
      );

      // userNoInApp: No row in notifications table, but has row in notification_email_outbox
      const inAppRowsForNoInApp = await db.select().from(notifications).where(eq(notifications.userId, userNoInApp));
      const emailRowsForNoInApp = await db
        .select()
        .from(notificationEmailOutbox)
        .where(eq(notificationEmailOutbox.userId, userNoInApp));
      assert.equal(inAppRowsForNoInApp.length, 0);
      assert.equal(emailRowsForNoInApp.length, 1);

      // userNoEmail: Has row in notifications table, but NO row in notification_email_outbox
      const inAppRowsForNoEmail = await db.select().from(notifications).where(eq(notifications.userId, userNoEmail));
      const emailRowsForNoEmail = await db
        .select()
        .from(notificationEmailOutbox)
        .where(eq(notificationEmailOutbox.userId, userNoEmail));
      assert.equal(inAppRowsForNoEmail.length, 1);
      assert.equal(emailRowsForNoEmail.length, 0);

      // userNoDelivery: No rows in either table
      const inAppRowsForNoDelivery = await db
        .select()
        .from(notifications)
        .where(eq(notifications.userId, userNoDelivery));
      const emailRowsForNoDelivery = await db
        .select()
        .from(notificationEmailOutbox)
        .where(eq(notificationEmailOutbox.userId, userNoDelivery));
      assert.equal(inAppRowsForNoDelivery.length, 0);
      assert.equal(emailRowsForNoDelivery.length, 0);

      // Scenario 23: Real deduplication on exact retry vs new notification on later task version
      await db.insert(memberships).values({ organizationId, workspaceId, userId: userDedup, status: "active" });
      const taskDedup = await tasksRepo.create({
        projectId,
        title: "Dedup task",
        assigneeId: actorId,
      });
      await followersRepo.watch(taskDedup.id, userDedup);

      // First dispatch for v1
      await dispatchWatcherNotifications(
        { organizationId, workspaceId, actorId },
        {
          taskId: taskDedup.id,
          actorId,
          type: "task_watch_update",
          title: "Version 1 update",
          body: "Task v1 updated",
          deduplicationKeyTemplate: (uid) => `task-watch/${taskDedup.id}/status_changed/v1/${uid}`,
        },
      );
      // Exact retry for v1 (same key)
      await dispatchWatcherNotifications(
        { organizationId, workspaceId, actorId },
        {
          taskId: taskDedup.id,
          actorId,
          type: "task_watch_update",
          title: "Version 1 update retry",
          body: "Task v1 updated retry",
          deduplicationKeyTemplate: (uid) => `task-watch/${taskDedup.id}/status_changed/v1/${uid}`,
        },
      );

      // Must have exactly 1 in-app and 1 email outbox for userDedup so far
      const v1InApp = await db.select().from(notifications).where(eq(notifications.userId, userDedup));
      const v1Email = await db
        .select()
        .from(notificationEmailOutbox)
        .where(eq(notificationEmailOutbox.userId, userDedup));
      assert.equal(v1InApp.length, 1);
      assert.equal(v1Email.length, 1);

      // Now dispatch for v2 (new deduplication key)
      await dispatchWatcherNotifications(
        { organizationId, workspaceId, actorId },
        {
          taskId: taskDedup.id,
          actorId,
          type: "task_watch_update",
          title: "Version 2 update",
          body: "Task v2 updated",
          deduplicationKeyTemplate: (uid) => `task-watch/${taskDedup.id}/status_changed/v2/${uid}`,
        },
      );

      const v2InApp = await db.select().from(notifications).where(eq(notifications.userId, userDedup));
      const v2Email = await db
        .select()
        .from(notificationEmailOutbox)
        .where(eq(notificationEmailOutbox.userId, userDedup));
      assert.equal(v2InApp.length, 2);
      assert.equal(v2Email.length, 2);

      // Scenario 24: Role-only promotion preserves manual Unwatch (B was Contributor, unwatched, promoted to Lead)
      const taskPromotion = await tasksRepo.create({
        projectId,
        title: "Role promotion task",
        assigneeId: userA,
        assigneeIds: [userA, userB],
      });
      // Both userA and userB auto-watch initially
      assert.ok((await followersRepo.activeWatcherIds(taskPromotion.id)).includes(userA));
      assert.ok((await followersRepo.activeWatcherIds(taskPromotion.id)).includes(userB));

      // userB manually unwatches
      await followersRepo.unwatch(taskPromotion.id, userB);
      assert.ok(!(await followersRepo.activeWatcherIds(taskPromotion.id)).includes(userB));

      // Promote userB to Lead while preserving userA as contributor
      const { task: taskAfterPromotion } = await tasksRepo.update(taskPromotion.id, {
        expectedVersion: 1,
        assigneeId: userB,
        assigneeIds: [userB, userA],
      });
      assert.equal(taskAfterPromotion.assigneeId, userB);
      assert.deepEqual(taskAfterPromotion.assigneeIds?.sort(), [userA, userB].sort());

      // Assert B remains NOT watching (manual unwatch preserved), A remains watching
      const watchersAfterPromotion = await followersRepo.activeWatcherIds(taskPromotion.id);
      assert.ok(
        !watchersAfterPromotion.includes(userB),
        "Promoted Lead B must remain NOT watching if previously manually unwatched",
      );
      assert.ok(watchersAfterPromotion.includes(userA), "Contributor A must remain watching");

      // Verify B's historical follower rows are closed (unfollowed_at is not null) and no active row remains
      const bFollowerRows = await db
        .select()
        .from(taskFollowers)
        .where(and(eq(taskFollowers.taskId, taskPromotion.id), eq(taskFollowers.userId, userB)));
      assert.ok(bFollowerRows.length > 0);
      assert.ok(
        bFollowerRows.every((row) => row.unfollowedAt !== null),
        "All follower rows for B must be closed",
      );
      const bActiveRows = bFollowerRows.filter((row) => row.unfollowedAt === null);
      assert.equal(bActiveRows.length, 0, "No fresh active Watch row is left by the DB trigger");

      // Scenario 25: New Lead (not previously assigned) auto-watches vs Role-Only Lead (previously assigned, unwatched)
      const taskNewLead = await tasksRepo.create({
        projectId,
        title: "New Lead test task",
        assigneeId: userA,
        assigneeIds: [userA, userB],
      });
      await followersRepo.unwatch(taskNewLead.id, userB);
      assert.ok(!(await followersRepo.activeWatcherIds(taskNewLead.id)).includes(userB));

      // Assign userC (who was NOT assigned) as new Lead
      const { task: taskWithCAsLead } = await tasksRepo.update(taskNewLead.id, {
        expectedVersion: 1,
        assigneeId: userC,
        assigneeIds: [userC, userA, userB],
      });
      assert.equal(taskWithCAsLead.assigneeId, userC);

      const watchersWithC = await followersRepo.activeWatcherIds(taskNewLead.id);
      assert.ok(watchersWithC.includes(userC), "Brand new Lead C must auto-watch");
      assert.ok(!watchersWithC.includes(userB), "Existing contributor B must stay unwatched");
      assert.ok(watchersWithC.includes(userA), "Existing contributor A must stay watching");
    } finally {
      await db
        .delete(notificationEmailOutbox)
        .where(eq(notificationEmailOutbox.organizationId, organizationId))
        .catch(() => undefined);
      await db
        .delete(notifications)
        .where(eq(notifications.organizationId, organizationId))
        .catch(() => undefined);
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
      for (const uid of [
        actorId,
        userA,
        userB,
        userC,
        userD,
        userInactive,
        userCrossTenant,
        userDual,
        userDeactivated,
        userNoInApp,
        userNoEmail,
        userNoDelivery,
        userDedup,
      ]) {
        await db
          .delete(notificationPreferences)
          .where(eq(notificationPreferences.userId, uid))
          .catch(() => undefined);
        await db
          .delete(users)
          .where(eq(users.id, uid))
          .catch(() => undefined);
      }
    }
  });
});
