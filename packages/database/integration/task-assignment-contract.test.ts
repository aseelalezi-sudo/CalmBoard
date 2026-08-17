import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import { eq } from "drizzle-orm";
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

      // 8. Lead-only update removes previous Lead from execution set and preserves contributors
      // multiTask was Lead: B, Contributors: [A, C] -> update assigneeId to A
      const leadUpdated = await repository.update(multiTask.id, {
        expectedVersion: multiTask.version,
        assigneeId: userA,
      });
      assert.equal(leadUpdated.task.version, 2);
      assert.equal(leadUpdated.task.assigneeId, userA);
      // Previous Lead B is removed, contributor C is preserved -> [userA, userC]
      assert.deepEqual(leadUpdated.task.assigneeIds, [userA, userC]);

      // 9. Contributor-only update preserves current Lead
      // leadUpdated has Lead: A, Contributors: [C] -> update assigneeIds to [A, B, C]
      const contribUpdated = await repository.update(multiTask.id, {
        expectedVersion: leadUpdated.task.version,
        assigneeIds: [userC, userA, userB],
      });
      const contribRemainingSorted = [userB, userC].sort();
      assert.equal(contribUpdated.task.assigneeId, userA); // Lead A preserved!
      assert.deepEqual(contribUpdated.task.assigneeIds, [userA, ...contribRemainingSorted]);

      // 10. Both supplied on update: assigneeId is authoritative Lead
      const bothUpdated = await repository.update(multiTask.id, {
        expectedVersion: contribUpdated.task.version,
        assigneeId: userB,
        assigneeIds: [userA, userC],
      });
      assert.equal(bothUpdated.task.assigneeId, userB);
      assert.deepEqual(bothUpdated.task.assigneeIds, [userB, ...nonLeadSorted]);

      // 11. Remove Lead with remaining contributors (assigneeId=null alone promotes remaining contributor)
      const leadRemoved = await repository.update(multiTask.id, {
        expectedVersion: bothUpdated.task.version,
        assigneeId: null,
      });
      // Remaining were nonLeadSorted -> first remaining becomes Lead
      const [newLeadExpected, otherExpected] = nonLeadSorted;
      assert.equal(leadRemoved.task.assigneeId, newLeadExpected);
      assert.deepEqual(leadRemoved.task.assigneeIds, [newLeadExpected, otherExpected]);

      // 12. Remove all assignees explicitly with assigneeIds=[]
      const cleared = await repository.update(multiTask.id, {
        expectedVersion: leadRemoved.task.version,
        assigneeIds: [],
      });
      assert.equal(cleared.task.assigneeId, null);
      assert.deepEqual(cleared.task.assigneeIds, []);

      // 13. Stale expectedVersion rejection
      await assert.rejects(
        () =>
          repository.update(multiTask.id, {
            expectedVersion: 1,
            title: "Stale update",
          }),
        (err: unknown) => err instanceof TenantConflictError,
      );

      // 14. Notifications with deduplicationKey for newly added assignees
      await repository.createAssignmentNotifications(singleAssigneeTask, [userA, actorId], actorId);
      const userANotifications = await db.select().from(notifications).where(eq(notifications.userId, userA));
      assert.equal(userANotifications.length, 1);
      assert.equal(userANotifications[0]?.deduplicationKey, `task/${singleAssigneeTask.id}/assigned/${userA}`);

      // Actor was excluded
      const actorNotifications = await db.select().from(notifications).where(eq(notifications.userId, actorId));
      assert.equal(actorNotifications.length, 0);

      // 15. Automation events queued for task_assignee_changed
      const events = await db.select().from(automationEvents).where(eq(automationEvents.taskId, multiTask.id));
      assert.ok(events.some((e) => e.trigger === "task_assignee_changed"));
    } finally {
      // Cleanup
    }
  });
});
