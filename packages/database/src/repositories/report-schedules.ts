import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "../client.js";
import { TenantConflictError, TenantPermissionDeniedError, TenantResourceNotFoundError } from "../errors.js";
import {
  memberships,
  reportScheduleRecipients,
  reportSchedules,
  workspaces,
  type ReportScheduleCadence,
  type ScheduledReportFormat,
} from "../schema.js";
import { assertWorkspaceTenantContext, type DatabaseTenantContext } from "../tenant-context.js";

export type ReportScheduleInput = {
  name: string;
  format: ScheduledReportFormat;
  cadence: ReportScheduleCadence;
  timezone: string;
  minuteOfDay: number;
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  recipientIds: string[];
  isEnabled: boolean;
};

export function createReportSchedulesRepository(context: DatabaseTenantContext) {
  assertWorkspaceTenantContext(context);
  const { organizationId, workspaceId, actorId } = context;
  if (!actorId) throw new TenantPermissionDeniedError("actorId is required to manage report schedules");
  const activeScope = and(
    eq(reportSchedules.organizationId, organizationId),
    eq(reportSchedules.workspaceId, workspaceId),
    eq(reportSchedules.createdBy, actorId),
    isNull(reportSchedules.deletedAt),
  )!;

  async function requireWorkspace() {
    const [workspace] = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(
        and(
          eq(workspaces.id, workspaceId),
          eq(workspaces.organizationId, organizationId),
          isNull(workspaces.deletedAt),
        ),
      )
      .limit(1);
    if (!workspace) throw new TenantResourceNotFoundError("workspace");
  }

  async function requireRecipients(recipientIds: string[]) {
    const rows = await db
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(
        and(
          eq(memberships.organizationId, organizationId),
          eq(memberships.status, "active"),
          or(eq(memberships.workspaceId, workspaceId), isNull(memberships.workspaceId)),
          inArray(memberships.userId, recipientIds),
        ),
      );
    const active = new Set(rows.map((row) => row.userId));
    if (active.size !== recipientIds.length) throw new TenantResourceNotFoundError("report schedule recipient");
  }

  async function nextRun(
    executor: Pick<typeof db, "execute">,
    input: Pick<ReportScheduleInput, "cadence" | "timezone" | "minuteOfDay" | "dayOfWeek" | "dayOfMonth">,
    after = new Date(),
  ) {
    const result = await executor.execute<{ next_run_at: Date }>(sql`
      select public.next_report_run(
        ${input.cadence},
        ${input.timezone},
        ${input.minuteOfDay},
        ${input.dayOfWeek},
        ${input.dayOfMonth},
        ${after}
      ) as next_run_at
    `);
    const value = result.rows[0]?.next_run_at;
    if (!value) throw new TenantConflictError("Could not calculate the next report run");
    return new Date(value);
  }

  async function withRecipients(scheduleRows: Array<typeof reportSchedules.$inferSelect>) {
    if (!scheduleRows.length) return [];
    const recipients = await db
      .select({ scheduleId: reportScheduleRecipients.scheduleId, userId: reportScheduleRecipients.userId })
      .from(reportScheduleRecipients)
      .where(
        and(
          eq(reportScheduleRecipients.organizationId, organizationId),
          eq(reportScheduleRecipients.workspaceId, workspaceId),
          inArray(
            reportScheduleRecipients.scheduleId,
            scheduleRows.map((schedule) => schedule.id),
          ),
        ),
      )
      .orderBy(asc(reportScheduleRecipients.createdAt));
    return scheduleRows.map((schedule) => ({
      ...schedule,
      recipientIds: recipients
        .filter((recipient) => recipient.scheduleId === schedule.id)
        .map((recipient) => recipient.userId),
    }));
  }

  return {
    async list() {
      await requireWorkspace();
      const schedules = await db
        .select()
        .from(reportSchedules)
        .where(activeScope)
        .orderBy(asc(reportSchedules.name), asc(reportSchedules.createdAt));
      return withRecipients(schedules);
    },

    async create(input: ReportScheduleInput) {
      await requireWorkspace();
      await requireRecipients(input.recipientIds);
      return db.transaction(async (transaction) => {
        const nextRunAt = await nextRun(transaction, input);
        const [schedule] = await transaction
          .insert(reportSchedules)
          .values({
            organizationId,
            workspaceId,
            createdBy: actorId,
            name: input.name,
            format: input.format,
            cadence: input.cadence,
            timezone: input.timezone,
            minuteOfDay: input.minuteOfDay,
            dayOfWeek: input.dayOfWeek,
            dayOfMonth: input.dayOfMonth,
            isEnabled: input.isEnabled,
            nextRunAt,
          })
          .returning();
        await transaction.insert(reportScheduleRecipients).values(
          input.recipientIds.map((userId) => ({
            organizationId,
            workspaceId,
            scheduleId: schedule.id,
            userId,
          })),
        );
        return { ...schedule, recipientIds: input.recipientIds };
      });
    },

    async update(scheduleId: string, expectedVersion: number, input: ReportScheduleInput) {
      await requireWorkspace();
      await requireRecipients(input.recipientIds);
      return db.transaction(async (transaction) => {
        const [existing] = await transaction
          .select()
          .from(reportSchedules)
          .where(and(activeScope, eq(reportSchedules.id, scheduleId)))
          .for("update")
          .limit(1);
        if (!existing) throw new TenantResourceNotFoundError("report schedule");
        if (existing.version !== expectedVersion) throw new TenantConflictError("Report schedule version is stale");
        const nextRunAt = await nextRun(transaction, input);
        const [updated] = await transaction
          .update(reportSchedules)
          .set({
            name: input.name,
            format: input.format,
            cadence: input.cadence,
            timezone: input.timezone,
            minuteOfDay: input.minuteOfDay,
            dayOfWeek: input.dayOfWeek,
            dayOfMonth: input.dayOfMonth,
            isEnabled: input.isEnabled,
            nextRunAt,
            version: existing.version + 1,
            updatedAt: new Date(),
          })
          .where(and(eq(reportSchedules.id, existing.id), eq(reportSchedules.version, expectedVersion)))
          .returning();
        if (!updated) throw new TenantConflictError("Report schedule version is stale");
        await transaction.delete(reportScheduleRecipients).where(eq(reportScheduleRecipients.scheduleId, existing.id));
        await transaction
          .insert(reportScheduleRecipients)
          .values(
            input.recipientIds.map((userId) => ({ organizationId, workspaceId, scheduleId: existing.id, userId })),
          );
        return { ...updated, recipientIds: input.recipientIds };
      });
    },

    async delete(scheduleId: string) {
      await requireWorkspace();
      const [deleted] = await db
        .update(reportSchedules)
        .set({ isEnabled: false, deletedAt: new Date(), updatedAt: new Date() })
        .where(and(activeScope, eq(reportSchedules.id, scheduleId)))
        .returning();
      if (!deleted) throw new TenantResourceNotFoundError("report schedule");
      return { ok: true };
    },
  };
}
