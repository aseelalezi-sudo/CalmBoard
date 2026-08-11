import { and, asc, desc, eq, isNull, sql, not } from "drizzle-orm";
import { db } from "../client.js";
import { sprints, taskSprintAssignments, tasks } from "../schema.js";
import { assertWorkspaceTenantContext, type DatabaseTenantContext } from "../tenant-context.js";
import { TenantConflictError } from "../errors.js";

export type SprintRecord = typeof sprints.$inferSelect;
export type SprintStatus = SprintRecord["status"];
export type CreateSprintInput = Omit<
  typeof sprints.$inferInsert,
  "id" | "organizationId" | "workspaceId" | "createdAt" | "updatedAt"
>;
export type UpdateSprintInput = Partial<CreateSprintInput>;

export function createSprintRepository(context: DatabaseTenantContext) {
  return {
    async createSprint(input: CreateSprintInput): Promise<SprintRecord> {
      assertWorkspaceTenantContext(context);
      const [sprint] = await db
        .insert(sprints)
        .values({
          ...input,
          organizationId: context.organizationId,
          workspaceId: context.workspaceId,
        })
        .returning();
      return sprint;
    },

    async getSprint(id: string): Promise<SprintRecord | undefined> {
      assertWorkspaceTenantContext(context);
      const [sprint] = await db
        .select()
        .from(sprints)
        .where(
          and(
            eq(sprints.id, id),
            eq(sprints.organizationId, context.organizationId),
            eq(sprints.workspaceId, context.workspaceId),
            isNull(sprints.deletedAt),
          ),
        );
      return sprint;
    },

    async listSprints(projectId: string): Promise<SprintRecord[]> {
      assertWorkspaceTenantContext(context);
      return db
        .select()
        .from(sprints)
        .where(
          and(
            eq(sprints.organizationId, context.organizationId),
            eq(sprints.workspaceId, context.workspaceId),
            eq(sprints.projectId, projectId),
            isNull(sprints.deletedAt),
          ),
        )
        .orderBy(
          sql`CASE
            WHEN ${sprints.status} = 'active' THEN 1
            WHEN ${sprints.status} = 'planned' THEN 2
            WHEN ${sprints.status} = 'completed' THEN 3
            ELSE 4 END`,
          desc(sprints.createdAt),
        );
    },

    async updateSprint(id: string, input: UpdateSprintInput): Promise<SprintRecord | undefined> {
      assertWorkspaceTenantContext(context);
      const [sprint] = await db
        .update(sprints)
        .set({ ...input, updatedAt: new Date() })
        .where(
          and(
            eq(sprints.id, id),
            eq(sprints.organizationId, context.organizationId),
            eq(sprints.workspaceId, context.workspaceId),
            isNull(sprints.deletedAt),
          ),
        )
        .returning();
      return sprint;
    },

    async startSprint(id: string, projectId: string): Promise<SprintRecord> {
      assertWorkspaceTenantContext(context);
      return await db.transaction(async (tx) => {
        // Lock the sprint
        const [sprint] = await tx
          .select()
          .from(sprints)
          .where(
            and(
              eq(sprints.id, id),
              eq(sprints.organizationId, context.organizationId),
              eq(sprints.workspaceId, context.workspaceId),
              eq(sprints.projectId, projectId),
              isNull(sprints.deletedAt),
            ),
          )
          .for("update");

        if (!sprint) throw new TenantConflictError("Sprint not found");
        if (sprint.status !== "planned") {
          throw new TenantConflictError("Only planned sprints can be started");
        }

        try {
          const { verifySprintMembershipConsistency, insertSprintSnapshot } = await import("./sprint-analytics.js");
          await verifySprintMembershipConsistency(
            { db: tx, organizationId: context.organizationId, workspaceId: context.workspaceId },
            id,
          );

          const statsQuery = await tx.execute(sql`
            SELECT
              COUNT(*) as total_count,
              COALESCE(SUM(story_points), 0) as total_points,
              COUNT(*) FILTER (WHERE status = 'done') as completed_count,
              COALESCE(SUM(story_points) FILTER (WHERE status = 'done'), 0) as completed_points
            FROM ${tasks}
            WHERE sprint_id = ${id} AND deleted_at IS NULL AND organization_id = ${context.organizationId}
          `);
          const stats = statsQuery.rows[0] as any;

          const now = new Date();
          const [updated] = await tx
            .update(sprints)
            .set({ status: "active", startedAt: now, updatedAt: now })
            .where(eq(sprints.id, id))
            .returning();

          await insertSprintSnapshot(
            { db: tx, organizationId: context.organizationId, workspaceId: context.workspaceId },
            {
              projectId,
              sprintId: id,
              snapshotType: "start",
              dataQuality: "exact",
              scopeTaskCount: Number(stats.total_count),
              scopeStoryPoints: Number(stats.total_points),
              completedTaskCount: Number(stats.completed_count),
              completedStoryPoints: Number(stats.completed_points),
              remainingTaskCount: Number(stats.total_count) - Number(stats.completed_count),
              remainingStoryPoints: Number(stats.total_points) - Number(stats.completed_points),
              capturedAt: now,
            },
          );

          return updated;
        } catch (error: any) {
          if (
            error.code === "23505" ||
            error.cause?.code === "23505" ||
            error.message?.includes("sprints_active_unique")
          ) {
            throw new TenantConflictError("There is already an active sprint in this project");
          }
          throw error;
        }
      });
    },

    async completeSprint(
      id: string,
      projectId: string,
      incompleteDestination: { type: "backlog" } | { type: "sprint"; sprintId: string },
    ): Promise<SprintRecord> {
      assertWorkspaceTenantContext(context);
      return await db.transaction(async (tx) => {
        // Lock source sprint
        const [sourceSprint] = await tx
          .select()
          .from(sprints)
          .where(
            and(
              eq(sprints.id, id),
              eq(sprints.organizationId, context.organizationId),
              eq(sprints.workspaceId, context.workspaceId),
              eq(sprints.projectId, projectId),
              isNull(sprints.deletedAt),
            ),
          )
          .for("update");

        if (!sourceSprint) throw new TenantConflictError("Sprint not found");
        if (sourceSprint.status !== "active") {
          throw new TenantConflictError("Only active sprints can be completed");
        }

        let targetSprintId: string | null = null;

        if (incompleteDestination.type === "sprint") {
          targetSprintId = incompleteDestination.sprintId;
          if (targetSprintId === id) throw new TenantConflictError("Cannot move tasks to the same sprint");

          // Verify target sprint
          const [targetSprint] = await tx
            .select()
            .from(sprints)
            .where(
              and(
                eq(sprints.id, targetSprintId),
                eq(sprints.organizationId, context.organizationId),
                eq(sprints.workspaceId, context.workspaceId),
                eq(sprints.projectId, projectId),
                isNull(sprints.deletedAt),
              ),
            );

          if (!targetSprint) throw new TenantConflictError("Destination sprint not found");
          if (targetSprint.status !== "planned") throw new TenantConflictError("Target sprint must be planned");
        }

        const { verifySprintMembershipConsistency, insertSprintSnapshot } = await import("./sprint-analytics.js");
        await verifySprintMembershipConsistency(
          { db: tx, organizationId: context.organizationId, workspaceId: context.workspaceId },
          id,
        );

        const statsQuery = await tx.execute(sql`
          SELECT
            COUNT(*) as total_count,
            COALESCE(SUM(story_points), 0) as total_points,
            COUNT(*) FILTER (WHERE status = 'done') as completed_count,
            COALESCE(SUM(story_points) FILTER (WHERE status = 'done'), 0) as completed_points
          FROM ${tasks}
          WHERE sprint_id = ${id} AND deleted_at IS NULL AND organization_id = ${context.organizationId}
        `);
        const stats = statsQuery.rows[0] as any;
        const now = new Date();

        await insertSprintSnapshot(
          { db: tx, organizationId: context.organizationId, workspaceId: context.workspaceId },
          {
            projectId,
            sprintId: id,
            snapshotType: "complete",
            dataQuality: "exact",
            scopeTaskCount: Number(stats.total_count),
            scopeStoryPoints: Number(stats.total_points),
            completedTaskCount: Number(stats.completed_count),
            completedStoryPoints: Number(stats.completed_points),
            remainingTaskCount: Number(stats.total_count) - Number(stats.completed_count),
            remainingStoryPoints: Number(stats.total_points) - Number(stats.completed_points),
            capturedAt: now,
          },
        );

        // Find unfinished tasks
        const unfinishedTasks = await tx
          .select({ id: tasks.id })
          .from(tasks)
          .where(
            and(
              eq(tasks.sprintId, id),
              not(eq(tasks.status, "done")),
              eq(tasks.organizationId, context.organizationId),
              eq(tasks.workspaceId, context.workspaceId),
              isNull(tasks.deletedAt),
            ),
          );

        for (const task of unfinishedTasks) {
          // Close old assignment
          await tx
            .update(taskSprintAssignments)
            .set({ removedAt: new Date() })
            .where(
              and(
                eq(taskSprintAssignments.taskId, task.id),
                eq(taskSprintAssignments.sprintId, id),
                isNull(taskSprintAssignments.removedAt),
              ),
            );

          if (targetSprintId) {
            // Insert new assignment
            await tx.insert(taskSprintAssignments).values({
              taskId: task.id,
              sprintId: targetSprintId,
              organizationId: context.organizationId,
              workspaceId: context.workspaceId,
              projectId,
              assignedBy: context.actorId,
            });
          }

          // Update task pointer
          await tx.update(tasks).set({ sprintId: targetSprintId, updatedAt: new Date() }).where(eq(tasks.id, task.id));
        }

        const [completedSprint] = await tx
          .update(sprints)
          .set({ status: "completed", completedAt: new Date(), updatedAt: new Date() })
          .where(eq(sprints.id, id))
          .returning();

        return completedSprint;
      });
    },

    async cancelSprint(id: string, projectId: string): Promise<SprintRecord> {
      assertWorkspaceTenantContext(context);
      return await db.transaction(async (tx) => {
        const [sprint] = await tx
          .select()
          .from(sprints)
          .where(
            and(
              eq(sprints.id, id),
              eq(sprints.organizationId, context.organizationId),
              eq(sprints.workspaceId, context.workspaceId),
              eq(sprints.projectId, projectId),
              isNull(sprints.deletedAt),
            ),
          )
          .for("update");

        if (!sprint) throw new TenantConflictError("Sprint not found");
        if (sprint.status === "completed" || sprint.status === "cancelled") {
          throw new TenantConflictError("Cannot cancel this sprint");
        }

        // Close ALL assignments to this sprint, regardless of task status
        await tx
          .update(taskSprintAssignments)
          .set({ removedAt: new Date() })
          .where(and(eq(taskSprintAssignments.sprintId, id), isNull(taskSprintAssignments.removedAt)));

        // Remove all tasks from sprint
        await tx
          .update(tasks)
          .set({ sprintId: null, updatedAt: new Date() })
          .where(
            and(
              eq(tasks.sprintId, id),
              eq(tasks.organizationId, context.organizationId),
              eq(tasks.workspaceId, context.workspaceId),
            ),
          );

        const [cancelledSprint] = await tx
          .update(sprints)
          .set({ status: "cancelled", cancelledAt: new Date(), updatedAt: new Date() })
          .where(eq(sprints.id, id))
          .returning();

        return cancelledSprint;
      });
    },

    async assignTaskToSprint(taskId: string, sprintId: string) {
      assertWorkspaceTenantContext(context);
      await db.transaction(async (tx) => {
        const [task] = await tx
          .select({
            id: tasks.id,
            projectId: tasks.projectId,
            sprintId: tasks.sprintId,
            storyPoints: tasks.storyPoints,
            status: tasks.status,
          })
          .from(tasks)
          .where(
            and(
              eq(tasks.id, taskId),
              eq(tasks.organizationId, context.organizationId),
              eq(tasks.workspaceId, context.workspaceId),
              isNull(tasks.deletedAt),
            ),
          )
          .for("update");

        if (!task) throw new TenantConflictError("Task not found");
        if (task.sprintId === sprintId) return; // Already assigned

        const [sprint] = await tx
          .select({ id: sprints.id, status: sprints.status, projectId: sprints.projectId })
          .from(sprints)
          .where(
            and(
              eq(sprints.id, sprintId),
              eq(sprints.organizationId, context.organizationId),
              eq(sprints.workspaceId, context.workspaceId),
              isNull(sprints.deletedAt),
            ),
          );

        if (!sprint) throw new TenantConflictError("Sprint not found");
        if (sprint.projectId !== task.projectId)
          throw new TenantConflictError("Sprint and task must belong to the same project");
        if (sprint.status === "completed" || sprint.status === "cancelled") {
          throw new TenantConflictError("Cannot assign task to a completed or cancelled sprint");
        }

        // Close previous assignment if exists
        await tx
          .update(taskSprintAssignments)
          .set({ removedAt: new Date() })
          .where(and(eq(taskSprintAssignments.taskId, taskId), isNull(taskSprintAssignments.removedAt)));

        // Create new assignment
        await tx.insert(taskSprintAssignments).values({
          taskId,
          sprintId,
          organizationId: context.organizationId,
          workspaceId: context.workspaceId,
          projectId: task.projectId,
          assignedBy: context.actorId,
        });

        // Update task's sprintId
        await tx.update(tasks).set({ sprintId, updatedAt: new Date() }).where(eq(tasks.id, taskId));

        if (sprint.status === "active") {
          const { appendSprintAnalyticsEvent } = await import("./sprint-analytics.js");
          await appendSprintAnalyticsEvent(
            { db: tx, organizationId: context.organizationId, workspaceId: context.workspaceId },
            {
              projectId: sprint.projectId,
              sprintId: sprint.id,
              taskId: task.id,
              actorId: context.actorId ?? undefined,
              eventType: "task_added",
              storyPointsAtEvent: task.storyPoints ?? null,
              isCompletedAtEvent: task.status === "done",
            },
          );
        }
      });
    },

    async removeTaskFromSprint(taskId: string) {
      assertWorkspaceTenantContext(context);
      await db.transaction(async (tx) => {
        const [task] = await tx
          .select({ id: tasks.id, sprintId: tasks.sprintId })
          .from(tasks)
          .where(
            and(
              eq(tasks.id, taskId),
              eq(tasks.organizationId, context.organizationId),
              eq(tasks.workspaceId, context.workspaceId),
            ),
          )
          .for("update");

        if (!task) throw new TenantConflictError("Task not found");
        if (!task.sprintId) return; // Nothing to remove

        await tx
          .update(taskSprintAssignments)
          .set({ removedAt: new Date() })
          .where(
            and(
              eq(taskSprintAssignments.taskId, taskId),
              eq(taskSprintAssignments.sprintId, task.sprintId),
              isNull(taskSprintAssignments.removedAt),
            ),
          );

        await tx.update(tasks).set({ sprintId: null, updatedAt: new Date() }).where(eq(tasks.id, taskId));

        const [sprint] = await tx
          .select()
          .from(sprints)
          .where(and(eq(sprints.id, task.sprintId), eq(sprints.organizationId, context.organizationId)));
        if (sprint?.status === "active") {
          const { appendSprintAnalyticsEvent } = await import("./sprint-analytics.js");
          const [t] = await tx
            .select({ storyPoints: tasks.storyPoints, status: tasks.status })
            .from(tasks)
            .where(eq(tasks.id, taskId));
          await appendSprintAnalyticsEvent(
            { db: tx, organizationId: context.organizationId, workspaceId: context.workspaceId },
            {
              projectId: sprint.projectId,
              sprintId: sprint.id,
              taskId,
              actorId: context.actorId ?? undefined,
              eventType: "task_removed",
              storyPointsAtEvent: t.storyPoints ?? null,
              isCompletedAtEvent: t.status === "done",
            },
          );
        }
      });
    },

    async moveTaskBetweenSprints(taskId: string, targetSprintId: string | null, expectedFromSprintId?: string | null) {
      assertWorkspaceTenantContext(context);
      await db.transaction(async (tx) => {
        const [task] = await tx
          .select({ id: tasks.id, projectId: tasks.projectId, sprintId: tasks.sprintId })
          .from(tasks)
          .where(
            and(
              eq(tasks.id, taskId),
              eq(tasks.organizationId, context.organizationId),
              eq(tasks.workspaceId, context.workspaceId),
              isNull(tasks.deletedAt),
            ),
          )
          .for("update");

        if (!task) throw new TenantConflictError("Task not found");

        if (expectedFromSprintId !== undefined && task.sprintId !== expectedFromSprintId) {
          throw new TenantConflictError("Optimistic concurrency failure: Task is no longer in the expected sprint");
        }

        if (task.sprintId === targetSprintId) return;

        // Verify target sprint if we are moving to one
        if (targetSprintId) {
          const [sprint] = await tx
            .select({ id: sprints.id, status: sprints.status, projectId: sprints.projectId })
            .from(sprints)
            .where(
              and(
                eq(sprints.id, targetSprintId),
                eq(sprints.organizationId, context.organizationId),
                eq(sprints.workspaceId, context.workspaceId),
                isNull(sprints.deletedAt),
              ),
            );

          if (!sprint) throw new TenantConflictError("Target sprint not found");
          if (sprint.projectId !== task.projectId)
            throw new TenantConflictError("Sprint and task must belong to the same project");
          if (sprint.status === "completed" || sprint.status === "cancelled") {
            throw new TenantConflictError("Cannot assign task to a completed or cancelled sprint");
          }
        }

        // Close previous assignment
        await tx
          .update(taskSprintAssignments)
          .set({ removedAt: new Date() })
          .where(and(eq(taskSprintAssignments.taskId, taskId), isNull(taskSprintAssignments.removedAt)));

        // Open new assignment if target provided
        if (targetSprintId) {
          await tx.insert(taskSprintAssignments).values({
            taskId,
            sprintId: targetSprintId,
            organizationId: context.organizationId,
            workspaceId: context.workspaceId,
            projectId: task.projectId,
            assignedBy: context.actorId,
          });
        }

        await tx.update(tasks).set({ sprintId: targetSprintId, updatedAt: new Date() }).where(eq(tasks.id, taskId));

        const { appendSprintAnalyticsEvent } = await import("./sprint-analytics.js");
        const [t] = await tx
          .select({ storyPoints: tasks.storyPoints, status: tasks.status })
          .from(tasks)
          .where(eq(tasks.id, taskId));

        let sourceSprint;
        if (task.sprintId) {
          [sourceSprint] = await tx
            .select()
            .from(sprints)
            .where(and(eq(sprints.id, task.sprintId), eq(sprints.organizationId, context.organizationId)));
        }
        let targetSprint;
        if (targetSprintId) {
          [targetSprint] = await tx
            .select()
            .from(sprints)
            .where(and(eq(sprints.id, targetSprintId), eq(sprints.organizationId, context.organizationId)));
        }

        if (sourceSprint?.status === "active") {
          await appendSprintAnalyticsEvent(
            { db: tx, organizationId: context.organizationId, workspaceId: context.workspaceId },
            {
              projectId: sourceSprint.projectId,
              sprintId: sourceSprint.id,
              taskId: task.id,
              actorId: context.actorId ?? undefined,
              eventType: "task_removed",
              storyPointsAtEvent: t.storyPoints ?? null,
              isCompletedAtEvent: t.status === "done",
            },
          );
        }
        if (targetSprintId && targetSprint?.status === "active") {
          await appendSprintAnalyticsEvent(
            { db: tx, organizationId: context.organizationId, workspaceId: context.workspaceId },
            {
              projectId: targetSprint.projectId,
              sprintId: targetSprint.id,
              taskId: task.id,
              actorId: context.actorId ?? undefined,
              eventType: "task_added",
              storyPointsAtEvent: t.storyPoints ?? null,
              isCompletedAtEvent: t.status === "done",
            },
          );
        }
      });
    },
  };
}

export type SprintRepository = ReturnType<typeof createSprintRepository>;
