import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "../client.js";
import { TenantConflictError, TenantResourceNotFoundError } from "../errors.js";
import { taskDependencies, tasks } from "../schema.js";
import type { DatabaseTenantContext } from "../tenant-context.js";
import { assertWorkspaceTenantContext } from "../tenant-context.js";

export const TASK_DEPENDENCY_TYPES = [
  "finish_to_start",
  "start_to_start",
  "finish_to_finish",
  "start_to_finish",
] as const;

export type TaskDependencyType = (typeof TASK_DEPENDENCY_TYPES)[number];
export const DEFAULT_TASK_DEPENDENCY_TYPE: TaskDependencyType = "finish_to_start";

export const MAX_LAG_MINUTES = 2_147_483_647; // PostgreSQL 32-bit signed integer max
export const MIN_LAG_MINUTES = -2_147_483_648; // PostgreSQL 32-bit signed integer min

export type TaskDependencyRecord = {
  id: string;
  organizationId: string;
  workspaceId: string;
  blockingTaskId: string;
  dependentTaskId: string;
  type: TaskDependencyType;
  lagMinutes: number;
  createdBy: string | null;
  createdAt: Date;
  deletedAt: Date | null;
};

export type TaskDependencyLink = {
  blockingTaskId: string;
  blockingTaskSerial: string;
  type: TaskDependencyType;
  lagMinutes: number;
};

export type TaskOutgoingDependencyLink = {
  dependentTaskId: string;
  dependentTaskSerial: string;
  type: TaskDependencyType;
  lagMinutes: number;
};

export type CanonicalDependencyDescriptor = {
  blockingTaskId: string;
  dependentTaskId: string;
  type: TaskDependencyType;
  lagMinutes: number;
};

export type CreateTaskDependencyInput = {
  blockingTaskId?: string;
  blockingTaskSerial?: string;
  dependentTaskId?: string;
  dependentTaskSerial?: string;
  type?: TaskDependencyType;
  lagMinutes?: number;
};

export type TaskDependencyInputItem =
  | string
  | {
      blockingTaskId?: string;
      blockingTaskSerial?: string;
      type?: TaskDependencyType;
      lagMinutes?: number;
    };

/**
 * Validates that a given type string is one of the 4 canonical dependency types.
 */
export function assertValidTaskDependencyType(type: unknown): asserts type is TaskDependencyType {
  if (typeof type !== "string" || !TASK_DEPENDENCY_TYPES.includes(type as TaskDependencyType)) {
    throw new TenantConflictError(
      `Invalid task dependency type '${String(type)}'. Allowed types: ${TASK_DEPENDENCY_TYPES.join(", ")}`,
    );
  }
}

/**
 * Validates and normalizes lag minutes to a safe 32-bit signed integer.
 */
export function assertValidLagMinutes(lagMinutes: unknown): number {
  if (lagMinutes === undefined || lagMinutes === null) {
    return 0;
  }
  if (typeof lagMinutes !== "number" || !Number.isFinite(lagMinutes) || !Number.isInteger(lagMinutes)) {
    throw new TenantConflictError("Task dependency lagMinutes must be a valid finite integer");
  }
  if (lagMinutes < MIN_LAG_MINUTES || lagMinutes > MAX_LAG_MINUTES) {
    throw new TenantConflictError(
      `Task dependency lagMinutes must be between ${MIN_LAG_MINUTES} and ${MAX_LAG_MINUTES}`,
    );
  }
  return lagMinutes;
}

/**
 * Asserts that a task does not depend on itself.
 */
export function assertNotSelfDependency(blockingTaskId: string, dependentTaskId: string): void {
  if (blockingTaskId && dependentTaskId && blockingTaskId === dependentTaskId) {
    throw new TenantConflictError("A task cannot depend on itself");
  }
}

/**
 * Formats a canonical identity key for a dependency relationship.
 * Two dependencies are identical if and only if all four values match.
 */
export function canonicalDependencyKey(dep: {
  blockingTaskId: string;
  dependentTaskId: string;
  type?: string;
  lagMinutes?: number;
}): string {
  const type = dep.type ?? DEFAULT_TASK_DEPENDENCY_TYPE;
  const lag = dep.lagMinutes ?? 0;
  return `${dep.blockingTaskId}:${dep.dependentTaskId}:${type}:${lag}`;
}

