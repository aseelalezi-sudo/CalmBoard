import { db } from "../client.js";
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
  const followersRepo = createTaskFollowersRepository(context, database);
  const activeWatchers = await followersRepo.activeWatcherIds(input.taskId);

  const excluded = new Set([...(input.actorId ? [input.actorId] : []), ...(input.excludedUserIds ?? [])]);

  const eligibleWatcherIds = activeWatchers.filter((userId) => !excluded.has(userId));
  if (!eligibleWatcherIds.length) {
    return { notifiedUserIds: [] };
  }

  const notificationsRepo = createNotificationsRepository(context, database);
  const notifiedUserIds: string[] = [];

  for (const userId of eligibleWatcherIds) {
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
    if (preferences?.inAppEnabled !== false) {
      const created = await notificationsRepo.create(notificationInput);
      notificationId = created.id;
      notifiedUserIds.push(userId);
    }
    if (user.email && preferences?.emailEnabled !== false) {
      await notificationsRepo.enqueueEmail(notificationInput, notificationId);
      if (!notifiedUserIds.includes(userId)) {
        notifiedUserIds.push(userId);
      }
    }
  }

  return { notifiedUserIds };
}
