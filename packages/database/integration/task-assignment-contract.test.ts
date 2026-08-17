import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import {
  automationEvents,
  createNotificationsRepository,
  createTasksRepository,
  db,
  memberships,
  notifications,
  organizations,
  pool,
  projects,
  taskAssignees,
  TenantConflictError,
  TenantResourceNotFoundError,
  users,
  workspaces,
} from "../src/index";

after(async () => {
  await pool.end();
});

describe("task assignment domain contract", () => {
  it("enforces canonical lead/contributor invariants, deterministic ordering, and notifications", async () => {
    const organizationId = randomUUID();
    const workspaceId = randomUUID();
    const otherOrgId = randomUUID();
    const otherWorkspaceId = randomUUID();
    const projectId = randomUUID();
    const actorId = randomUUID();
    const userA = randomUUID();
    const userB = randomUUID();
    const userC = randomUUID();
    const userInactive = randomUUID();
    const userCrossTenant = randomUUID();

    try {
      await db.insert(users).values([
        { id: actorId, email: `${actorId}@example.test`, name: "Actor" },
        { id: userA, email: `${userA}@example.test`, name: "User A" },
        { id: userB, email: `${userB}@example.test`, name: "User B" },
        { id: userC, email: `${userC}@example.test`, name: "User C" },
        { id: userInactive, email: `${userInactive}@example.test`, name: "Inactive User" },
        { id: userCrossTenant, email: `${userCrossTenant}@example.test`, name: "Cross Tenant User" },
      ]);
      await db.insert(organizations).values([
        {
          id: organizationId,
          name: "Assignment Domain Tenant",
          slug: `assignment-domain-${organizationId}`,
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
          name: "Assignment Workspace",
          slug: `assignment-ws-${workspaceId}`,
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
        { organizationId, workspaceId, userId: userInactive, status: "inactive" },
        { organizationId: otherOrgId, workspaceId: otherWorkspaceId, userId: userCrossTenant, status: "active" },
      ]);
      await db.insert(projects).values({ id: projectId, organizationId, workspaceId, name: "Assignment Project" });

      const repository = createTasksRepository({ organizationId, workspaceId, actorId });

      // 1. Unassigned create remains genuinely unassigned
      const unassignedTask = await repository.create({
        projectId,
        title: "Unassigned Task",
      });
      assert.equal(unassignedTask.assigneeId, null);
      assert.deepEqual(unassignedTask.assigneeIds, []);

      // 2. Reject assigneeId=null + non-empty assigneeIds on create
      await assert.rejects(
        () =>
          repository.create({
            projectId,
            title: "Invalid Assignment Task",
            assigneeId: null,
            assigneeIds: [userA],
          }),
        (err: unknown) => err instanceof TenantConflictError && /without a Lead/.test(err.message),
      );

      // 3. Reject cross-tenant or inactive member
      await assert.rejects(
        () =>
          repository.create({
            projectId,
            title: "Cross Tenant Task",
            assigneeId: userCrossTenant,
          }),
        (err: unknown) => err instanceof TenantResourceNotFoundError,
      );
      await assert.rejects(
        () =>
          repository.create({
            projectId,
            title: "Inactive Member Task",
            assigneeId: userInactive,
          }),
        (err: unknown) => err instanceof TenantResourceNotFoundError,
      );

      // 4. One assignee create
      const singleAssigneeTask = await repository.create({
        projectId,
        title: "Single Assignee Task",
        assigneeId: userA,
      });
      assert.equal(singleAssigneeTask.assigneeId, userA);
      assert.deepEqual(singleAssigneeTask.assigneeIds, [userA]);

      // 5. Multiple assignees create with explicit Lead (Lead first, then assignedAt, then userId)
      const multiTask = await repository.create({
        projectId,
        title: "Multi Assignee Task",
        assigneeId: userB,
        assigneeIds: [userA, userB, userC],
      });
      const nonLeadSorted = [userA, userC].sort();
      assert.equal(multiTask.assigneeId, userB);
      assert.deepEqual(multiTask.assigneeIds, [userB, ...nonLeadSorted]);

      // 6. Create without explicit assigneeId: deterministically chooses assigneeIds[0] as Lead
      const autoLeadTask = await repository.create({
        projectId,
        title: "Auto Lead Task",
        assigneeIds: [userA, userB],
      });
      assert.equal(autoLeadTask.assigneeId, userA);
      assert.deepEqual(autoLeadTask.assigneeIds, [userA, userB]);

      // 7. Filtering finds Lead OR Contributor
      const filteredByLead = await repository.list({ projectId, assigneeId: userB });
      assert.ok(filteredByLead.some((t) => t.id === multiTask.id));

      const filteredByContributor = await repository.list({ projectId, assigneeId: userC });
      assert.ok(filteredByContributor.some((t) => t.id === multiTask.id));

      // 8. Capture initial assignee row IDs and timestamps for history preservation test
      const initialActiveRows = await db
        .select()
        .from(taskAssignees)
        .where(and(eq(taskAssignees.taskId, multiTask.id), isNull(taskAssignees.unassignedAt)));
      const userCRowBefore = initialActiveRows.find((r) => r.userId === userC);
      assert.ok(userCRowBefore, "userC must have an initial active assignment row");
      const userBRowBefore = initialActiveRows.find((r) => r.userId === userB);
      assert.ok(userBRowBefore?.isPrimary, "userB was the initial Lead");

      // 9. Lead-only update removes previous Lead from execution set and preserves contributors
      // multiTask was Lead: B, Contributors: [A, C] -> update assigneeId to A
      const leadUpdated = await repository.update(multiTask.id, {
        expectedVersion: multiTask.version,
        assigneeId: userA,
      });
      assert.equal(leadUpdated.task.version, 2);
      assert.equal(leadUpdated.task.assigneeId, userA);
      // Previous Lead B is removed, contributor C is preserved -> [userA, userC]
      assert.deepEqual(leadUpdated.task.assigneeIds, [userA, userC]);

      // Verify assignment history preservation for retained contributor C:
      const activeRowsAfterLeadUpdate = await db
        .select()
        .from(taskAssignees)
        .where(and(eq(taskAssignees.taskId, multiTask.id), isNull(taskAssignees.unassignedAt)));
      const userCRowAfter = activeRowsAfterLeadUpdate.find((r) => r.userId === userC);
      assert.ok(userCRowAfter, "userC must still have an active row");
      assert.equal(userCRowAfter.id, userCRowBefore.id, "userC row ID must be preserved");
      assert.equal(
        userCRowAfter.assignedAt.getTime(),
        userCRowBefore.assignedAt.getTime(),
        "userC original assignedAt timestamp must be preserved",
      );

      // Verify previous Lead B was marked unassigned
      const userBRows = await db
        .select()
        .from(taskAssignees)
        .where(and(eq(taskAssignees.taskId, multiTask.id), eq(taskAssignees.userId, userB)));
      assert.ok(
        userBRows.every((r) => r.unassignedAt !== null),
        "previous Lead B must have unassignedAt set",
      );

      // Verify exactly one active primary exists
      const primaries = activeRowsAfterLeadUpdate.filter((r) => r.isPrimary);
      assert.equal(primaries.length, 1, "exactly one active primary row");
      assert.equal(primaries[0]?.userId, userA, "new Lead A is the primary");

      // 10. Contributor-only update preserves current Lead
      // leadUpdated has Lead: A, Contributors: [C] -> update assigneeIds to [A, B, C]
      const contribUpdated = await repository.update(multiTask.id, {
        expectedVersion: leadUpdated.task.version,
        assigneeIds: [userC, userA, userB],
      });
      assert.equal(contribUpdated.task.assigneeId, userA); // Lead A preserved!
      // userC has earlier assignedAt than userB
      assert.deepEqual(contribUpdated.task.assigneeIds, [userA, userC, userB]);

      // 11. Both supplied on update: assigneeId is authoritative Lead
      const bothUpdated = await repository.update(multiTask.id, {
        expectedVersion: contribUpdated.task.version,
        assigneeId: userB,
        assigneeIds: [userA, userC],
      });
      assert.equal(bothUpdated.task.assigneeId, userB);
      assert.deepEqual(bothUpdated.task.assigneeIds, [userB, ...nonLeadSorted]);

      // 12. Remove Lead with remaining contributors (assigneeId=null alone promotes remaining contributor)
      const leadRemoved = await repository.update(multiTask.id, {
        expectedVersion: bothUpdated.task.version,
        assigneeId: null,
      });
      // First in nonLeadSorted becomes Lead
      const [newLeadExpected, otherExpected] = nonLeadSorted;
      assert.equal(leadRemoved.task.assigneeId, newLeadExpected);
      assert.deepEqual(leadRemoved.task.assigneeIds, [newLeadExpected, otherExpected]);

      // 13. Remove all assignees explicitly with assigneeIds=[]
      const cleared = await repository.update(multiTask.id, {
        expectedVersion: leadRemoved.task.version,
        assigneeIds: [],
      });
      assert.equal(cleared.task.assigneeId, null);
      assert.deepEqual(cleared.task.assigneeIds, []);

      // Verify zero active rows and zero active primary when assignees are empty
      const activeRowsCleared = await db
        .select()
        .from(taskAssignees)
        .where(and(eq(taskAssignees.taskId, multiTask.id), isNull(taskAssignees.unassignedAt)));
      assert.equal(activeRowsCleared.length, 0, "zero active assignment rows after clearing");

      // 14. Stale expectedVersion rejection
      await assert.rejects(
        () =>
          repository.update(multiTask.id, {
            expectedVersion: 1,
            title: "Stale update",
          }),
        (err: unknown) => err instanceof TenantConflictError,
      );

      // 15. Notification deduplication & legitimate reassignment with versioning:
      // Step A: Assign userA on singleAssigneeTask (version 1)
      await repository.createAssignmentNotifications(singleAssigneeTask, [userA, actorId], actorId);
      const notifsV1 = await db.select().from(notifications).where(eq(notifications.userId, userA));
      assert.equal(notifsV1.length, 1);
      assert.equal(notifsV1[0]?.deduplicationKey, `task/${singleAssigneeTask.id}/assigned/${userA}/v1`);

      // Step B: Same-version notification retry must remain deduplicated
      await repository.createAssignmentNotifications(singleAssigneeTask, [userA], actorId);
      const notifsRetry = await db.select().from(notifications).where(eq(notifications.userId, userA));
      assert.equal(notifsRetry.length, 1, "same-version retry must remain deduplicated");

      // Step C: Remove userA from task -> update increments version to 2
      const unassignedSingle = await repository.update(singleAssigneeTask.id, {
        expectedVersion: singleAssigneeTask.version,
        assigneeIds: [],
      });
      assert.equal(unassignedSingle.task.version, 2);

      // Step D: Re-assign userA again -> update increments version to 3
      const reassignedSingle = await repository.update(singleAssigneeTask.id, {
        expectedVersion: unassignedSingle.task.version,
        assigneeId: userA,
      });
      assert.equal(reassignedSingle.task.version, 3);

      // Step E: Create assignment notification for re-assigned userA at version 3
      await repository.createAssignmentNotifications(reassignedSingle.task, [userA], actorId);
      const notifsAfterReassign = await db.select().from(notifications).where(eq(notifications.userId, userA));
      assert.equal(notifsAfterReassign.length, 2, "a NEW assignment notification must exist after reassignment");
      const keys = notifsAfterReassign.map((n) => n.deduplicationKey);
      assert.ok(keys.includes(`task/${singleAssigneeTask.id}/assigned/${userA}/v1`));
      assert.ok(keys.includes(`task/${singleAssigneeTask.id}/assigned/${userA}/v3`));

      // Step F: Actor was excluded
      const actorNotifications = await db.select().from(notifications).where(eq(notifications.userId, actorId));
      assert.equal(actorNotifications.length, 0);

      // 16. Automation events queued for task_assignee_changed
      const events = await db.select().from(automationEvents).where(eq(automationEvents.taskId, multiTask.id));
      assert.ok(events.some((e) => e.trigger === "task_assignee_changed"));
    } finally {
      // Cleanup
    }
  });
});
