import type { Task } from "@/lib/types";

/**
 * Returns all active execution assignee user IDs for a task.
 * Lead assignee is guaranteed to be first if present.
 */
export function getTaskAssigneeIds(task: Partial<Task> | null | undefined): string[] {
  if (!task) return [];
  const set = new Set<string>();
  if (task.assigneeId) set.add(task.assigneeId);
  if (task.assigneeIds) {
    for (const id of task.assigneeIds) {
      set.add(id);
    }
  }
  return [...set];
}

/**
 * Checks whether a given user is assigned to the task (as Lead OR Contributor).
 */
export function isTaskAssignedTo(task: Partial<Task> | null | undefined, userId: string | null | undefined): boolean {
  if (!task || !userId) return false;
  return task.assigneeId === userId || (task.assigneeIds?.includes(userId) ?? false);
}

/**
 * Checks whether a given user is the primary Lead assignee of the task.
 */
export function isTaskLead(task: Partial<Task> | null | undefined, userId: string | null | undefined): boolean {
  if (!task || !userId) return false;
  return task.assigneeId === userId;
}

/**
 * Checks whether a given user is a non-lead contributor assignee of the task.
 */
export function isTaskContributor(task: Partial<Task> | null | undefined, userId: string | null | undefined): boolean {
  if (!task || !userId) return false;
  return task.assigneeId !== userId && (task.assigneeIds?.includes(userId) ?? false);
}

/**
 * Calculates the allocated effort share (in hours) for each execution assignee of a task.
 * For a task with estimatedHours = 12 and 3 assignees, returns 4.
 * Returns 0 if estimatedHours is undefined/null/non-positive or if there are no assignees.
 */
export function getTaskEffortShare(task: Partial<Task> | null | undefined): number {
  if (!task) return 0;
  const rawEstimated =
    typeof task.estimatedHours === "number" && Number.isFinite(task.estimatedHours) ? task.estimatedHours : 0;
  if (rawEstimated <= 0) return 0;
  const assignees = getTaskAssigneeIds(task);
  if (!assignees.length) return 0;
  const share = rawEstimated / assignees.length;
  return Number.isFinite(share) && !Number.isNaN(share) ? share : 0;
}

export type RebalanceTaskResult = {
  assigneeId: string | null;
  assigneeIds: string[];
};

/**
 * Pure domain helper to replace a source participant with a target participant on a task.
 *
 * - If target is already assigned to the task (or source is not assigned), returns null.
 * - If source is the Lead (task.assigneeId === sourceUserId):
 *   Replaces source with target in assigneeIds, sets target as the new Lead (assigneeId),
 *   and preserves all remaining non-lead contributors.
 * - If source is a Contributor (task.assigneeId !== sourceUserId):
 *   Preserves the existing Lead (task.assigneeId), and replaces source with target in assigneeIds.
 */
export function rebalanceTaskAssignees(
  task: Partial<Task> | null | undefined,
  sourceUserId: string,
  targetUserId: string,
): RebalanceTaskResult | null {
  if (!task || !sourceUserId || !targetUserId || sourceUserId === targetUserId) return null;
  const currentAssignees = getTaskAssigneeIds(task);
  if (!currentAssignees.includes(sourceUserId)) return null;
  if (currentAssignees.includes(targetUserId)) return null;

  let newAssigneeId: string | null = task.assigneeId ?? null;
  let newAssigneeIds: string[];

  if (task.assigneeId === sourceUserId) {
    newAssigneeId = targetUserId;
    newAssigneeIds = currentAssignees.map((id) => (id === sourceUserId ? targetUserId : id));
    if (!newAssigneeIds.includes(targetUserId)) {
      newAssigneeIds.unshift(targetUserId);
    }
  } else {
    newAssigneeIds = currentAssignees.map((id) => (id === sourceUserId ? targetUserId : id));
  }
  newAssigneeIds = [...new Set(newAssigneeIds)];

  return {
    assigneeId: newAssigneeId,
    assigneeIds: newAssigneeIds,
  };
}
