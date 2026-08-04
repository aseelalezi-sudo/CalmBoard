import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../client.js";
import { TenantConflictError, TenantPermissionDeniedError, TenantResourceNotFoundError } from "../errors.js";
import { goalCheckins, goals, goalTaskLinks, memberships, tasks, users, workspaces } from "../schema.js";
import { assertWorkspaceTenantContext, type DatabaseTenantContext } from "../tenant-context.js";

export type GoalType = "objective" | "key_result";
export type GoalProgressMode = "manual" | "measurement" | "tasks" | "children";
export type GoalMeasurementUnit = "percentage" | "number" | "currency" | "boolean";
export type GoalStatus = "on_track" | "at_risk" | "off_track" | "achieved";
export type CreateGoalInput = Omit<
  typeof goals.$inferInsert,
  "organizationId" | "workspaceId" | "checkins" | "progress" | "status"
> & {
  type: GoalType;
  progressMode?: GoalProgressMode;
  measurementUnit?: GoalMeasurementUnit;
};
export type UpdateGoalInput = Partial<
  Pick<
    typeof goals.$inferInsert,
    | "title"
    | "description"
    | "ownerId"
    | "parentId"
    | "progressMode"
    | "measurementUnit"
    | "startValue"
    | "currentValue"
    | "targetValue"
    | "weight"
    | "periodStart"
    | "periodEnd"
  >
>;

export type GoalCheckinInput = {
  note: string;
  progress?: number;
  currentValue?: number;
};

