import { TenantConflictError } from "../errors.js";

export type TaskAssignmentState = {
  assigneeId: string | null;
  assigneeIds: string[];
};

export type TaskAssignmentMutationInput = {
  assigneeId?: string | null;
  assigneeIds?: string[] | null;
};

export type ResolvedTaskAssignmentUpdate = {
  assigneeId: string | null;
  assigneeIds: string[];
  changed: boolean;
  addedAssigneeIds: string[];
  removedAssigneeIds: string[];
  primaryChanged: boolean;
  hasAssigneeMutation: boolean;
};

/**
 * Asserts that the given task assignment state strictly adheres to the canonical domain invariant:
 * 1. If unassigned: assigneeId is null and assigneeIds is empty.
 * 2. If assigned: assigneeId is non-null, assigneeIds contains assigneeId, assigneeId is the first element,
 *    and assigneeIds contains no duplicate IDs.
 */
export function assertCanonicalTaskAssignment(
  assigneeId: string | null | undefined,
  assigneeIds: string[] | null | undefined,
): void {
  const cleanAssigneeId = assigneeId ?? null;
  const cleanAssigneeIds = assigneeIds ?? [];

  if (new Set(cleanAssigneeIds).size !== cleanAssigneeIds.length) {
    throw new TenantConflictError("Task assigneeIds must contain unique user IDs");
  }

  if (cleanAssigneeId === null) {
    if (cleanAssigneeIds.length > 0) {
      throw new TenantConflictError("Task cannot have assignees without a Lead");
    }
  } else {
    if (cleanAssigneeIds.length === 0) {
      throw new TenantConflictError("Task with a Lead must have a non-empty assigneeIds list");
    }
    if (cleanAssigneeIds[0] !== cleanAssigneeId) {
      throw new TenantConflictError("Task Lead must be the first element in assigneeIds");
    }
    if (!cleanAssigneeIds.includes(cleanAssigneeId)) {
      throw new TenantConflictError("Task Lead must be included in assigneeIds");
    }
  }
}

/**
 * Pure domain resolver for task creation assignments.
 * Normalizes input to the canonical representation:
 * - assigneeId is the primary Lead (or null)
 * - assigneeIds is the ordered list of unique execution assignees with Lead first (or [])
 */
export function resolveTaskAssignmentCreation(input: TaskAssignmentMutationInput): TaskAssignmentState {
  const hasAssigneeId = "assigneeId" in input && input.assigneeId !== undefined;
  const hasAssigneeIds = "assigneeIds" in input && input.assigneeIds !== undefined;

  let primaryAssigneeId: string | null = null;
  let finalAssigneeIds: string[] = [];

  if (hasAssigneeId && input.assigneeId !== null && input.assigneeId !== undefined) {
    primaryAssigneeId = input.assigneeId;
    const provided = input.assigneeIds ?? [];
    const others = provided.filter((id): id is string => Boolean(id) && id !== primaryAssigneeId);
    finalAssigneeIds = [input.assigneeId, ...new Set(others)];
  } else if (hasAssigneeId && input.assigneeId === null) {
    if (hasAssigneeIds && input.assigneeIds && input.assigneeIds.length > 0) {
      throw new TenantConflictError("Task cannot have assignees without a Lead");
    }
    primaryAssigneeId = null;
    finalAssigneeIds = [];
  } else if (hasAssigneeIds && input.assigneeIds && input.assigneeIds.length > 0) {
    const uniqueIds = [...new Set(input.assigneeIds.filter((id): id is string => Boolean(id)))];
    if (uniqueIds.length > 0) {
      primaryAssigneeId = uniqueIds[0]!;
      finalAssigneeIds = uniqueIds;
    } else {
      primaryAssigneeId = null;
      finalAssigneeIds = [];
    }
  }

  assertCanonicalTaskAssignment(primaryAssigneeId, finalAssigneeIds);
  return {
    assigneeId: primaryAssigneeId,
    assigneeIds: finalAssigneeIds,
  };
}

