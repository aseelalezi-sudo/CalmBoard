import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import {
  createTimeLogsRepository,
  db,
  memberships,
  organizations,
  pool,
  projects,
  tasks,
  timeLogs,
  timesheets,
  users,
  workspaces,
} from "../src/index";
import { TenantConflictError, TenantPermissionDeniedError } from "../src/errors";

after(async () => {
  await pool.end();
});

function nextMonday() {
  const value = new Date();
  value.setUTCHours(12, 0, 0, 0);
  value.setUTCDate(value.getUTCDate() + ((8 - value.getUTCDay()) % 7 || 7));
  return value;
}

describe("timesheet submission, review, and period locking", () => {
  it("derives entry ownership, enforces review separation, and locks approved periods", async () => {
    const memberId = randomUUID();
    const reviewerId = randomUUID();
    const organizationId = randomUUID();
    const workspaceId = randomUUID();
    const projectId = randomUUID();
    const taskId = randomUUID();

    try {
      await db.insert(users).values([
        { id: memberId, email: `timesheet-member-${memberId}@example.test`, name: "Timesheet member" },
        { id: reviewerId, email: `timesheet-reviewer-${reviewerId}@example.test`, name: "Timesheet reviewer" },
      ]);
      await db.insert(organizations).values({
        id: organizationId,
        name: "Timesheet tenant",
        slug: `timesheet-${organizationId}`,
        ownerId: reviewerId,
      });
      await db.insert(workspaces).values({
        id: workspaceId,
        organizationId,
        name: "Timesheet workspace",
        slug: `timesheet-${workspaceId}`,
      });
      await db.insert(memberships).values([
        { userId: memberId, organizationId, workspaceId, role: "member", status: "active" },
        { userId: reviewerId, organizationId, workspaceId, role: "manager", status: "active" },
      ]);
      await db.insert(projects).values({
        id: projectId,
        organizationId,
        workspaceId,
        name: "Timesheet project",
      });
      await db.insert(tasks).values({
        id: taskId,
        organizationId,
        workspaceId,
        projectId,
        serialNumber: 1,
        serial: `TIME-${randomUUID().slice(0, 8)}`,
        title: "Tracked task",
      });

      const member = createTimeLogsRepository({
        organizationId,
        workspaceId,
        actorId: memberId,
      });
      const reviewer = createTimeLogsRepository({
        organizationId,
        workspaceId,
        actorId: reviewerId,
      });

      const firstLog = await member.create({
        taskId,
        durationMinutes: 90,
        description: "Trusted member work",
      });
      assert.equal(firstLog.userId, memberId);
      const memberData = await member.list();
      assert.equal(memberData.timesheets.length, 1);
      assert.equal(memberData.timesheets[0]?.status, "draft");
      assert.equal(memberData.timesheets[0]?.totalMinutes, 90);

      const submitted = await member.submit(memberData.timesheets[0]!.id, memberData.timesheets[0]!.version);
      assert.equal(submitted?.status, "submitted");
      await assert.rejects(
        () => member.create({ taskId, durationMinutes: 15 }),
        (error: unknown) => error instanceof TenantConflictError && /locked/.test(error.message),
      );

      const queue = await reviewer.list({ includeReviewQueue: true });
      assert.equal(queue.reviewQueue[0]?.id, submitted?.id);
      const approved = await reviewer.review(submitted!.id, {
        decision: "approved",
        expectedVersion: submitted!.version,
      });
      assert.equal(approved?.status, "approved");
      assert.ok(approved?.lockedAt);
      await assert.rejects(
        () =>
          db.insert(timeLogs).values({
            organizationId,
            workspaceId,
            timesheetId: approved!.id,
            taskId,
            userId: memberId,
            durationMinutes: 10,
            billable: true,
            startedAt: new Date(firstLog.startedAt),
            endedAt: new Date(new Date(firstLog.startedAt).getTime() + 10 * 60_000),
          }),
        (error: unknown) =>
          (error as { cause?: { message?: string } }).cause?.message?.includes("locked for editing") === true,
      );

      const reviewerLog = await reviewer.create({
        taskId,
        durationMinutes: 30,
        startedAt: nextMonday(),
      });
      const reviewerPeriod = (await reviewer.list()).timesheets.find(
        (period) => period.id === reviewerLog.timesheetId,
      )!;
      const reviewerSubmitted = await reviewer.submit(reviewerPeriod.id, reviewerPeriod.version);
      await assert.rejects(
        () =>
          reviewer.review(reviewerSubmitted!.id, {
            decision: "approved",
            expectedVersion: reviewerSubmitted!.version,
          }),
        (error: unknown) => error instanceof TenantPermissionDeniedError && /their own timesheet/.test(error.message),
      );

      const future = nextMonday();
      future.setUTCDate(future.getUTCDate() + 7);
      const returnedLog = await member.create({ taskId, durationMinutes: 45, startedAt: future });
      const returnedPeriod = (await member.list()).timesheets.find((period) => period.id === returnedLog.timesheetId)!;
      const returnedSubmitted = await member.submit(returnedPeriod.id, returnedPeriod.version);
      const rejected = await reviewer.review(returnedSubmitted!.id, {
        decision: "rejected",
        expectedVersion: returnedSubmitted!.version,
        reason: "Please add the client reference",
      });
      assert.equal(rejected?.status, "rejected");
      await member.create({ taskId, durationMinutes: 15, startedAt: future });
      const reopened = (await member.list()).timesheets.find((period) => period.id === returnedPeriod.id);
      assert.equal(reopened?.status, "draft");
      assert.equal(reopened?.totalMinutes, 60);
    } finally {
      await db
        .delete(timeLogs)
        .where(eq(timeLogs.organizationId, organizationId))
        .catch(() => undefined);
      await db
        .delete(timesheets)
        .where(eq(timesheets.organizationId, organizationId))
        .catch(() => undefined);
      await db
        .delete(tasks)
        .where(eq(tasks.projectId, projectId))
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
        .where(eq(users.id, memberId))
        .catch(() => undefined);
      await db
        .delete(users)
        .where(eq(users.id, reviewerId))
        .catch(() => undefined);
    }
  });
});
