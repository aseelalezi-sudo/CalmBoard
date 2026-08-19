import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "../client.js";
import { memberships } from "../schema.js";
import { assertWorkspaceTenantContext, type DatabaseTenantContext } from "../tenant-context.js";
import { createNotificationsRepository } from "./notifications.js";
import { createTaskFollowersRepository } from "./task-followers.js";

export type DispatchWatcherNotificationInput = {
  taskId: string;
  actorId?: string | null;
  excludedUserIds?: string[];
  type: string;
  title: string;
  body: string;
  deduplicationKeyTemplate: (userId: string) => string;
  actionPath?: string | null;
};

type DatabaseExecutor = Pick<typeof db, "select" | "insert" | "update">;

export async function dispatchWatcherNotifications(
  context: DatabaseTenantContext,
  input: DispatchWatcherNotificationInput,
  database: DatabaseExecutor = db,
) {
  assertWorkspaceTenantContext(context);
  const { organizationId, workspaceId } = context;
  const followersRepo = createTaskFollowersRepository(context, database);
  const activeWatchers = await followersRepo.activeWatcherIds(input.taskId);

  const excluded = new Set([...(input.actorId ? [input.actorId] : []), ...(input.excludedUserIds ?? [])]);

  const candidateWatcherIds = activeWatchers.filter((userId) => !excluded.has(userId));
  if (!candidateWatcherIds.length) {
    return { notifiedUserIds: [] };
  }

  // Filter watchers to only users with currently active tenant membership
  const activeMembers = await database
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(
      and(
        inArray(memberships.userId, candidateWatcherIds),
        eq(memberships.organizationId, organizationId),
        or(eq(memberships.workspaceId, workspaceId), isNull(memberships.workspaceId)),
        eq(memberships.status, "active"),
      ),
    );

  const activeMemberUserIds = new Set(activeMembers.map((m) => m.userId));
  const eligibleWatcherIds = candidateWatcherIds.filter((userId) => activeMemberUserIds.has(userId));
  if (!eligibleWatcherIds.length) {
    return { notifiedUserIds: [] };
  }

  const notificationsRepo = createNotificationsRepository(context, database);
  const notifiedUserIds: string[] = [];

  for (const userId of eligibleWatcherIds) {
    try {
      const { user, preferences } = await notificationsRepo.getDeliveryProfile(userId);
      const deduplicationKey = input.deduplicationKeyTemplate(userId);
      const notificationInput = {
        userId,
        type: input.type,
        title: input.title,
        body: input.body,
        entityType: "task",
        entityId: input.taskId,
        deduplicationKey,
        actionPath: input.actionPath ?? `/?taskId=${encodeURIComponent(input.taskId)}`,
      };

      let notificationId: string | null = null;
      let delivered = false;

      if (preferences?.inAppEnabled !== false) {
        const created = await notificationsRepo.create(notificationInput);
        notificationId = created.id;
        delivered = true;
      }
      if (user.email && preferences?.emailEnabled !== false) {
        await notificationsRepo.enqueueEmail(notificationInput, notificationId);
        delivered = true;
      }

      if (delivered && !notifiedUserIds.includes(userId)) {
        notifiedUserIds.push(userId);
      }
    } catch (error) {
      console.error(`Failed to deliver watcher notification to user ${userId}:`, error);
    }
  }

  return { notifiedUserIds };
}
