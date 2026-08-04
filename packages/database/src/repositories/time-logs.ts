import { and, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { db } from "../client.js";
import { TenantConflictError, TenantPermissionDeniedError, TenantResourceNotFoundError } from "../errors.js";
import { memberships, tasks, timeLogs, timesheets, users } from "../schema.js";
import { assertWorkspaceTenantContext, type DatabaseTenantContext } from "../tenant-context.js";

export type TimesheetStatus = "draft" | "submitted" | "approved" | "rejected";

export type CreateTimeLogInput = {
  taskId: string;
  durationMinutes: number;
  description?: string;
  billable?: boolean;
  startedAt?: Date;
};

function dateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

function weeklyPeriod(value: Date) {
  const start = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  const day = start.getUTCDay();
  start.setUTCDate(start.getUTCDate() - (day === 0 ? 6 : day - 1));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  return { periodStart: dateKey(start), periodEnd: dateKey(end) };
}

export function createTimeLogsRepository(context: DatabaseTenantContext) {
  assertWorkspaceTenantContext(context);
  const { organizationId, workspaceId } = context;
  if (!context.actorId) throw new TenantPermissionDeniedError("An authenticated actor is required for time tracking");
  const actorId = context.actorId;

  const taskScope = and(
    eq(tasks.organizationId, organizationId),
    eq(tasks.workspaceId, workspaceId),
    isNull(tasks.deletedAt),
  )!;
  const logScope = and(
    eq(timeLogs.organizationId, organizationId),
    eq(timeLogs.workspaceId, workspaceId),
    isNull(timeLogs.deletedAt),
  )!;
  const timesheetScope = and(eq(timesheets.organizationId, organizationId), eq(timesheets.workspaceId, workspaceId))!;

  async function requireActiveMember(userId: string) {
    const [membership] = await db
      .select({ id: memberships.id })
      .from(memberships)
      .where(
        and(
          eq(memberships.organizationId, organizationId),
          eq(memberships.userId, userId),
          eq(memberships.status, "active"),
          or(eq(memberships.workspaceId, workspaceId), isNull(memberships.workspaceId)),
        ),
      )
      .limit(1);
    if (!membership) throw new TenantPermissionDeniedError("Time tracking requires an active workspace membership");
  }

  async function hydrateTimesheets(rows: Array<typeof timesheets.$inferSelect>) {
    if (!rows.length) return [];
    const ids = rows.map((row) => row.id);
    const userIds = [...new Set(rows.map((row) => row.userId))];
    const people = await db
      .select({ id: users.id, name: users.name, email: users.email, avatarUrl: users.avatarUrl })
      .from(users)
      .where(inArray(users.id, userIds));
    const entries = await db
      .select({ log: timeLogs, task: tasks })
      .from(timeLogs)
      .innerJoin(tasks, eq(timeLogs.taskId, tasks.id))
      .where(and(inArray(timeLogs.timesheetId, ids), isNull(timeLogs.deletedAt)))
      .orderBy(desc(timeLogs.startedAt));
    const peopleById = new Map(people.map((person) => [person.id, person]));
    return rows.map((row) => {
      const periodEntries = entries.filter(({ log }) => log.timesheetId === row.id);
      return {
        ...row,
        user: peopleById.get(row.userId) ?? null,
        totalMinutes: periodEntries.reduce((total, { log }) => total + log.durationMinutes, 0),
        billableMinutes: periodEntries
          .filter(({ log }) => log.billable)
          .reduce((total, { log }) => total + log.durationMinutes, 0),
        entriesCount: periodEntries.length,
        tasksCount: new Set(periodEntries.map(({ log }) => log.taskId)).size,
        entries: periodEntries.map(({ log, task }) => ({ ...log, task })),
      };
    });
  }

  async function ownTimesheets() {
    const rows = await db
      .select()
      .from(timesheets)
      .where(and(timesheetScope, eq(timesheets.userId, actorId)))
      .orderBy(desc(timesheets.periodStart))
      .limit(26);
    return hydrateTimesheets(rows);
  }

  return {
    async list(options: { includeReviewQueue?: boolean } = {}) {
      await requireActiveMember(actorId);
      const rows = await db
        .select({ log: timeLogs, task: tasks })
        .from(timeLogs)
        .innerJoin(tasks, eq(timeLogs.taskId, tasks.id))
        .where(and(logScope, taskScope, eq(timeLogs.userId, actorId)))
        .orderBy(desc(timeLogs.startedAt))
        .limit(100);
      const own = await ownTimesheets();
      const reviewQueue = options.includeReviewQueue
        ? await hydrateTimesheets(
            await db
              .select()
              .from(timesheets)
              .where(and(timesheetScope, ne(timesheets.userId, actorId), ne(timesheets.status, "draft")))
              .orderBy(desc(timesheets.periodStart), desc(timesheets.updatedAt))
              .limit(100),
          )
        : [];
      return {
        logs: rows.map(({ log, task }) => ({ ...log, task })),
        totalMinutes: rows.reduce((total, { log }) => total + log.durationMinutes, 0),
        billableMinutes: rows
          .filter(({ log }) => log.billable)
          .reduce((total, { log }) => total + log.durationMinutes, 0),
        timesheets: own,
        reviewQueue,
      };
    },

    async create(input: CreateTimeLogInput) {
      await requireActiveMember(actorId);
      if (!Number.isSafeInteger(input.durationMinutes) || input.durationMinutes < 1 || input.durationMinutes > 1440) {
        throw new TenantConflictError("durationMinutes must be between 1 and 1440");
      }
      const startedAt = input.startedAt ?? new Date(Date.now() - input.durationMinutes * 60_000);
      if (Number.isNaN(startedAt.getTime())) throw new TenantConflictError("startedAt must be a valid date");
      const endedAt = new Date(startedAt.getTime() + input.durationMinutes * 60_000);
      const period = weeklyPeriod(startedAt);

      const created = await db.transaction(async (transaction) => {
        const [task] = await transaction
          .select({ id: tasks.id })
          .from(tasks)
          .where(and(eq(tasks.id, input.taskId), taskScope))
          .limit(1);
        if (!task) throw new TenantResourceNotFoundError("task");

        await transaction
          .insert(timesheets)
          .values({
            organizationId,
            workspaceId,
            userId: actorId,
            ...period,
          })
          .onConflictDoNothing();
        const [periodRow] = await transaction
          .select()
          .from(timesheets)
          .where(
            and(
              timesheetScope,
              eq(timesheets.userId, actorId),
              eq(timesheets.periodStart, period.periodStart),
              eq(timesheets.periodEnd, period.periodEnd),
            ),
          )
          .limit(1);
        if (!periodRow) throw new TenantResourceNotFoundError("timesheet");
        if (periodRow.status === "submitted" || periodRow.status === "approved" || periodRow.lockedAt) {
          throw new TenantConflictError("The timesheet period is locked for editing");
        }
        if (periodRow.status === "rejected") {
          await transaction
            .update(timesheets)
            .set({
              status: "draft",
              submittedAt: null,
              reviewedById: null,
              reviewedAt: null,
              rejectionReason: null,
              version: sql`${timesheets.version} + 1`,
              updatedAt: new Date(),
            })
            .where(eq(timesheets.id, periodRow.id));
        }

        const [log] = await transaction
          .insert(timeLogs)
          .values({
            organizationId,
            workspaceId,
            timesheetId: periodRow.id,
            taskId: input.taskId,
            userId: actorId,
            durationMinutes: input.durationMinutes,
            description: input.description?.trim() || null,
            billable: input.billable ?? true,
            startedAt,
            endedAt,
          })
          .returning();
        await transaction
          .update(tasks)
          .set({
            loggedHours: sql`coalesce(${tasks.loggedHours}, 0) + ${input.durationMinutes / 60}`,
            updatedAt: new Date(),
          })
          .where(and(eq(tasks.id, input.taskId), taskScope));
        return log;
      });
      return created;
    },

    async submit(timesheetId: string, expectedVersion: number) {
      await requireActiveMember(actorId);
      const submitted = await db.transaction(async (transaction) => {
        const [period] = await transaction
          .select()
          .from(timesheets)
          .where(and(eq(timesheets.id, timesheetId), timesheetScope, eq(timesheets.userId, actorId)))
          .limit(1);
        if (!period) throw new TenantResourceNotFoundError("timesheet");
        if (period.version !== expectedVersion)
          throw new TenantConflictError("The timesheet was modified by another request");
        if (period.status === "approved" || period.lockedAt)
          throw new TenantConflictError("Approved timesheets are locked");
        if (period.status === "submitted") return period;
        const [{ count }] = await transaction
          .select({ count: sql<number>`count(*)::int` })
          .from(timeLogs)
          .where(and(eq(timeLogs.timesheetId, period.id), isNull(timeLogs.deletedAt)));
        if (!count) throw new TenantConflictError("An empty timesheet cannot be submitted");
        const [updated] = await transaction
          .update(timesheets)
          .set({
            status: "submitted",
            submittedAt: new Date(),
            reviewedById: null,
            reviewedAt: null,
            rejectionReason: null,
            version: sql`${timesheets.version} + 1`,
            updatedAt: new Date(),
          })
          .where(and(eq(timesheets.id, period.id), eq(timesheets.version, expectedVersion)))
          .returning();
        if (!updated) throw new TenantConflictError("The timesheet was modified by another request");
        return updated;
      });
      return (await hydrateTimesheets([submitted]))[0];
    },

    async review(
      timesheetId: string,
      input: { decision: "approved" | "rejected"; expectedVersion: number; reason?: string },
    ) {
      await requireActiveMember(actorId);
      const reviewed = await db.transaction(async (transaction) => {
        const [period] = await transaction
          .select()
          .from(timesheets)
          .where(and(eq(timesheets.id, timesheetId), timesheetScope))
          .limit(1);
        if (!period) throw new TenantResourceNotFoundError("timesheet");
        if (period.userId === actorId)
          throw new TenantPermissionDeniedError("Reviewers cannot approve their own timesheet");
        if (period.version !== input.expectedVersion) {
          throw new TenantConflictError("The timesheet was modified by another request");
        }
        if (period.status !== "submitted") throw new TenantConflictError("Only submitted timesheets can be reviewed");
        const reason = input.reason?.trim() || null;
        if (input.decision === "rejected" && !reason) {
          throw new TenantConflictError("A rejection reason is required");
        }
        const now = new Date();
        const [updated] = await transaction
          .update(timesheets)
          .set({
            status: input.decision,
            reviewedById: actorId,
            reviewedAt: now,
            rejectionReason: input.decision === "rejected" ? reason : null,
            lockedAt: input.decision === "approved" ? now : null,
            version: sql`${timesheets.version} + 1`,
            updatedAt: now,
          })
          .where(and(eq(timesheets.id, period.id), eq(timesheets.version, input.expectedVersion)))
          .returning();
        if (!updated) throw new TenantConflictError("The timesheet was modified by another request");
        return updated;
      });
      return (await hydrateTimesheets([reviewed]))[0];
    },
  };
}
