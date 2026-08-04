import { and, asc, eq, gte, isNull, lte, or } from "drizzle-orm";
import { db } from "../client.js";
import { TenantConflictError, TenantResourceNotFoundError } from "../errors.js";
import { memberships, workloadCapacities, workloadTimeOff } from "../schema.js";
import { assertWorkspaceTenantContext, type DatabaseTenantContext } from "../tenant-context.js";

export type WorkloadTimeOffKind = typeof workloadTimeOff.$inferInsert.kind;

export type UpsertWorkloadCapacityInput = {
  userId: string;
  weeklyMinutes: number;
  workdayMask: number;
};

export type CreateWorkloadTimeOffInput = {
  userId?: string | null;
  kind: WorkloadTimeOffKind;
  startsOn: string;
  endsOn: string;
  minutesPerDay?: number | null;
  note?: string | null;
};

export function createWorkloadRepository(context: DatabaseTenantContext) {
  assertWorkspaceTenantContext(context);
  const { organizationId, workspaceId, actorId } = context;
  const tenantCapacityScope = and(
    eq(workloadCapacities.organizationId, organizationId),
    eq(workloadCapacities.workspaceId, workspaceId),
  )!;
  const tenantTimeOffScope = and(
    eq(workloadTimeOff.organizationId, organizationId),
    eq(workloadTimeOff.workspaceId, workspaceId),
  )!;

  async function requireActiveMember(userId: string) {
    const [membership] = await db
      .select({ id: memberships.id })
      .from(memberships)
      .where(
        and(
          eq(memberships.userId, userId),
          eq(memberships.organizationId, organizationId),
          eq(memberships.status, "active"),
          or(isNull(memberships.workspaceId), eq(memberships.workspaceId, workspaceId)),
        ),
      )
      .limit(1);
    if (!membership) throw new TenantResourceNotFoundError("active workspace member");
  }

  return {
    async list(rangeStart?: string, rangeEnd?: string) {
      const rangeFilter =
        rangeStart && rangeEnd
          ? and(lte(workloadTimeOff.startsOn, rangeEnd), gte(workloadTimeOff.endsOn, rangeStart))
          : undefined;
      const capacities = await db
        .select()
        .from(workloadCapacities)
        .where(tenantCapacityScope)
        .orderBy(asc(workloadCapacities.userId));
      const timeOff = await db
        .select()
        .from(workloadTimeOff)
        .where(and(tenantTimeOffScope, rangeFilter))
        .orderBy(asc(workloadTimeOff.startsOn), asc(workloadTimeOff.createdAt));
      return { capacities, timeOff };
    },

    async upsertCapacity(input: UpsertWorkloadCapacityInput) {
      await requireActiveMember(input.userId);
      const [capacity] = await db
        .insert(workloadCapacities)
        .values({
          organizationId,
          workspaceId,
          userId: input.userId,
          weeklyMinutes: input.weeklyMinutes,
          workdayMask: input.workdayMask,
        })
        .onConflictDoUpdate({
          target: [workloadCapacities.organizationId, workloadCapacities.workspaceId, workloadCapacities.userId],
          set: {
            weeklyMinutes: input.weeklyMinutes,
            workdayMask: input.workdayMask,
            updatedAt: new Date(),
          },
        })
        .returning();
      return capacity;
    },

    async createTimeOff(input: CreateWorkloadTimeOffInput) {
      if (input.kind === "public_holiday") {
        if (input.userId) throw new TenantConflictError("Public holidays apply to the whole workspace");
      } else {
        if (!input.userId) throw new TenantConflictError("Member time off requires a userId");
        await requireActiveMember(input.userId);
      }
      const [entry] = await db
        .insert(workloadTimeOff)
        .values({
          organizationId,
          workspaceId,
          userId: input.userId ?? null,
          kind: input.kind,
          status: "approved",
          startsOn: input.startsOn,
          endsOn: input.endsOn,
          minutesPerDay: input.minutesPerDay ?? null,
          note: input.note?.trim() || null,
          createdBy: actorId ?? null,
        })
        .returning();
      return entry;
    },

    async deleteTimeOff(id: string) {
      const deleted = await db
        .delete(workloadTimeOff)
        .where(and(eq(workloadTimeOff.id, id), tenantTimeOffScope))
        .returning({ id: workloadTimeOff.id });
      if (!deleted.length) throw new TenantResourceNotFoundError("workload time off");
    },
  };
}
