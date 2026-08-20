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
  tasks,
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

  it("enforces all 7 assignment delta integrity regression scenarios", async () => {
    const organizationId = randomUUID();
    const workspaceId = randomUUID();
    const projectId = randomUUID();
    const actorId = randomUUID();
    const userA = randomUUID();
    const userB = randomUUID();
    const userC = randomUUID();

    try {
      await db.insert(users).values([
        { id: actorId, email: `${actorId}@example.test`, name: "Actor" },
        { id: userA, email: `${userA}@example.test`, name: "User A" },
        { id: userB, email: `${userB}@example.test`, name: "User B" },
        { id: userC, email: `${userC}@example.test`, name: "User C" },
      ]);
      await db.insert(organizations).values({
        id: organizationId,
        name: "Delta Regression Org",
        slug: `delta-reg-${organizationId}`,
        ownerId: actorId,
      });
      await db.insert(workspaces).values({
        id: workspaceId,
        organizationId,
        name: "Delta Regression Ws",
        slug: `delta-reg-${workspaceId}`,
      });
      await db.insert(memberships).values([
        { organizationId, workspaceId, userId: actorId, status: "active" },
        { organizationId, workspaceId, userId: userA, status: "active" },
        { organizationId, workspaceId, userId: userB, status: "active" },
        { organizationId, workspaceId, userId: userC, status: "active" },
      ]);
      await db.insert(projects).values({ id: projectId, organizationId, workspaceId, name: "Delta Project" });

      const repository = createTasksRepository({ organizationId, workspaceId, actorId });

      // =========================================================================
      // REGRESSION 1: New Lead was never previously assigned
      // Before: A Lead, B Contributor -> Update: C Lead, B Contributor
      // =========================================================================
      const reg1 = await repository.create({
        projectId,
        title: "Reg 1 Task",
        assigneeId: userA,
        assigneeIds: [userA, userB],
      });
      const reg1BRowBefore = (
        await db
          .select()
          .from(taskAssignees)
          .where(
            and(eq(taskAssignees.taskId, reg1.id), isNull(taskAssignees.unassignedAt), eq(taskAssignees.userId, userB)),
          )
      )[0]!;
      assert.ok(reg1BRowBefore);

      const reg1Updated = await repository.update(reg1.id, {
        expectedVersion: reg1.version,
        assigneeId: userC,
      });
      assert.equal(reg1Updated.task.assigneeId, userC);
      assert.deepEqual(reg1Updated.task.assigneeIds, [userC, userB]);

      const reg1ActiveRows = await db
        .select()
        .from(taskAssignees)
        .where(and(eq(taskAssignees.taskId, reg1.id), isNull(taskAssignees.unassignedAt)));
      assert.equal(reg1ActiveRows.length, 2);

      const reg1CRow = reg1ActiveRows.find((r) => r.userId === userC);
      assert.ok(reg1CRow?.isPrimary, "C must be active Primary");

      const reg1BRowAfter = reg1ActiveRows.find((r) => r.userId === userB);
      assert.ok(reg1BRowAfter);
      assert.equal(reg1BRowAfter.id, reg1BRowBefore.id, "B row ID must be unchanged");
      assert.equal(reg1BRowAfter.assignedAt.getTime(), reg1BRowBefore.assignedAt.getTime(), "B assignedAt unchanged");
      assert.equal(reg1BRowAfter.isPrimary, false);

      const reg1ARows = await db
        .select()
        .from(taskAssignees)
        .where(and(eq(taskAssignees.taskId, reg1.id), eq(taskAssignees.userId, userA)));
      assert.ok(
        reg1ARows.every((r) => r.unassignedAt !== null),
        "A must be inactive",
      );

      // =========================================================================
      // REGRESSION 2: Existing Contributor promoted to Lead
      // Before: A Lead, B Contributor -> Update: B Lead alone
      // =========================================================================
      const reg2 = await repository.create({
        projectId,
        title: "Reg 2 Task",
        assigneeId: userA,
        assigneeIds: [userA, userB],
      });
      const reg2BRowBefore = (
        await db
          .select()
          .from(taskAssignees)
          .where(
            and(eq(taskAssignees.taskId, reg2.id), isNull(taskAssignees.unassignedAt), eq(taskAssignees.userId, userB)),
          )
      )[0]!;

      const reg2Updated = await repository.update(reg2.id, {
        expectedVersion: reg2.version,
        assigneeId: userB,
        assigneeIds: [userB],
      });
      assert.equal(reg2Updated.task.assigneeId, userB);
      assert.deepEqual(reg2Updated.task.assigneeIds, [userB]);

      const reg2ActiveRows = await db
        .select()
        .from(taskAssignees)
        .where(and(eq(taskAssignees.taskId, reg2.id), isNull(taskAssignees.unassignedAt)));
      assert.equal(reg2ActiveRows.length, 1);
      assert.equal(reg2ActiveRows[0]?.id, reg2BRowBefore.id, "B row ID must be unchanged");
      assert.equal(
        reg2ActiveRows[0]?.assignedAt.getTime(),
        reg2BRowBefore.assignedAt.getTime(),
        "B assignedAt unchanged",
      );
      assert.equal(reg2ActiveRows[0]?.isPrimary, true);

      const reg2ARows = await db
        .select()
        .from(taskAssignees)
        .where(and(eq(taskAssignees.taskId, reg2.id), eq(taskAssignees.userId, userA)));
      assert.ok(
        reg2ARows.every((r) => r.unassignedAt !== null),
        "A must be removed",
      );

      // =========================================================================
      // REGRESSION 3: Old Lead retained as Contributor
      // Before: A Lead, B Contributor -> Explicit update: B Lead, A Contributor
      // =========================================================================
      const reg3 = await repository.create({
        projectId,
        title: "Reg 3 Task",
        assigneeId: userA,
        assigneeIds: [userA, userB],
      });
      const reg3ARowBefore = (
        await db
          .select()
          .from(taskAssignees)
          .where(
            and(eq(taskAssignees.taskId, reg3.id), isNull(taskAssignees.unassignedAt), eq(taskAssignees.userId, userA)),
          )
      )[0]!;

      const reg3Updated = await repository.update(reg3.id, {
        expectedVersion: reg3.version,
        assigneeId: userB,
        assigneeIds: [userB, userA],
      });
      assert.equal(reg3Updated.task.assigneeId, userB);
      assert.deepEqual(reg3Updated.task.assigneeIds, [userB, userA]);

      const reg3ActiveRows = await db
        .select()
        .from(taskAssignees)
        .where(and(eq(taskAssignees.taskId, reg3.id), isNull(taskAssignees.unassignedAt)));
      assert.equal(reg3ActiveRows.length, 2);

      const reg3ARowAfter = reg3ActiveRows.find((r) => r.userId === userA);
      assert.ok(reg3ARowAfter);
      assert.equal(reg3ARowAfter.id, reg3ARowBefore.id, "A active row ID must be preserved");
      assert.equal(reg3ARowAfter.assignedAt.getTime(), reg3ARowBefore.assignedAt.getTime(), "A assignedAt preserved");
      assert.equal(reg3ARowAfter.isPrimary, false);
      assert.equal(reg3ARowAfter.unassignedAt, null);

      // =========================================================================
      // REGRESSION 4: Remove then later reassign same user creates a NEW row
      // =========================================================================
      const reg4 = await repository.create({
        projectId,
        title: "Reg 4 Task",
        assigneeId: userA,
      });
      const reg4InitialRow = (
        await db
          .select()
          .from(taskAssignees)
          .where(and(eq(taskAssignees.taskId, reg4.id), eq(taskAssignees.userId, userA)))
      )[0]!;
      assert.ok(reg4InitialRow);

      // Remove A
      const reg4Removed = await repository.update(reg4.id, {
        expectedVersion: reg4.version,
        assigneeIds: [],
      });
      assert.equal(reg4Removed.task.assigneeId, null);

      const reg4ClosedRow = (
        await db
          .select()
          .from(taskAssignees)
          .where(and(eq(taskAssignees.taskId, reg4.id), eq(taskAssignees.userId, userA)))
      )[0]!;
      assert.ok(reg4ClosedRow.unassignedAt !== null, "Historical row must have unassignedAt set");

      // Reassign A later
      const reg4Reassigned = await repository.update(reg4.id, {
        expectedVersion: reg4Removed.task.version,
        assigneeId: userA,
      });
      assert.equal(reg4Reassigned.task.assigneeId, userA);

      const reg4AllRows = await db
        .select()
        .from(taskAssignees)
        .where(and(eq(taskAssignees.taskId, reg4.id), eq(taskAssignees.userId, userA)));
      assert.equal(reg4AllRows.length, 2, "Must result in exactly TWO rows for user A");

      const reg4ActiveRow = reg4AllRows.find((r) => r.unassignedAt === null);
      const reg4HistoricalRow = reg4AllRows.find((r) => r.unassignedAt !== null);

      assert.ok(reg4ActiveRow, "Must have exactly one active row");
      assert.ok(reg4HistoricalRow, "Must have exactly one historical row");
      assert.equal(reg4HistoricalRow.id, reg4InitialRow.id, "Historical row remains closed and untouched");
      assert.notEqual(reg4ActiveRow.id, reg4InitialRow.id, "New active row must have a distinct new ID");
      assert.equal(reg4ActiveRow.isPrimary, true);

      // =========================================================================
      // REGRESSION 5: Clear all assignments
      // =========================================================================
      const reg5 = await repository.create({
        projectId,
        title: "Reg 5 Task",
        assigneeId: userA,
        assigneeIds: [userA, userB],
      });
      const reg5Cleared = await repository.update(reg5.id, {
        expectedVersion: reg5.version,
        assigneeIds: [],
      });
      assert.equal(reg5Cleared.task.assigneeId, null);
      assert.deepEqual(reg5Cleared.task.assigneeIds, []);

      const reg5Active = await db
        .select()
        .from(taskAssignees)
        .where(and(eq(taskAssignees.taskId, reg5.id), isNull(taskAssignees.unassignedAt)));
      assert.equal(reg5Active.length, 0, "Zero active task_assignees");
      assert.equal(reg5Active.filter((r) => r.isPrimary).length, 0, "Zero active primary rows");

      // =========================================================================
      // REGRESSION 6: Multiple sequential Lead replacements (A → B → C → A)
      // =========================================================================
      const reg6 = await repository.create({
        projectId,
        title: "Reg 6 Task",
        assigneeId: userA,
        assigneeIds: [userA, userB, userC],
      });

      // A -> B
      const t1 = await repository.update(reg6.id, { expectedVersion: reg6.version, assigneeId: userB });
      assert.equal(t1.task.assigneeId, userB);
      let t1Active = await db
        .select()
        .from(taskAssignees)
        .where(and(eq(taskAssignees.taskId, reg6.id), isNull(taskAssignees.unassignedAt)));
      assert.equal(t1Active.filter((r) => r.isPrimary).length, 1);
      assert.equal(t1Active.find((r) => r.isPrimary)?.userId, userB);

      // B -> C
      const t2 = await repository.update(reg6.id, { expectedVersion: t1.task.version, assigneeId: userC });
      assert.equal(t2.task.assigneeId, userC);
      let t2Active = await db
        .select()
        .from(taskAssignees)
        .where(and(eq(taskAssignees.taskId, reg6.id), isNull(taskAssignees.unassignedAt)));
      assert.equal(t2Active.filter((r) => r.isPrimary).length, 1);
      assert.equal(t2Active.find((r) => r.isPrimary)?.userId, userC);

      // C -> A
      const t3 = await repository.update(reg6.id, { expectedVersion: t2.task.version, assigneeId: userA });
      assert.equal(t3.task.assigneeId, userA);
      let t3Active = await db
        .select()
        .from(taskAssignees)
        .where(and(eq(taskAssignees.taskId, reg6.id), isNull(taskAssignees.unassignedAt)));
      assert.equal(t3Active.filter((r) => r.isPrimary).length, 1);
      assert.equal(t3Active.find((r) => r.isPrimary)?.userId, userA);

      // Verify no duplicate active rows for any user
      const userIdsInActive = t3Active.map((r) => r.userId);
      assert.equal(new Set(userIdsInActive).size, userIdsInActive.length, "No duplicate active user rows");

      // =========================================================================
      // REGRESSION 7: Stale expectedVersion rejected without changing participant rows
      // =========================================================================
      const reg7 = await repository.create({
        projectId,
        title: "Reg 7 Task",
        assigneeId: userA,
        assigneeIds: [userA, userB],
      });
      const reg7ActiveBefore = await db
        .select()
        .from(taskAssignees)
        .where(and(eq(taskAssignees.taskId, reg7.id), isNull(taskAssignees.unassignedAt)));

      await assert.rejects(
        () =>
          repository.update(reg7.id, {
            expectedVersion: 999,
            assigneeId: userC,
          }),
        (err: unknown) => err instanceof TenantConflictError,
      );

      const reg7ActiveAfter = await db
        .select()
        .from(taskAssignees)
        .where(and(eq(taskAssignees.taskId, reg7.id), isNull(taskAssignees.unassignedAt)));
      assert.equal(reg7ActiveAfter.length, reg7ActiveBefore.length);
      assert.equal(reg7ActiveAfter.find((r) => r.isPrimary)?.userId, userA);
    } finally {
      // Cleanup
    }
  });

  it("enforces canonical assignment invariants during task import and bulk operations", async () => {
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
        { id: organizationId, name: "Import Bulk Org", slug: `import-bulk-${organizationId}`, ownerId: actorId },
        { id: otherOrgId, name: "Other Org", slug: `other-org-${otherOrgId}`, ownerId: userCrossTenant },
      ]);
      await db.insert(workspaces).values([
        { id: workspaceId, organizationId, name: "Import Bulk Ws", slug: `import-bulk-ws-${workspaceId}` },
        { id: otherWorkspaceId, organizationId: otherOrgId, name: "Other Ws", slug: `other-ws-${otherWorkspaceId}` },
      ]);
      await db.insert(memberships).values([
        { organizationId, workspaceId, userId: actorId, status: "active" },
        { organizationId, workspaceId, userId: userA, status: "active" },
        { organizationId, workspaceId, userId: userB, status: "active" },
        { organizationId, workspaceId, userId: userC, status: "active" },
        { organizationId, workspaceId, userId: userInactive, status: "inactive" },
        { organizationId: otherOrgId, workspaceId: otherWorkspaceId, userId: userCrossTenant, status: "active" },
      ]);
      await db.insert(projects).values({ id: projectId, organizationId, workspaceId, name: "Import Bulk Project" });

      const repository = createTasksRepository({ organizationId, workspaceId, actorId });

      // 1. Task Import: Valid task shapes
      const importedUnassigned = await repository.create({
        projectId,
        title: "Import Task 1 - Unassigned",
        assigneeId: null,
      });
      assert.equal(importedUnassigned.assigneeId, null);
      assert.deepEqual(importedUnassigned.assigneeIds, []);

      const importedLeadOnly = await repository.create({
        projectId,
        title: "Import Task 2 - Lead Only",
        assigneeId: userA,
      });
      assert.equal(importedLeadOnly.assigneeId, userA);
      assert.deepEqual(importedLeadOnly.assigneeIds, [userA]);

      const importedMulti = await repository.create({
        projectId,
        title: "Import Task 3 - Multi Assignees",
        assigneeId: userA,
        assigneeIds: [userA, userB, userC],
      });
      assert.equal(importedMulti.assigneeId, userA);
      assert.deepEqual(
        importedMulti.assigneeIds,
        [userA, userB, userC].sort((x, y) => (x === userA ? -1 : y === userA ? 1 : x.localeCompare(y))),
      );

      // 2. Task Import: Rejections for invalid users
      await assert.rejects(
        () => repository.create({ projectId, title: "Import Cross-Tenant", assigneeId: userCrossTenant }),
        (err: unknown) => err instanceof TenantResourceNotFoundError,
      );
      await assert.rejects(
        () => repository.create({ projectId, title: "Import Inactive", assigneeId: userInactive }),
        (err: unknown) => err instanceof TenantResourceNotFoundError,
      );
      await assert.rejects(
        () => repository.create({ projectId, title: "Import Unknown", assigneeId: randomUUID() }),
        (err: unknown) => err instanceof TenantResourceNotFoundError,
      );
      await assert.rejects(
        () => repository.create({ projectId, title: "Import Invalid Comb", assigneeId: null, assigneeIds: [userA] }),
        (err: unknown) => err instanceof TenantConflictError,
      );

      // 3. Bulk Operations Simulation on multiple tasks
      const task1 = await repository.create({ projectId, title: "Bulk Task 1", assigneeId: userA });
      const task2 = await repository.create({ projectId, title: "Bulk Task 2", assigneeId: userB });

      // Bulk Add Assignee userC to both tasks
      const bulkAdd1 = await repository.update(task1.id, {
        expectedVersion: task1.version,
        assigneeIds: [...task1.assigneeIds, userC],
      });
      const bulkAdd2 = await repository.update(task2.id, {
        expectedVersion: task2.version,
        assigneeIds: [...task2.assigneeIds, userC],
      });
      assert.equal(bulkAdd1.task.assigneeId, userA);
      assert.deepEqual(bulkAdd1.task.assigneeIds, [userA, userC]);
      assert.equal(bulkAdd2.task.assigneeId, userB);
      assert.deepEqual(bulkAdd2.task.assigneeIds, [userB, userC]);

      // Bulk Set Lead to userC on both tasks (preserving previous assignees)
      const bulkLead1 = await repository.update(task1.id, {
        expectedVersion: bulkAdd1.task.version,
        assigneeId: userC,
        assigneeIds: [userC, userA],
      });
      const bulkLead2 = await repository.update(task2.id, {
        expectedVersion: bulkAdd2.task.version,
        assigneeId: userC,
        assigneeIds: [userC, userB],
      });
      assert.equal(bulkLead1.task.assigneeId, userC);
      assert.deepEqual(bulkLead1.task.assigneeIds, [userC, userA]);
      assert.equal(bulkLead2.task.assigneeId, userC);
      assert.deepEqual(bulkLead2.task.assigneeIds, [userC, userB]);

      // Bulk Clear All Assignees on both tasks
      const bulkClear1 = await repository.update(task1.id, {
        expectedVersion: bulkLead1.task.version,
        assigneeIds: [],
      });
      const bulkClear2 = await repository.update(task2.id, {
        expectedVersion: bulkLead2.task.version,
        assigneeIds: [],
      });
      assert.equal(bulkClear1.task.assigneeId, null);
      // 4. True No-Op Semantics & Mutation Absence Verification
      // Create fresh tasks for each specific case
      const noopTaskA = await repository.create({
        projectId,
        title: "No-Op Task A",
        assigneeId: userA,
        assigneeIds: [userA, userB],
      });
      const noopTaskAUpdatedAt = noopTaskA.updatedAt;
      const noopTaskAAssigneesBefore = await db
        .select()
        .from(taskAssignees)
        .where(and(eq(taskAssignees.taskId, noopTaskA.id), isNull(taskAssignees.unassignedAt)));

      // Case A: Assignment-only no-op (same assignees passed)
      const resCaseA = await repository.update(noopTaskA.id, {
        expectedVersion: noopTaskA.version,
        assigneeIds: [userA, userB],
      });
      assert.equal(resCaseA.task.version, noopTaskA.version, "version must not increment on assignment no-op");
      assert.equal(
        new Date(resCaseA.task.updatedAt).getTime(),
        new Date(noopTaskAUpdatedAt).getTime(),
        "updatedAt must not change on assignment no-op",
      );

      // Verify DB row state directly
      const [dbTaskA] = await db.select().from(tasks).where(eq(tasks.id, noopTaskA.id));
      assert.equal(dbTaskA?.version, noopTaskA.version);
      assert.equal(new Date(dbTaskA!.updatedAt).getTime(), new Date(noopTaskAUpdatedAt).getTime());

      // Verify task_assignees rows directly in DB
      const noopTaskAAssigneesAfter = await db
        .select()
        .from(taskAssignees)
        .where(and(eq(taskAssignees.taskId, noopTaskA.id), isNull(taskAssignees.unassignedAt)));
      assert.equal(noopTaskAAssigneesAfter.length, noopTaskAAssigneesBefore.length);
      assert.deepEqual(
        noopTaskAAssigneesAfter.map((r) => ({ userId: r.userId, isPrimary: r.isPrimary })),
        noopTaskAAssigneesBefore.map((r) => ({ userId: r.userId, isPrimary: r.isPrimary })),
      );

      // Case B: Assignment no-op + other real task change (status change)
      const resCaseB = await repository.update(noopTaskA.id, {
        expectedVersion: noopTaskA.version,
        assigneeIds: [userA, userB],
        status: "in_progress",
      });
      assert.equal(resCaseB.task.version, noopTaskA.version + 1, "version increments on real status change");
      assert.equal(resCaseB.task.status, "in_progress");
      assert.deepEqual(resCaseB.task.assigneeIds, [userA, userB]);

      // task_assignees rows must remain intact
      const noopTaskAAssigneesAfterCaseB = await db
        .select()
        .from(taskAssignees)
        .where(and(eq(taskAssignees.taskId, noopTaskA.id), isNull(taskAssignees.unassignedAt)));
      assert.equal(noopTaskAAssigneesAfterCaseB.length, 2);

      // Case D: Clear already-unassigned task
      const unassignedTask = await repository.create({
        projectId,
        title: "Unassigned Task D",
        assigneeId: null,
      });
      const unassignedUpdatedAt = unassignedTask.updatedAt;
      const resCaseD = await repository.update(unassignedTask.id, {
        expectedVersion: unassignedTask.version,
        assigneeIds: [],
      });
      assert.equal(
        resCaseD.task.version,
        unassignedTask.version,
        "version must not increment when clearing unassigned",
      );
      assert.equal(
        new Date(resCaseD.task.updatedAt).getTime(),
        new Date(unassignedUpdatedAt).getTime(),
        "updatedAt must not change when clearing unassigned",
      );

      // Case E: Set existing Lead again
      const leadOnlyTask = await repository.create({
        projectId,
        title: "Lead Only Task E",
        assigneeId: userA,
      });
      const leadUpdatedAt = leadOnlyTask.updatedAt;
      const resCaseE = await repository.update(leadOnlyTask.id, {
        expectedVersion: leadOnlyTask.version,
        assigneeId: userA,
      });
      assert.equal(resCaseE.task.version, leadOnlyTask.version, "version must not increment on setting same lead");
      assert.equal(
        new Date(resCaseE.task.updatedAt).getTime(),
        new Date(leadUpdatedAt).getTime(),
        "updatedAt must not change on setting same lead",
      );

      // Case F: Add already-assigned contributor
      const resCaseF = await repository.update(noopTaskA.id, {
        expectedVersion: resCaseB.task.version,
        assigneeIds: [userA, userB],
      });
      assert.equal(
        resCaseF.task.version,
        resCaseB.task.version,
        "version must not increment when adding already assigned",
      );
      assert.equal(
        new Date(resCaseF.task.updatedAt).getTime(),
        new Date(resCaseB.task.updatedAt).getTime(),
        "updatedAt must not change when adding already assigned",
      );

      // Case G: Remove non-assigned contributor (passing same single assignee list)
      const resCaseG = await repository.update(leadOnlyTask.id, {
        expectedVersion: leadOnlyTask.version,
        assigneeIds: [userA],
      });
      assert.equal(resCaseG.task.version, leadOnlyTask.version, "version must not increment on removing non-assigned");
      assert.equal(
        new Date(resCaseG.task.updatedAt).getTime(),
        new Date(leadUpdatedAt).getTime(),
        "updatedAt must not change on removing non-assigned",
      );
    } finally {
      // Cleanup
    }
  });
});