/**
 * Pure graph cycle detection using 3-state DFS traversal.
 * Graph vertices are task IDs, directed edges go from blockingTaskId (predecessor) -> dependentTaskId (successor).
 */
export function detectDependencyCycle(edges: Array<{ blockingTaskId: string; dependentTaskId: string }>): {
  hasCycle: boolean;
  cyclePath?: string[];
} {
  const adjacency = new Map<string, string[]>();
  const nodes = new Set<string>();

  for (const edge of edges) {
    if (edge.blockingTaskId === edge.dependentTaskId) {
      return { hasCycle: true, cyclePath: [edge.blockingTaskId, edge.dependentTaskId] };
    }
    nodes.add(edge.blockingTaskId);
    nodes.add(edge.dependentTaskId);
    const list = adjacency.get(edge.blockingTaskId) ?? [];
    list.push(edge.dependentTaskId);
    adjacency.set(edge.blockingTaskId, list);
  }

  // 0: Unvisited, 1: Visiting (in current recursion stack), 2: Visited (fully explored, no cycles)
  const state = new Map<string, number>();
  const parent = new Map<string, string>();
  const stack: string[] = [];

  function dfs(current: string): string[] | null {
    state.set(current, 1);
    stack.push(current);

    const neighbors = adjacency.get(current) ?? [];
    for (const neighbor of neighbors) {
      const neighborState = state.get(neighbor) ?? 0;
      if (neighborState === 1) {
        // Cycle detected: neighbor is in the current recursion stack
        const cycleStartIndex = stack.indexOf(neighbor);
        const cycle = stack.slice(cycleStartIndex);
        cycle.push(neighbor);
        return cycle;
      }
      if (neighborState === 0) {
        parent.set(neighbor, current);
        const cycle = dfs(neighbor);
        if (cycle) return cycle;
      }
    }

    stack.pop();
    state.set(current, 2);
    return null;
  }

  for (const node of nodes) {
    if ((state.get(node) ?? 0) === 0) {
      const cycle = dfs(node);
      if (cycle) {
        return { hasCycle: true, cyclePath: cycle };
      }
    }
  }

  return { hasCycle: false };
}

/**
 * Asserts that the provided dependency edges form a Directed Acyclic Graph (DAG).
 * Throws TenantConflictError if any cycle is detected.
 */
export function assertNoDependencyCycle(edges: Array<{ blockingTaskId: string; dependentTaskId: string }>): void {
  const result = detectDependencyCycle(edges);
  if (result.hasCycle) {
    throw new TenantConflictError("Task dependency would create a cycle");
  }
}

type TaskDependenciesDatabase = Pick<typeof db, "select" | "insert" | "update">;

