import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "../client.js";
import { activities, memberships, tasks, users, workspaces } from "../schema.js";
import { assertWorkspaceTenantContext, type DatabaseTenantContext } from "../tenant-context.js";
import { TenantResourceNotFoundError } from "../errors.js";

export type CreateActivityInput = Omit<typeof activities.$inferInsert, "organizationId" | "workspaceId">;

export function createActivitiesRepository(context: DatabaseTenantContext) {
  assertWorkspaceTenantContext(context);
  const { organizationId, workspaceId } = context;
  const tenantScope = and(eq(activities.organizationId, organizationId), eq(activities.workspaceId, workspaceId))!;

  async function requireWorkspace() {
    const [workspace] = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(and(eq(workspaces.id, workspaceId), eq(workspaces.organizationId, organizationId)))
      .limit(1);
    if (!workspace) throw new TenantResourceNotFoundError("workspace");
  }

  async function requireActor(actorId: string) {
    const [membership] = await db
      .select({ id: memberships.id })
      .from(memberships)
      .where(
        and(
          eq(memberships.userId, actorId),
          eq(memberships.organizationId, organizationId),
          eq(memberships.status, "active"),
          or(isNull(memberships.workspaceId), eq(memberships.workspaceId, workspaceId)),
        ),
      )
      .limit(1);
    if (!membership) throw new TenantResourceNotFoundError("activity actor");
  }

  return {
    async list(limit = 40) {
      await requireWorkspace();
      const rows = await db
        .select()
        .from(activities)
        .where(tenantScope)
        .orderBy(desc(activities.createdAt))
        .limit(Math.min(Math.max(limit, 1), 100));
      const actorIds = [...new Set(rows.map((activity) => activity.actorId))];
      const taskIds = [
        ...new Set(rows.flatMap((activity) => (activity.entityType === "task" ? [activity.entityId] : []))),
      ];
      const actors = actorIds.length ? await db.select().from(users).where(inArray(users.id, actorIds)) : [];
      const entityTasks = taskIds.length
        ? await db
            .select()
            .from(tasks)
            .where(
              and(
                inArray(tasks.id, taskIds),
                eq(tasks.organizationId, organizationId),
                eq(tasks.workspaceId, workspaceId),
              ),
            )
        : [];
      const actorMap = new Map(actors.map((actor) => [actor.id, actor]));
      const taskMap = new Map(entityTasks.map((task) => [task.id, task]));

      return rows.map((activity) => ({
        ...activity,
        actor: actorMap.get(activity.actorId) ?? null,
        entityLabel:
          activity.entityType === "task"
            ? (taskMap.get(activity.entityId)?.title ?? activity.entityId)
            : activity.entityId,
        entitySerial: activity.entityType === "task" ? (taskMap.get(activity.entityId)?.serial ?? null) : null,
      }));
    },

    async create(input: CreateActivityInput) {
      await requireWorkspace();
      await requireActor(input.actorId);
      const [activity] = await db
        .insert(activities)
        .values({
          ...input,
          organizationId,
          workspaceId,
        })
        .returning();
      return activity;
    },
  };
}
