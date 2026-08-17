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
