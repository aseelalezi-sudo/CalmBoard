import { and, eq, inArray, sql, isNull, type AnyColumn } from "drizzle-orm";
import type { DatabaseTenantContext } from "../tenant-context.js";
import {
  sprintAnalyticsEvents,
  sprintSnapshots,
  tasks,
  taskSprintAssignments,
  sprintEventTypeEnum,
  sprintSnapshotTypeEnum,
  sprintDataQualityEnum,
  taskStatusEnum,
} from "../schema.js";

export type SprintEventType = (typeof sprintEventTypeEnum.enumValues)[number];
export type SprintSnapshotType = (typeof sprintSnapshotTypeEnum.enumValues)[number];
export type SprintDataQuality = (typeof sprintDataQualityEnum.enumValues)[number];
export type TaskStatus = (typeof taskStatusEnum.enumValues)[number];

export type SprintMembershipMutationReason =
  "user_assignment" | "sprint_completion" | "sprint_cancellation" | "task_soft_delete";

/**
 * Canonical definition of task completion.
 */
export function isTaskCompletedStatus(status: TaskStatus): boolean {
  return status === "done";
}

export function getCompletedTaskCondition(statusColumn: AnyColumn) {
  return eq(statusColumn, "done");
}

export type TaskAnalyticsState = {
  storyPoints: number | null;
  status: TaskStatus;
};

export type AnalyticsEventPayload = {
  eventType: SprintEventType;
  storyPointsAtEvent: number | null;
  isCompletedAtEvent: boolean;
  oldStoryPoints?: number | null;
  newStoryPoints?: number | null;
  occurredAt?: Date;
};

/**
 * Shared pure domain helper for deriving events deterministically.
 */
export function deriveSprintTaskAnalyticsEvents(
  before: TaskAnalyticsState,
  after: TaskAnalyticsState,
): AnalyticsEventPayload[] {
  const events: AnalyticsEventPayload[] = [];
  const wasCompleted = isTaskCompletedStatus(before.status);
  const isCompleted = isTaskCompletedStatus(after.status);

  // 1. Points change is evaluated under the OLD completion status
  if (before.storyPoints !== after.storyPoints) {
    events.push({
      eventType: "story_points_changed",
      storyPointsAtEvent: after.storyPoints,
      isCompletedAtEvent: wasCompleted,
      oldStoryPoints: before.storyPoints,
      newStoryPoints: after.storyPoints,
    });
  }

  // 2. Status change is evaluated under the NEW points
  if (!wasCompleted && isCompleted) {
    events.push({
      eventType: "task_completed",
      storyPointsAtEvent: after.storyPoints,
      isCompletedAtEvent: true,
    });
  } else if (wasCompleted && !isCompleted) {
    events.push({
      eventType: "task_reopened",
      storyPointsAtEvent: after.storyPoints,
      isCompletedAtEvent: false,
    });
  }

  return events;
}

export type TxContext = {
  db: any; // using any for db transaction to avoid complex drizzle typings
  organizationId: string;
  workspaceId: string;
};

export async function insertSprintSnapshot(
  tx: TxContext,
  params: {
    projectId: string;
    sprintId: string;
    snapshotType: SprintSnapshotType;
    dataQuality: SprintDataQuality;
    scopeTaskCount: number;
    scopeStoryPoints: number;
    completedTaskCount: number;
    completedStoryPoints: number;
    remainingTaskCount: number;
    remainingStoryPoints: number;
    capturedAt?: Date;
  },
) {
  const now = params.capturedAt || new Date();
  await tx.db.insert(sprintSnapshots).values({
    organizationId: tx.organizationId,
    workspaceId: tx.workspaceId,
    projectId: params.projectId,
    sprintId: params.sprintId,
    snapshotType: params.snapshotType,
    dataQuality: params.dataQuality,
    scopeTaskCount: params.scopeTaskCount,
    scopeStoryPoints: params.scopeStoryPoints,
    completedTaskCount: params.completedTaskCount,
    completedStoryPoints: params.completedStoryPoints,
    remainingTaskCount: params.remainingTaskCount,
    remainingStoryPoints: params.remainingStoryPoints,
    capturedAt: now,
    createdAt: now,
  });
}

