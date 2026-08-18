import { createTaskFollowersRepository, type DatabaseTenantContext } from "@calmboard/database";
import { logActivity } from "./automation-engine.js";

export function createTaskWatcherService(context: DatabaseTenantContext) {
  const followersRepo = createTaskFollowersRepository(context);

  return {
    async selfWatch(taskId: string, authenticatedUserId: string) {
      const result = await followersRepo.watch(taskId, authenticatedUserId);
      if (result.changed) {
        await logActivity({
          organizationId: context.organizationId,
          workspaceId: context.workspaceId!,
          actorId: authenticatedUserId,
          action: "task.watched",
          entityType: "task",
          entityId: taskId,
          newValues: { targetUserId: authenticatedUserId, source: "self" },
        });
      }
      return { ok: true, watching: true, changed: result.changed };
    },

    async selfUnwatch(taskId: string, authenticatedUserId: string) {
      const result = await followersRepo.unwatch(taskId, authenticatedUserId);
      if (result.changed) {
        await logActivity({
          organizationId: context.organizationId,
          workspaceId: context.workspaceId!,
          actorId: authenticatedUserId,
          action: "task.unwatched",
          entityType: "task",
          entityId: taskId,
          newValues: { targetUserId: authenticatedUserId, source: "self" },
        });
      }
      return { ok: true, watching: false, changed: result.changed };
    },

    async addWatcher(taskId: string, targetUserId: string, actorId: string) {
      const result = await followersRepo.watch(taskId, targetUserId);
      if (result.changed) {
        await logActivity({
          organizationId: context.organizationId,
          workspaceId: context.workspaceId!,
          actorId,
          action: "task.watcher_added",
          entityType: "task",
          entityId: taskId,
          newValues: { targetUserId, source: "managed" },
        });
      }
      return { ok: true, watching: true, changed: result.changed };
    },

    async removeWatcher(taskId: string, targetUserId: string, actorId: string) {
      const result = await followersRepo.unwatch(taskId, targetUserId);
      if (result.changed) {
        await logActivity({
          organizationId: context.organizationId,
          workspaceId: context.workspaceId!,
          actorId,
          action: "task.watcher_removed",
          entityType: "task",
          entityId: taskId,
          newValues: { targetUserId, source: "managed" },
        });
      }
      return { ok: true, watching: false, changed: result.changed };
    },
  };
}