/**
 * Pure domain resolver for task update assignments.
 * Takes the current task assignment state and the mutation input,
 * and derives the canonical target state and deltas.
 */
export function resolveTaskAssignmentUpdate(
  current: { assigneeId?: string | null; assigneeIds?: string[] | null },
  input: TaskAssignmentMutationInput,
): ResolvedTaskAssignmentUpdate {
  const hasAssigneeId = "assigneeId" in input && input.assigneeId !== undefined;
  const hasAssigneeIds = "assigneeIds" in input && input.assigneeIds !== undefined;
  const hasAssigneeMutation = hasAssigneeId || hasAssigneeIds;

  const beforeAssigneeIds: string[] =
    current.assigneeIds && current.assigneeIds.length > 0
      ? [...new Set(current.assigneeIds.filter((id): id is string => Boolean(id)))]
      : current.assigneeId
        ? [current.assigneeId]
        : [];
  const beforeAssigneeId: string | null = current.assigneeId ?? beforeAssigneeIds[0] ?? null;

  let finalAssigneeId: string | null = beforeAssigneeId;
  let finalAssigneeIds: string[] = beforeAssigneeIds;

  if (hasAssigneeId && hasAssigneeIds) {
    if (input.assigneeId === null && input.assigneeIds && input.assigneeIds.length > 0) {
      throw new TenantConflictError("Task cannot have assignees without a Lead");
    }
    if (input.assigneeId !== null && input.assigneeId !== undefined) {
      finalAssigneeId = input.assigneeId;
      const others = (input.assigneeIds ?? []).filter((id): id is string => Boolean(id) && id !== finalAssigneeId);
      finalAssigneeIds = [input.assigneeId, ...new Set(others)];
    } else {
      finalAssigneeId = null;
      finalAssigneeIds = [];
    }
  } else if (hasAssigneeId) {
    if (input.assigneeId !== null && input.assigneeId !== undefined) {
      const newLead = input.assigneeId;
      const contributors = beforeAssigneeIds.filter((id) => id !== beforeAssigneeId && id !== newLead);
      finalAssigneeId = newLead;
      finalAssigneeIds = [newLead, ...contributors];
    } else {
      const remaining = beforeAssigneeIds.filter((id) => id !== beforeAssigneeId);
      if (remaining.length > 0) {
        finalAssigneeId = remaining[0]!;
        finalAssigneeIds = remaining;
      } else {
        finalAssigneeId = null;
        finalAssigneeIds = [];
      }
    }
  } else if (hasAssigneeIds) {
    const uniqueIds = [...new Set((input.assigneeIds ?? []).filter((id): id is string => Boolean(id)))];
    if (uniqueIds.length === 0) {
      finalAssigneeId = null;
      finalAssigneeIds = [];
    } else {
      if (beforeAssigneeId && uniqueIds.includes(beforeAssigneeId)) {
        finalAssigneeId = beforeAssigneeId;
        finalAssigneeIds = [beforeAssigneeId, ...uniqueIds.filter((id) => id !== beforeAssigneeId)];
      } else {
        finalAssigneeId = uniqueIds[0]!;
        finalAssigneeIds = uniqueIds;
      }
    }
  }

  assertCanonicalTaskAssignment(finalAssigneeId, finalAssigneeIds);

  const addedAssigneeIds = finalAssigneeIds.filter((id) => !beforeAssigneeIds.includes(id));
  const removedAssigneeIds = beforeAssigneeIds.filter((id) => !finalAssigneeIds.includes(id));
  const primaryChanged = beforeAssigneeId !== finalAssigneeId;
  const changed =
    hasAssigneeMutation && (primaryChanged || addedAssigneeIds.length > 0 || removedAssigneeIds.length > 0);

  return {
    assigneeId: finalAssigneeId,
    assigneeIds: finalAssigneeIds,
    changed,
    addedAssigneeIds,
    removedAssigneeIds,
    primaryChanged,
    hasAssigneeMutation,
  };
}
