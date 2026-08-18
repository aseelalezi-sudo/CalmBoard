import type { Member, Task, User } from "@/lib/types";

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
      if (id) set.add(id);
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

export type TaskAssignmentRole = "lead" | "contributor" | null;

/**
 * Returns the assignment role for a given user on a task ("lead", "contributor", or null).
 */
export function getTaskAssignmentRole(
  task: Partial<Task> | null | undefined,
  userId: string | null | undefined,
): TaskAssignmentRole {
  if (!task || !userId) return null;
  if (isTaskLead(task, userId)) return "lead";
  if (isTaskContributor(task, userId)) return "contributor";
  return null;
}

/**
 * Determines whether a task should be included in the given user's "My Work" view.
 * A task is included if it is not soft-deleted and the user is assigned as Lead or Contributor.
 */
export function isTaskIncludedInMyWork(
  task: Partial<Task> | null | undefined,
  userId: string | null | undefined,
): boolean {
  if (!task || !userId) return false;
  if (task.deletedAt) return false;
  return isTaskAssignedTo(task, userId);
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

/**
 * Derives valid candidate assignees strictly scoped to the active workspace members.
 * FAIL-CLOSED: ONLY accepts member.status === "active".
 * Does NOT fall back to arbitrary directory users if workspace members are empty or have 0 active members.
 * directoryUsers is only used to populate the profile of an active member if member.user is not attached.
 * If zero active workspace members can be proven: candidate list = [].
 */
export function getWorkspaceCandidateUsers(
  members: Member[] | null | undefined,
  directoryUsers: User[] | null | undefined,
): User[] {
  const userMap = new Map<string, User>();

  if (members && members.length > 0) {
    for (const member of members) {
      if (member.status !== "active") {
        continue;
      }
      if (member.user && member.user.id) {
        userMap.set(member.user.id, member.user);
      } else if (member.userId) {
        const found = directoryUsers?.find((u) => u.id === member.userId);
        if (found) {
          userMap.set(found.id, found);
        }
      }
    }
  }

  return Array.from(userMap.values());
}

/**
 * Pure domain helper to determine if an assignment mutation produces no change
 * compared to the current task assignment state.
 *
 * Examples:
 * - Add user X when user X is already in task assignees.
 * - Remove user X when user X is not in task assignees.
 * - Set Lead user X when user X is already the Lead (task.assigneeId === user X).
 * - Clear all when task is already unassigned.
 */
export function isAssignmentMutationNoop(
  task: Partial<Task> | null | undefined,
  mutation: AssignmentMutationPayload,
): boolean {
  if (!task) {
    const targetIds = mutation.assigneeIds || [];
    return targetIds.length === 0 && (mutation.assigneeId === null || mutation.assigneeId === undefined);
  }

  const currentLead = task.assigneeId ?? null;
  const currentIds = getTaskAssigneeIds(task);

  // If mutation specifies an explicit assigneeId and it differs from currentLead
  if (mutation.assigneeId !== undefined) {
    const targetLead = mutation.assigneeId ?? null;
    if (targetLead !== currentLead) {
      return false;
    }
  }

  // Check if assigneeIds set is identical
  const targetIds = mutation.assigneeIds || [];
  if (currentIds.length !== targetIds.length) {
    return false;
  }

  for (let i = 0; i < currentIds.length; i++) {
    if (currentIds[i] !== targetIds[i]) {
      return false;
    }
  }

  return true;
}

export type ResolvedTaskPerson = {
  user: User;
  isLead: boolean;
  isContributor: boolean;
};

/**
 * Resolves full user profiles and role tags for all active assignees on a task.
 * Guaranteed to place the Lead first in the returned array.
 */
export function resolveTaskPeople(
  task: Partial<Task> | null | undefined,
  directoryUsers?: User[] | null,
  members?: Member[] | null,
): ResolvedTaskPerson[] {
  if (!task) return [];
  const assigneeIds = getTaskAssigneeIds(task);
  if (assigneeIds.length === 0) return [];

  const candidatePool = getWorkspaceCandidateUsers(members, directoryUsers);
  const poolMap = new Map<string, User>(candidatePool.map((u) => [u.id, u]));

  return assigneeIds.map((id) => {
    // 1. Look up in hydrated task.assignees
    let found = task.assignees?.find((u) => u.id === id);
    // 2. Look up in task.assignee
    if (!found && task.assigneeId === id && task.assignee) {
      found = task.assignee;
    }
    // 3. Look up in candidate pool
    if (!found) {
      found = poolMap.get(id);
    }
    // 4. Look up in raw directoryUsers
    if (!found && directoryUsers) {
      found = directoryUsers.find((u) => u.id === id);
    }
    // 5. Fallback synthetic user
    const resolvedUser: User = found ?? {
      id,
      name: `User ${id.slice(0, 4)}`,
      email: "",
    };

    const isLead = task.assigneeId === id;
    return {
      user: resolvedUser,
      isLead,
      isContributor: !isLead,
    };
  });
}

export type AssignmentMutationPayload = {
  assigneeId?: string | null;
  assigneeIds: string[];
};

/**
 * Pure mutation builder to add an execution assignee to a task.
 * - If task is unassigned: sets user as Lead and assigneeIds = [userId].
 * - If task already has assignees: preserves Lead, adds user to assigneeIds union.
 */
export function buildAddAssigneeMutation(
  task: Partial<Task> | null | undefined,
  userId: string,
): AssignmentMutationPayload {
  if (!userId) {
    return { assigneeId: task?.assigneeId ?? null, assigneeIds: getTaskAssigneeIds(task) };
  }
  const current = getTaskAssigneeIds(task);
  if (current.length === 0) {
    return {
      assigneeId: userId,
      assigneeIds: [userId],
    };
  }
  if (current.includes(userId)) {
    return {
      assigneeId: task?.assigneeId ?? current[0],
      assigneeIds: current,
    };
  }
  const next = [...current, userId];
  return {
    assigneeId: task?.assigneeId ?? current[0],
    assigneeIds: next,
  };
}

/**
 * Pure mutation builder to remove an execution assignee from a task.
 * - If Contributor is removed: preserves Lead, removes only Contributor.
 * - If Lead is removed with remaining contributors: sends remaining assigneeIds set
 *   (the canonical backend response determines and promotes the new Lead).
 * - If all assignees are removed: returns { assigneeId: null, assigneeIds: [] }.
 */
export function buildRemoveAssigneeMutation(
  task: Partial<Task> | null | undefined,
  userId: string,
): AssignmentMutationPayload {
  const current = getTaskAssigneeIds(task);
  const remaining = current.filter((id) => id !== userId);

  if (remaining.length === 0) {
    return {
      assigneeId: null,
      assigneeIds: [],
    };
  }

  // If removing the lead, omit assigneeId so backend canonical promotion takes effect
  if (task?.assigneeId === userId) {
    return {
      assigneeIds: remaining,
    };
  }

  // If removing a contributor, keep current lead intact
  return {
    assigneeId: task?.assigneeId ?? remaining[0],
    assigneeIds: remaining,
  };
}

/**
 * Pure mutation builder to designate a user as the primary Lead assignee.
 * Preserves all existing execution assignees while ensuring the selected Lead is first.
 */
export function buildSetLeadMutation(
  task: Partial<Task> | null | undefined,
  leadUserId: string,
): { assigneeId: string; assigneeIds: string[] } {
  const current = getTaskAssigneeIds(task);
  const others = current.filter((id) => id !== leadUserId);
  const next = [leadUserId, ...others];
  return {
    assigneeId: leadUserId,
    assigneeIds: next,
  };
}

/**
 * Pure mutation builder to clear all assignments from a task.
 */
export function buildClearAllAssigneesMutation(): { assigneeId: null; assigneeIds: [] } {
  return {
    assigneeId: null,
    assigneeIds: [],
  };
}

/**
 * Pure mutation builder for custom draft assignment sets (e.g. New Task Modal).
 */
export function buildCustomAssignmentMutation(
  currentLeadId: string | null,
  targetAssigneeIds: string[],
): { assigneeId: string | null; assigneeIds: string[] } {
  const cleanIds = [...new Set(targetAssigneeIds.filter(Boolean))];
  if (cleanIds.length === 0) {
    return {
      assigneeId: null,
      assigneeIds: [],
    };
  }
  if (currentLeadId && cleanIds.includes(currentLeadId)) {
    const others = cleanIds.filter((id) => id !== currentLeadId);
    return {
      assigneeId: currentLeadId,
      assigneeIds: [currentLeadId, ...others],
    };
  }
  return {
    assigneeId: cleanIds[0],
    assigneeIds: cleanIds,
  };
}