export function createTaskDependenciesRepository(
  context: DatabaseTenantContext,
  dbOrTx: TaskDependenciesDatabase = db,
) {
  assertWorkspaceTenantContext(context);
  const { organizationId, workspaceId } = context;

  const tenantScope = and(
    eq(taskDependencies.organizationId, organizationId),
    eq(taskDependencies.workspaceId, workspaceId),
  );

  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  async function resolveTaskEndpoint(identifier: string): Promise<{ id: string; serial: string; projectId: string }> {
    const trimmed = identifier.trim();
    if (!trimmed) {
      throw new TenantResourceNotFoundError("task dependency");
    }

    const isUuid = UUID_REGEX.test(trimmed);
    const [task] = await dbOrTx
      .select({ id: tasks.id, serial: tasks.serial, projectId: tasks.projectId })
      .from(tasks)
      .where(
        and(
          eq(tasks.organizationId, organizationId),
          eq(tasks.workspaceId, workspaceId),
          isUuid ? eq(tasks.id, trimmed) : eq(tasks.serial, trimmed),
          isNull(tasks.deletedAt),
        ),
      )
      .limit(1);

    if (!task) {
      throw new TenantResourceNotFoundError("task dependency");
    }

    return task;
  }

  async function listActiveWorkspaceEdges(
    excludeDependencyId?: string,
  ): Promise<Array<{ id: string; blockingTaskId: string; dependentTaskId: string }>> {
    const rows = await dbOrTx
      .select({
        id: taskDependencies.id,
        blockingTaskId: taskDependencies.blockingTaskId,
        dependentTaskId: taskDependencies.dependentTaskId,
      })
      .from(taskDependencies)
      .where(
        and(
          tenantScope,
          isNull(taskDependencies.deletedAt),
          excludeDependencyId ? sql`${taskDependencies.id} <> ${excludeDependencyId}::uuid` : undefined,
        ),
      );

    return rows;
  }

  return {
    /**
     * Resolves and validates an array of dependency inputs (serials or ID descriptors).
     * Ensures all endpoints exist, belong to tenant/workspace, are active, and have valid types and lag.
     */
    async validateTaskDependenciesInput(
      dependentTaskId: string | null,
      dependenciesInput: unknown,
    ): Promise<
      Array<{
        blockingTaskId: string;
        blockingTaskSerial: string;
        type: TaskDependencyType;
        lagMinutes: number;
      }>
    > {
      if (!dependenciesInput) return [];
      if (!Array.isArray(dependenciesInput)) {
        throw new TenantConflictError("Task dependencies must be an array");
      }

      const items: Array<{
        identifier: string;
        type: TaskDependencyType;
        lagMinutes: number;
      }> = [];

      for (const item of dependenciesInput) {
        if (typeof item === "string") {
          const trimmed = item.trim();
          if (trimmed) {
            items.push({
              identifier: trimmed,
              type: DEFAULT_TASK_DEPENDENCY_TYPE,
              lagMinutes: 0,
            });
          }
        } else if (item && typeof item === "object") {
          const rawObj = item as Record<string, unknown>;
          const identifier =
            typeof rawObj.blockingTaskId === "string" && rawObj.blockingTaskId.trim()
              ? rawObj.blockingTaskId.trim()
              : typeof rawObj.blockingTaskSerial === "string" && rawObj.blockingTaskSerial.trim()
                ? rawObj.blockingTaskSerial.trim()
                : undefined;

          if (!identifier) {
            throw new TenantConflictError("Task dependency requires a valid blockingTaskId or blockingTaskSerial");
          }

          const type = rawObj.type !== undefined ? rawObj.type : DEFAULT_TASK_DEPENDENCY_TYPE;
          assertValidTaskDependencyType(type);
          const lagMinutes = assertValidLagMinutes(rawObj.lagMinutes);

          items.push({
            identifier,
            type,
            lagMinutes,
          });
        } else {
          throw new TenantConflictError("Invalid task dependency item format");
        }
      }

      if (items.length === 0) return [];

      const uniqueIdentifiers = [...new Set(items.map((it) => it.identifier))];
      const uuidIdentifiers = uniqueIdentifiers.filter((id) => UUID_REGEX.test(id));
      const serialIdentifiers = uniqueIdentifiers.filter((id) => !UUID_REGEX.test(id));

      const matchConditions = [];
      if (uuidIdentifiers.length > 0) {
        matchConditions.push(inArray(tasks.id, uuidIdentifiers));
      }
      if (serialIdentifiers.length > 0) {
        matchConditions.push(inArray(tasks.serial, serialIdentifiers));
      }

      const taskRows = await dbOrTx
        .select({ id: tasks.id, serial: tasks.serial, projectId: tasks.projectId })
        .from(tasks)
        .where(
          and(
            eq(tasks.organizationId, organizationId),
            eq(tasks.workspaceId, workspaceId),
            matchConditions.length === 1 ? matchConditions[0]! : or(...matchConditions),
            isNull(tasks.deletedAt),
          ),
        );

      const taskByIdentifier = new Map<string, { id: string; serial: string; projectId: string }>();
      for (const row of taskRows) {
        taskByIdentifier.set(row.id, row);
        taskByIdentifier.set(row.serial, row);
      }

      // Ensure every identifier resolved to an active task in the tenant workspace
      for (const ident of uniqueIdentifiers) {
        if (!taskByIdentifier.has(ident)) {
          throw new TenantResourceNotFoundError("task dependency");
        }
      }

      const result: Array<{
        blockingTaskId: string;
        blockingTaskSerial: string;
        type: TaskDependencyType;
        lagMinutes: number;
      }> = [];

      const seenKeys = new Set<string>();

      for (const item of items) {
        const resolved = taskByIdentifier.get(item.identifier)!;
        if (dependentTaskId && resolved.id === dependentTaskId) {
          throw new TenantConflictError("A task cannot depend on itself");
        }

        const key = `${resolved.id}:${item.type}:${item.lagMinutes}`;
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          result.push({
            blockingTaskId: resolved.id,
            blockingTaskSerial: resolved.serial,
            type: item.type,
            lagMinutes: item.lagMinutes,
          });
        }
      }

      return result;
    },

    /**
     * Creates a single task dependency with complete domain, tenant, and cycle validation.
     * If an identical dependency already exists, returns the existing record (idempotent).
     */
    async create(input: CreateTaskDependencyInput, actorId?: string | null): Promise<TaskDependencyRecord> {
      const blockingIdent = input.blockingTaskId ?? input.blockingTaskSerial;
      const dependentIdent = input.dependentTaskId ?? input.dependentTaskSerial;

      if (!blockingIdent || !dependentIdent) {
        throw new TenantConflictError("Both blockingTaskId and dependentTaskId must be provided");
      }

      const blockingTask = await resolveTaskEndpoint(blockingIdent);
      const dependentTask = await resolveTaskEndpoint(dependentIdent);

      assertNotSelfDependency(blockingTask.id, dependentTask.id);

      const type = input.type ?? DEFAULT_TASK_DEPENDENCY_TYPE;
      assertValidTaskDependencyType(type);
      const lagMinutes = assertValidLagMinutes(input.lagMinutes);

      // Check if an identical active dependency already exists
      const [existing] = await dbOrTx
        .select()
        .from(taskDependencies)
        .where(
          and(
            tenantScope,
            eq(taskDependencies.blockingTaskId, blockingTask.id),
            eq(taskDependencies.dependentTaskId, dependentTask.id),
            eq(taskDependencies.type, type),
            isNull(taskDependencies.deletedAt),
          ),
        )
        .limit(1);

      if (existing) {
        if (existing.lagMinutes === lagMinutes) {
          return existing as TaskDependencyRecord;
        }
        // If same endpoints and type exist with different lagMinutes, update it
        const [updated] = await dbOrTx
          .update(taskDependencies)
          .set({ lagMinutes })
          .where(eq(taskDependencies.id, existing.id))
          .returning();
        return updated as TaskDependencyRecord;
      }

      // Graph cycle validation: load all active edges in workspace and verify DAG property
      const activeEdges = await listActiveWorkspaceEdges();
      assertNoDependencyCycle([...activeEdges, { blockingTaskId: blockingTask.id, dependentTaskId: dependentTask.id }]);

      try {
        const [created] = await dbOrTx
          .insert(taskDependencies)
          .values({
            organizationId,
            workspaceId,
            blockingTaskId: blockingTask.id,
            dependentTaskId: dependentTask.id,
            type,
            lagMinutes,
            createdBy: actorId ?? null,
          })
          .returning();

        return created as TaskDependencyRecord;
      } catch (error) {
        const causeMessage = (error as { cause?: { message?: string } })?.cause?.message;
        if (causeMessage === "Task dependency would create a cycle") {
          throw new TenantConflictError(causeMessage);
        }
        throw error;
      }
    },

    /**
     * Loads a dependency by ID, strictly enforcing organization and workspace scoping.
     */
    async getById(id: string): Promise<TaskDependencyRecord> {
      const [record] = await dbOrTx
        .select()
        .from(taskDependencies)
        .where(and(eq(taskDependencies.id, id), tenantScope, isNull(taskDependencies.deletedAt)))
        .limit(1);

      if (!record) {
        throw new TenantResourceNotFoundError("task dependency");
      }

      return record as TaskDependencyRecord;
    },

    /**
     * Lists incoming (blocking) and outgoing (dependent) dependencies for a given task.
     */
    async listByTaskId(taskId: string): Promise<{
      incoming: TaskDependencyLink[];
      outgoing: TaskOutgoingDependencyLink[];
    }> {
      const incomingRows = await dbOrTx
        .select({
          blockingTaskId: taskDependencies.blockingTaskId,
          blockingTaskSerial: tasks.serial,
          type: taskDependencies.type,
          lagMinutes: taskDependencies.lagMinutes,
        })
        .from(taskDependencies)
        .innerJoin(
          tasks,
          and(
            eq(tasks.id, taskDependencies.blockingTaskId),
            eq(tasks.organizationId, organizationId),
            eq(tasks.workspaceId, workspaceId),
            isNull(tasks.deletedAt),
          ),
        )
        .where(and(tenantScope, eq(taskDependencies.dependentTaskId, taskId), isNull(taskDependencies.deletedAt)))
        .orderBy(asc(taskDependencies.createdAt), asc(taskDependencies.id));

      const outgoingRows = await dbOrTx
        .select({
          dependentTaskId: taskDependencies.dependentTaskId,
          dependentTaskSerial: tasks.serial,
          type: taskDependencies.type,
          lagMinutes: taskDependencies.lagMinutes,
        })
        .from(taskDependencies)
        .innerJoin(
          tasks,
          and(
            eq(tasks.id, taskDependencies.dependentTaskId),
            eq(tasks.organizationId, organizationId),
            eq(tasks.workspaceId, workspaceId),
            isNull(tasks.deletedAt),
          ),
        )
        .where(and(tenantScope, eq(taskDependencies.blockingTaskId, taskId), isNull(taskDependencies.deletedAt)))
        .orderBy(asc(taskDependencies.createdAt), asc(taskDependencies.id));

      return {
        incoming: incomingRows,
        outgoing: outgoingRows,
      };
    },

    /**
     * Lists all active dependencies in the workspace.
     */
    async listWorkspaceDependencies(): Promise<TaskDependencyRecord[]> {
      const rows = await dbOrTx
        .select()
        .from(taskDependencies)
        .where(and(tenantScope, isNull(taskDependencies.deletedAt)))
        .orderBy(asc(taskDependencies.createdAt), asc(taskDependencies.id));

      return rows as TaskDependencyRecord[];
    },

    /**
     * Soft-deletes a dependency by ID. Idempotent: returns true if deleted, false if not found.
     */
    async delete(id: string): Promise<boolean> {
      const [updated] = await dbOrTx
        .update(taskDependencies)
        .set({ deletedAt: new Date() })
        .where(and(eq(taskDependencies.id, id), tenantScope, isNull(taskDependencies.deletedAt)))
        .returning({ id: taskDependencies.id });

      return Boolean(updated);
    },

    /**
     * Soft-deletes dependencies matching the specified endpoint pair and optional type.
     */
    async deleteByEndpoints(
      blockingTaskId: string,
      dependentTaskId: string,
      type?: TaskDependencyType,
    ): Promise<boolean> {
      const conditions = [
        tenantScope,
        eq(taskDependencies.blockingTaskId, blockingTaskId),
        eq(taskDependencies.dependentTaskId, dependentTaskId),
        isNull(taskDependencies.deletedAt),
      ];

      if (type) {
        conditions.push(eq(taskDependencies.type, type));
      }

      const updated = await dbOrTx
        .update(taskDependencies)
        .set({ deletedAt: new Date() })
        .where(and(...conditions))
        .returning({ id: taskDependencies.id });

      return updated.length > 0;
    },

    /**
     * Atomically replaces the full dependency set for a dependent task.
     * Computes the exact diff and only performs database writes if there is a real change.
     */
    async replaceTaskDependencies(
      dependentTaskId: string,
      desiredItems: Array<{
        blockingTaskId: string;
        blockingTaskSerial?: string;
        type: TaskDependencyType;
        lagMinutes: number;
      }>,
      actorId?: string | null,
    ): Promise<{
      changed: boolean;
      activeDependencies: TaskDependencyRecord[];
    }> {
      // 1. Load current active dependencies for the dependent task
      const currentActive = (await dbOrTx
        .select()
        .from(taskDependencies)
        .where(
          and(tenantScope, eq(taskDependencies.dependentTaskId, dependentTaskId), isNull(taskDependencies.deletedAt)),
        )
        .orderBy(asc(taskDependencies.createdAt), asc(taskDependencies.id))) as TaskDependencyRecord[];

      // 2. Canonicalize and sort keys to check for true no-op
      const currentKeyMap = new Map<string, TaskDependencyRecord>();
      for (const curr of currentActive) {
        currentKeyMap.set(canonicalDependencyKey(curr), curr);
      }

      const desiredKeyMap = new Map<
        string,
        {
          blockingTaskId: string;
          dependentTaskId: string;
          type: TaskDependencyType;
          lagMinutes: number;
        }
      >();

      for (const item of desiredItems) {
        assertNotSelfDependency(item.blockingTaskId, dependentTaskId);
        assertValidTaskDependencyType(item.type);
        assertValidLagMinutes(item.lagMinutes);

        const descriptor = {
          blockingTaskId: item.blockingTaskId,
          dependentTaskId,
          type: item.type,
          lagMinutes: item.lagMinutes,
        };
        desiredKeyMap.set(canonicalDependencyKey(descriptor), descriptor);
      }

      // Check if current keys and desired keys are identical
      const currentKeys = [...currentKeyMap.keys()].sort();
      const desiredKeys = [...desiredKeyMap.keys()].sort();

      const isNoOp =
        currentKeys.length === desiredKeys.length && currentKeys.every((key, idx) => key === desiredKeys[idx]);

      if (isNoOp) {
        return {
          changed: false,
          activeDependencies: currentActive,
        };
      }

      // 3. Cycle detection on the proposed graph
      // Proposed graph = all active workspace edges MINUS currentActive of this task PLUS desired items
      const allActiveWorkspace = await listActiveWorkspaceEdges();
      const currentIdsToExclude = new Set(currentActive.map((d) => d.id));
      const retainedWorkspaceEdges = allActiveWorkspace.filter((e) => !currentIdsToExclude.has(e.id));
      const proposedNewEdges = [...desiredKeyMap.values()].map((d) => ({
        blockingTaskId: d.blockingTaskId,
        dependentTaskId: d.dependentTaskId,
      }));

      assertNoDependencyCycle([...retainedWorkspaceEdges, ...proposedNewEdges]);

      // 4. Calculate diff: keys to remove, keys to retain, keys to insert
      const toRemove: TaskDependencyRecord[] = [];
      for (const [key, curr] of currentKeyMap.entries()) {
        if (!desiredKeyMap.has(key)) {
          toRemove.push(curr);
        }
      }

      const toInsert: Array<{
        blockingTaskId: string;
        dependentTaskId: string;
        type: TaskDependencyType;
        lagMinutes: number;
      }> = [];

      for (const [key, desired] of desiredKeyMap.entries()) {
        if (!currentKeyMap.has(key)) {
          toInsert.push(desired);
        }
      }

      const now = new Date();

      if (toRemove.length > 0) {
        await dbOrTx
          .update(taskDependencies)
          .set({ deletedAt: now })
          .where(
            and(
              tenantScope,
              inArray(
                taskDependencies.id,
                toRemove.map((r) => r.id),
              ),
            ),
          );
      }

      let insertedRecords: TaskDependencyRecord[] = [];
      if (toInsert.length > 0) {
        try {
          insertedRecords = (await dbOrTx
            .insert(taskDependencies)
            .values(
              toInsert.map((item) => ({
                organizationId,
                workspaceId,
                blockingTaskId: item.blockingTaskId,
                dependentTaskId: item.dependentTaskId,
                type: item.type,
                lagMinutes: item.lagMinutes,
                createdBy: actorId ?? null,
              })),
            )
            .returning()) as TaskDependencyRecord[];
        } catch (error) {
          const causeMessage = (error as { cause?: { message?: string } })?.cause?.message;
          if (causeMessage === "Task dependency would create a cycle") {
            throw new TenantConflictError(causeMessage);
          }
          throw error;
        }
      }

      const retainedRecords = currentActive.filter((c) => !toRemove.some((r) => r.id === c.id));
      const finalActive = [...retainedRecords, ...insertedRecords];

      return {
        changed: true,
        activeDependencies: finalActive,
      };
    },
  };
}