export async function appendSprintAnalyticsEvent(
  tx: TxContext,
  params: AnalyticsEventPayload & {
    projectId: string;
    sprintId: string;
    taskId: string;
    actorId?: string;
  },
) {
  const now = params.occurredAt || new Date();
  await tx.db.insert(sprintAnalyticsEvents).values({
    organizationId: tx.organizationId,
    workspaceId: tx.workspaceId,
    projectId: params.projectId,
    sprintId: params.sprintId,
    taskId: params.taskId,
    eventType: params.eventType,
    storyPointsAtEvent: params.storyPointsAtEvent ?? null,
    isCompletedAtEvent: params.isCompletedAtEvent,
    oldStoryPoints: params.oldStoryPoints ?? null,
    newStoryPoints: params.newStoryPoints ?? null,
    occurredAt: now,
    createdAt: now,
    actorId: params.actorId,
  });
}

export async function appendSprintAnalyticsEvents(
  tx: TxContext,
  events: (AnalyticsEventPayload & {
    projectId: string;
    sprintId: string;
    taskId: string;
    actorId?: string;
  })[],
) {
  if (events.length === 0) return;
  const now = new Date();
  const values = events.map((e) => ({
    organizationId: tx.organizationId,
    workspaceId: tx.workspaceId,
    projectId: e.projectId,
    sprintId: e.sprintId,
    taskId: e.taskId,
    eventType: e.eventType,
    storyPointsAtEvent: e.storyPointsAtEvent ?? null,
    isCompletedAtEvent: e.isCompletedAtEvent,
    oldStoryPoints: e.oldStoryPoints ?? null,
    newStoryPoints: e.newStoryPoints ?? null,
    occurredAt: e.occurredAt || now,
    createdAt: e.occurredAt || now,
    actorId: e.actorId,
  }));

  // Drizzle supports batch insert. Order is preserved by the query structure,
  // but sequence numbers are allocated in the order they appear in the values list.
  await tx.db.insert(sprintAnalyticsEvents).values(values);
}

/**
 * Validates that all tasks currently asserting sprintId = X also have exactly one open task_sprint_assignment.
 * Used before creating exact snapshots. Throws if inconsistent.
 */
export async function verifySprintMembershipConsistency(tx: TxContext, sprintId: string) {
  // We lock the tasks briefly to ensure consistency
  const activeTasks = await tx.db.execute(sql`
    SELECT t.id,
           (SELECT count(*) FROM task_sprint_assignments tsa
            WHERE tsa.task_id = t.id AND tsa.sprint_id = ${sprintId} AND tsa.removed_at IS NULL AND tsa.organization_id = ${tx.organizationId}) as assignment_count
    FROM tasks t
    WHERE t.sprint_id = ${sprintId} AND t.organization_id = ${tx.organizationId} AND t.deleted_at IS NULL
    FOR SHARE
  `);

  for (const row of activeTasks.rows) {
    if (Number(row.assignment_count) !== 1) {
      throw new Error(
        `Sprint membership inconsistency detected for task ${row.id}: has ${row.assignment_count} open assignments but claims sprint_id = ${sprintId}`,
      );
    }
  }

  // Check the reverse: any open assignment where task doesn't point to this sprint
  const rogueAssignments = await tx.db.execute(sql`
    SELECT tsa.task_id
    FROM task_sprint_assignments tsa
    JOIN tasks t ON tsa.task_id = t.id
    WHERE tsa.sprint_id = ${sprintId}
      AND tsa.removed_at IS NULL
      AND tsa.organization_id = ${tx.organizationId}
      AND (t.sprint_id IS DISTINCT FROM ${sprintId} OR t.deleted_at IS NOT NULL)
  `);

  if (rogueAssignments.rows.length > 0) {
    throw new Error(
      `Sprint membership inconsistency detected: open assignment for task ${rogueAssignments.rows[0].task_id} but task sprint_id does not match or task is deleted`,
    );
  }
}