function clampProgress(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function measurementProgress(startValue: number, currentValue: number, targetValue: number) {
  if (targetValue === startValue) throw new TenantConflictError("Goal target must differ from its start value");
  return clampProgress(((currentValue - startValue) / (targetValue - startValue)) * 100);
}

function statusForProgress(
  progress: number,
  periodStart: Date | null,
  periodEnd: Date | null,
  now = new Date(),
): GoalStatus {
  if (progress >= 100) return "achieved";
  if (periodStart && periodEnd && periodEnd > periodStart) {
    const expected = clampProgress(
      ((now.getTime() - periodStart.getTime()) / (periodEnd.getTime() - periodStart.getTime())) * 100,
    );
    const variance = progress - expected;
    return variance >= -10 ? "on_track" : variance >= -25 ? "at_risk" : "off_track";
  }
  return progress >= 60 ? "on_track" : progress >= 30 ? "at_risk" : "off_track";
}

export function createGoalsRepository(context: DatabaseTenantContext) {
  assertWorkspaceTenantContext(context);
  const { organizationId, workspaceId, actorId } = context;
  const tenantScope = and(
    eq(goals.organizationId, organizationId),
    eq(goals.workspaceId, workspaceId),
    isNull(goals.deletedAt),
  )!;

  function requireActor() {
    if (!actorId) throw new TenantPermissionDeniedError("An authenticated actor is required to manage OKRs");
    return actorId;
  }

  async function requireWorkspace() {
    const [workspace] = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(and(eq(workspaces.id, workspaceId), eq(workspaces.organizationId, organizationId)))
      .limit(1);
    if (!workspace) throw new TenantResourceNotFoundError("workspace");
  }

  async function requireActiveMember(userId: string) {
    const [membership] = await db
      .select({ id: memberships.id })
      .from(memberships)
      .where(
        and(
          eq(memberships.userId, userId),
          eq(memberships.organizationId, organizationId),
          eq(memberships.status, "active"),
          sql`(${memberships.workspaceId} is null or ${memberships.workspaceId} = ${workspaceId})`,
        ),
      )
      .limit(1);
    if (!membership) throw new TenantResourceNotFoundError("goal owner");
  }

  async function requireGoal(goalId: string) {
    const [goal] = await db
      .select()
      .from(goals)
      .where(and(eq(goals.id, goalId), tenantScope))
      .limit(1);
    if (!goal) throw new TenantResourceNotFoundError("goal");
    return goal;
  }

  async function requireObjective(parentId: string) {
    const parent = await requireGoal(parentId);
    if (parent.type !== "objective") throw new TenantConflictError("A key result parent must be an objective");
    return parent;
  }

  async function requireTask(taskId: string) {
    const [task] = await db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.id, taskId),
          eq(tasks.organizationId, organizationId),
          eq(tasks.workspaceId, workspaceId),
          isNull(tasks.deletedAt),
        ),
      )
      .limit(1);
    if (!task) throw new TenantResourceNotFoundError("task");
    return task;
  }

  async function refreshProgress(goalId: string) {
    await db.execute(sql`select public.refresh_goal_progress(${goalId}::uuid)`);
    return requireGoal(goalId);
  }

  async function hydrate(records: Array<typeof goals.$inferSelect>) {
    if (!records.length) return [];
    const goalIds = records.map((goal) => goal.id);
    const owners = await db
      .select({ id: users.id, name: users.name, email: users.email, avatarUrl: users.avatarUrl })
      .from(users)
      .where(inArray(users.id, [...new Set(records.flatMap((goal) => (goal.ownerId ? [goal.ownerId] : [])))]));
    const links = await db
      .select()
      .from(goalTaskLinks)
      .where(
        and(
          eq(goalTaskLinks.organizationId, organizationId),
          eq(goalTaskLinks.workspaceId, workspaceId),
          inArray(goalTaskLinks.goalId, goalIds),
        ),
      );
    const checkinRows = await db
      .select()
      .from(goalCheckins)
      .where(
        and(
          eq(goalCheckins.organizationId, organizationId),
          eq(goalCheckins.workspaceId, workspaceId),
          inArray(goalCheckins.goalId, goalIds),
        ),
      )
      .orderBy(desc(goalCheckins.createdAt));
    const taskIds = [...new Set(links.map((link) => link.taskId))];
    const linkedTasks = taskIds.length
      ? await db
          .select({
            id: tasks.id,
            serial: tasks.serial,
            title: tasks.title,
            progress: tasks.progress,
            status: tasks.status,
          })
          .from(tasks)
          .where(
            and(
              eq(tasks.organizationId, organizationId),
              eq(tasks.workspaceId, workspaceId),
              inArray(tasks.id, taskIds),
              isNull(tasks.deletedAt),
            ),
          )
      : [];
    const checkinAuthorIds = [
      ...new Set(checkinRows.flatMap((checkin) => (checkin.createdById ? [checkin.createdById] : []))),
    ];
    const checkinAuthors = checkinAuthorIds.length
      ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, checkinAuthorIds))
      : [];
    const ownerMap = new Map(owners.map((owner) => [owner.id, owner]));
    const taskMap = new Map(linkedTasks.map((task) => [task.id, task]));
    const authorMap = new Map(checkinAuthors.map((author) => [author.id, author]));
    const linksByGoal = new Map<string, typeof links>();
    const checkinsByGoal = new Map<string, typeof checkinRows>();
    for (const link of links) linksByGoal.set(link.goalId, [...(linksByGoal.get(link.goalId) ?? []), link]);
    for (const checkin of checkinRows) {
      checkinsByGoal.set(checkin.goalId, [...(checkinsByGoal.get(checkin.goalId) ?? []), checkin]);
    }

    return records.map((goal) => {
      const normalizedCheckins = (checkinsByGoal.get(goal.id) ?? []).map((checkin) => ({
        id: checkin.id,
        progress: checkin.progress,
        currentValue: checkin.currentValue,
        status: checkin.status,
        note: checkin.note,
        date: checkin.createdAt,
        author: checkin.createdById ? authorMap.get(checkin.createdById)?.name : undefined,
      }));
      return {
        ...goal,
        owner: goal.ownerId ? (ownerMap.get(goal.ownerId) ?? null) : null,
        linkedTasks: (linksByGoal.get(goal.id) ?? []).flatMap((link) => {
          const task = taskMap.get(link.taskId);
          return task ? [{ ...task, weight: link.weight }] : [];
        }),
        checkins:
          normalizedCheckins.length > 0
            ? normalizedCheckins
            : (goal.checkins ?? []).map((checkin) => ({ ...checkin, date: new Date(checkin.date) })),
      };
    });
  }

  return {
    async list() {
      await requireWorkspace();
      const records = await db.select().from(goals).where(tenantScope).orderBy(desc(goals.createdAt));
      return hydrate(records);
    },

    async create(input: CreateGoalInput) {
      requireActor();
      await requireWorkspace();
      if (input.ownerId) await requireActiveMember(input.ownerId);
      if (input.type === "objective" && input.parentId) {
        throw new TenantConflictError("An objective cannot have a parent");
      }
      if (input.type === "key_result") {
        if (!input.parentId) throw new TenantConflictError("A key result requires an objective");
        await requireObjective(input.parentId);
      }
      const progressMode: GoalProgressMode =
        input.type === "objective" ? "children" : (input.progressMode ?? "measurement");
      const startValue = input.startValue ?? 0;
      const currentValue = input.currentValue ?? startValue;
      const targetValue = input.targetValue ?? 100;
      const progress = progressMode === "measurement" ? measurementProgress(startValue, currentValue, targetValue) : 0;
      const periodStart = input.periodStart ?? null;
      const periodEnd = input.periodEnd ?? null;
      const [goal] = await db
        .insert(goals)
        .values({
          ...input,
          organizationId,
          workspaceId,
          progressMode,
          startValue,
          currentValue,
          targetValue,
          progress,
          status: statusForProgress(progress, periodStart, periodEnd),
        })
        .returning();
      if (goal.parentId) await refreshProgress(goal.parentId);
      return (await hydrate([goal]))[0]!;
    },

    async update(goalId: string, input: UpdateGoalInput) {
      requireActor();
      const before = await requireGoal(goalId);
      if (input.ownerId) await requireActiveMember(input.ownerId);
      if (input.parentId !== undefined) {
        if (before.type !== "key_result") throw new TenantConflictError("An objective cannot have a parent");
        if (!input.parentId) throw new TenantConflictError("A key result requires an objective");
        await requireObjective(input.parentId);
      }
      const [updated] = await db
        .update(goals)
        .set({ ...input, updatedAt: new Date() })
        .where(and(eq(goals.id, goalId), tenantScope))
        .returning();
      if (!updated) throw new TenantResourceNotFoundError("goal");
      const refreshed = ["tasks", "children"].includes(updated.progressMode)
        ? await refreshProgress(updated.id)
        : updated.progressMode === "measurement"
          ? (
              await db
                .update(goals)
                .set({
                  progress: measurementProgress(updated.startValue, updated.currentValue, updated.targetValue),
                  status: statusForProgress(
                    measurementProgress(updated.startValue, updated.currentValue, updated.targetValue),
                    updated.periodStart,
                    updated.periodEnd,
                  ),
                  updatedAt: new Date(),
                })
                .where(and(eq(goals.id, goalId), tenantScope))
                .returning()
            )[0]!
          : updated;
      if (before.parentId && before.parentId !== refreshed.parentId) await refreshProgress(before.parentId);
      if (refreshed.parentId) await refreshProgress(refreshed.parentId);
      return (await hydrate([refreshed]))[0]!;
    },

    async checkIn(goalId: string, input: GoalCheckinInput) {
      const currentActorId = requireActor();
      const goal = await requireGoal(goalId);
      let progress = goal.progress;
      let currentValue: number | null = null;
      if (goal.progressMode === "manual") {
        if (input.progress === undefined) throw new TenantConflictError("Manual goals require check-in progress");
        progress = clampProgress(input.progress);
      } else if (goal.progressMode === "measurement") {
        if (input.currentValue === undefined) {
          throw new TenantConflictError("Measurement goals require a current value");
        }
        currentValue = input.currentValue;
        progress = measurementProgress(goal.startValue, currentValue, goal.targetValue);
      }
      const status = statusForProgress(progress, goal.periodStart, goal.periodEnd);
      const updated = await db.transaction(async (transaction) => {
        const [locked] = await transaction
          .select()
          .from(goals)
          .where(and(eq(goals.id, goalId), tenantScope))
          .for("update")
          .limit(1);
        if (!locked) throw new TenantResourceNotFoundError("goal");
        const [record] = await transaction
          .update(goals)
          .set({
            ...(goal.progressMode === "manual" || goal.progressMode === "measurement"
              ? { progress, status, ...(currentValue === null ? {} : { currentValue }) }
              : {}),
            updatedAt: new Date(),
          })
          .where(and(eq(goals.id, goalId), tenantScope))
          .returning();
        await transaction.insert(goalCheckins).values({
          organizationId,
          workspaceId,
          goalId,
          progress: record.progress,
          currentValue: goal.progressMode === "measurement" ? record.currentValue : null,
          status: record.status,
          note: input.note,
          createdById: currentActorId,
        });
        return record;
      });
      if (updated.parentId) await refreshProgress(updated.parentId);
      return (await hydrate([updated]))[0]!;
    },

    async linkTask(goalId: string, taskId: string, weight = 1) {
      const currentActorId = requireActor();
      const goal = await requireGoal(goalId);
      await requireTask(taskId);
      if (goal.type !== "key_result") throw new TenantConflictError("Tasks can be linked only to key results");
      if (!Number.isFinite(weight) || weight <= 0 || weight > 100) {
        throw new TenantConflictError("Task contribution weight must be between 0 and 100");
      }
      await db.transaction(async (transaction) => {
        await transaction
          .update(goals)
          .set({ progressMode: "tasks", updatedAt: new Date() })
          .where(and(eq(goals.id, goalId), tenantScope));
        await transaction
          .insert(goalTaskLinks)
          .values({ organizationId, workspaceId, goalId, taskId, weight, createdById: currentActorId })
          .onConflictDoUpdate({
            target: [goalTaskLinks.goalId, goalTaskLinks.taskId],
            set: { weight, createdById: currentActorId },
          });
      });
      const refreshed = await refreshProgress(goalId);
      if (refreshed.parentId) await refreshProgress(refreshed.parentId);
      return (await hydrate([refreshed]))[0]!;
    },

    async unlinkTask(goalId: string, taskId: string) {
      requireActor();
      const goal = await requireGoal(goalId);
      await db
        .delete(goalTaskLinks)
        .where(
          and(
            eq(goalTaskLinks.organizationId, organizationId),
            eq(goalTaskLinks.workspaceId, workspaceId),
            eq(goalTaskLinks.goalId, goalId),
            eq(goalTaskLinks.taskId, taskId),
          ),
        );
      const refreshed = await refreshProgress(goalId);
      if (goal.parentId) await refreshProgress(goal.parentId);
      return (await hydrate([refreshed]))[0]!;
    },
  };
}
