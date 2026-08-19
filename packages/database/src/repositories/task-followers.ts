import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "../client.js";
import { TenantPermissionDeniedError, TenantResourceNotFoundError } from "../errors.js";
import { memberships, taskFollowers, tasks } from "../schema.js";
import { assertWorkspaceTenantContext, type DatabaseTenantContext } from "../tenant-context.js";

type TaskFollowersDatabase = Pick<typeof db, "select" | "insert" | "update">;

export type TaskFollowerRecord = typeof taskFollowers.$inferSelect;

export function createTaskFollowersRepository(context: DatabaseTenantContext, database: TaskFollowersDatabase = db) {
  assertWorkspaceTenantContext(context);
  const { organizationId, workspaceId } = context;

  const taskScope = and(
    eq(tasks.organizationId, organizationId),
    eq(tasks.workspaceId, workspaceId),
    isNull(tasks.deletedAt),
  )!;

  const followerScope = and(
    eq(taskFollowers.organizationId, organizationId),
    eq(taskFollowers.workspaceId, workspaceId),
  )!;

  async function requireTask(taskId: string) {
    const [task] = await database
      .select({ id: tasks.id, projectId: tasks.projectId })
      .from(tasks)
      .where(and(eq(tasks.id, taskId), taskScope))
      .limit(1);
    if (!task) throw new TenantResourceNotFoundError("task");
    return task;
  }

  async function requireActiveMembers(userIds: string[]) {
    if (!userIds.length) return;
    const unique = [...new Set(userIds)];
    const active = await database
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(
        and(
          inArray(memberships.userId, unique),
          eq(memberships.organizationId, organizationId),
          or(eq(memberships.workspaceId, workspaceId), isNull(memberships.workspaceId)),
          eq(memberships.status, "active"),
        ),
      );
    const activeUserIds = new Set(active.map((row) => row.userId));
    if (activeUserIds.size !== unique.length) {
      throw new TenantPermissionDeniedError("All watchers must be active tenant members");
    }
  }

  return {
    async listActive(taskId: string): Promise<TaskFollowerRecord[]> {
      await requireTask(taskId);
      return database
        .select()
        .from(taskFollowers)
        .where(and(followerScope, eq(taskFollowers.taskId, taskId), isNull(taskFollowers.unfollowedAt)))
        .orderBy(asc(taskFollowers.followedAt), asc(taskFollowers.userId));
    },

    async activeWatcherIds(taskId: string): Promise<string[]> {
      await requireTask(taskId);
      const rows = await database
        .select({ userId: taskFollowers.userId })
        .from(taskFollowers)
        .where(and(followerScope, eq(taskFollowers.taskId, taskId), isNull(taskFollowers.unfollowedAt)))
        .orderBy(asc(taskFollowers.followedAt), asc(taskFollowers.userId));
      return rows.map((r) => r.userId);
    },

    async watch(taskId: string, userId: string): Promise<{ changed: boolean; row?: TaskFollowerRecord }> {
      const task = await requireTask(taskId);
      await requireActiveMembers([userId]);

      const [inserted] = await database
        .insert(taskFollowers)
        .values({
          organizationId,
          workspaceId,
          projectId: task.projectId,
          taskId,
          userId,
          followedAt: new Date(),
        })
        .onConflictDoNothing()
        .returning();

      if (inserted) {
        return { changed: true, row: inserted };
      }

      const [existing] = await database
        .select()
        .from(taskFollowers)
        .where(
          and(
            followerScope,
            eq(taskFollowers.taskId, taskId),
            eq(taskFollowers.userId, userId),
            isNull(taskFollowers.unfollowedAt),
          ),
        )
        .limit(1);

      return { changed: false, row: existing };
    },

    async unwatch(taskId: string, userId: string): Promise<{ changed: boolean }> {
      await requireTask(taskId);

      const updated = await database
        .update(taskFollowers)
        .set({ unfollowedAt: new Date() })
        .where(
          and(
            followerScope,
            eq(taskFollowers.taskId, taskId),
            eq(taskFollowers.userId, userId),
            isNull(taskFollowers.unfollowedAt),
          ),
        )
        .returning({ id: taskFollowers.id });

      return { changed: updated.length > 0 };
    },

    async ensureWatchers(taskId: string, userIds: string[]): Promise<{ addedUserIds: string[]; changed: boolean }> {
      if (!userIds.length) return { addedUserIds: [], changed: false };
      const task = await requireTask(taskId);
      const uniqueIds = [...new Set(userIds)];
      await requireActiveMembers(uniqueIds);

      const inserted = await database
        .insert(taskFollowers)
        .values(
          uniqueIds.map((userId) => ({
            organizationId,
            workspaceId,
            projectId: task.projectId,
            taskId,
            userId,
            followedAt: new Date(),
          })),
        )
        .onConflictDoNothing()
        .returning({ userId: taskFollowers.userId });

      const addedUserIds = inserted.map((row) => row.userId);
      return { addedUserIds, changed: addedUserIds.length > 0 };
    },

    async replaceWatchersDelta(
      taskId: string,
      desiredUserIds: string[],
    ): Promise<{
      addedWatcherIds: string[];
      removedWatcherIds: string[];
      retainedWatcherIds: string[];
      changed: boolean;
    }> {
      const task = await requireTask(taskId);
      const desiredIds = [...new Set(desiredUserIds)];
      await requireActiveMembers(desiredIds);

      const activeRows = await database
        .select({ id: taskFollowers.id, userId: taskFollowers.userId, followedAt: taskFollowers.followedAt })
        .from(taskFollowers)
        .where(and(followerScope, eq(taskFollowers.taskId, taskId), isNull(taskFollowers.unfollowedAt)));

      const beforeIds = activeRows.map((r) => r.userId);
      const beforeSet = new Set(beforeIds);
      const desiredSet = new Set(desiredIds);

      const addedWatcherIds = desiredIds.filter((id) => !beforeSet.has(id));
      const removedWatcherIds = beforeIds.filter((id) => !desiredSet.has(id));
      const retainedWatcherIds = beforeIds.filter((id) => desiredSet.has(id));

      if (removedWatcherIds.length > 0) {
        await database
          .update(taskFollowers)
          .set({ unfollowedAt: new Date() })
          .where(
            and(
              followerScope,
              eq(taskFollowers.taskId, taskId),
              inArray(taskFollowers.userId, removedWatcherIds),
              isNull(taskFollowers.unfollowedAt),
            ),
          );
      }

      if (addedWatcherIds.length > 0) {
        await database
          .insert(taskFollowers)
          .values(
            addedWatcherIds.map((userId) => ({
              organizationId,
              workspaceId,
              projectId: task.projectId,
              taskId,
              userId,
              followedAt: new Date(),
            })),
          )
          .onConflictDoNothing();
      }

      return {
        addedWatcherIds,
        removedWatcherIds,
        retainedWatcherIds,
        changed: addedWatcherIds.length > 0 || removedWatcherIds.length > 0,
      };
    },
  };
}
