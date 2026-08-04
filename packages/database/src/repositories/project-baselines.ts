import { and, asc, count, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../client.js";
import { TenantConflictError, TenantResourceNotFoundError } from "../errors.js";
import { projectBaselines, projectBaselineTasks, projects, tasks } from "../schema.js";
import { assertWorkspaceTenantContext, type DatabaseTenantContext } from "../tenant-context.js";

const MAX_BASELINES_PER_PROJECT = 20;

export function createProjectBaselinesRepository(context: DatabaseTenantContext) {
  assertWorkspaceTenantContext(context);
  const { organizationId, workspaceId, actorId } = context;
  const projectScope = (projectId: string) =>
    and(
      eq(projects.id, projectId),
      eq(projects.organizationId, organizationId),
      eq(projects.workspaceId, workspaceId),
      isNull(projects.deletedAt),
    );

  async function requireProject(projectId: string) {
    const [project] = await db.select({ id: projects.id }).from(projects).where(projectScope(projectId)).limit(1);
    if (!project) throw new TenantResourceNotFoundError("project");
  }

  return {
    async list(projectId: string) {
      await requireProject(projectId);
      const baselines = await db
        .select()
        .from(projectBaselines)
        .where(
          and(
            eq(projectBaselines.organizationId, organizationId),
            eq(projectBaselines.workspaceId, workspaceId),
            eq(projectBaselines.projectId, projectId),
          ),
        )
        .orderBy(desc(projectBaselines.createdAt));
      if (!baselines.length) return [];
      const snapshots = await db
        .select()
        .from(projectBaselineTasks)
        .where(
          and(
            eq(projectBaselineTasks.organizationId, organizationId),
            eq(projectBaselineTasks.workspaceId, workspaceId),
            inArray(
              projectBaselineTasks.baselineId,
              baselines.map((baseline) => baseline.id),
            ),
          ),
        )
        .orderBy(asc(projectBaselineTasks.serial));
      const snapshotsByBaseline = new Map<string, typeof snapshots>();
      for (const snapshot of snapshots) {
        snapshotsByBaseline.set(snapshot.baselineId, [
          ...(snapshotsByBaseline.get(snapshot.baselineId) ?? []),
          snapshot,
        ]);
      }
      return baselines.map((baseline) => ({
        ...baseline,
        tasks: snapshotsByBaseline.get(baseline.id) ?? [],
      }));
    },

    async create(projectId: string, name: string) {
      const normalizedName = name.trim();
      if (!normalizedName || normalizedName.length > 120) {
        throw new TenantConflictError("Baseline name must be between 1 and 120 characters");
      }
      return db.transaction(async (transaction) => {
        const [project] = await transaction
          .select({ id: projects.id })
          .from(projects)
          .where(projectScope(projectId))
          .for("update")
          .limit(1);
        if (!project) throw new TenantResourceNotFoundError("project");
        const [existing] = await transaction
          .select({ value: count() })
          .from(projectBaselines)
          .where(
            and(
              eq(projectBaselines.organizationId, organizationId),
              eq(projectBaselines.workspaceId, workspaceId),
              eq(projectBaselines.projectId, projectId),
            ),
          );
        if ((existing?.value ?? 0) >= MAX_BASELINES_PER_PROJECT) {
          throw new TenantConflictError(`A project can keep at most ${MAX_BASELINES_PER_PROJECT} baselines`);
        }
        const currentTasks = await transaction
          .select({
            id: tasks.id,
            serial: tasks.serial,
            title: tasks.title,
            startDate: tasks.startDate,
            dueDate: tasks.dueDate,
            isMilestone: tasks.isMilestone,
            version: tasks.version,
          })
          .from(tasks)
          .where(
            and(
              eq(tasks.organizationId, organizationId),
              eq(tasks.workspaceId, workspaceId),
              eq(tasks.projectId, projectId),
              isNull(tasks.deletedAt),
            ),
          );
        const [baseline] = await transaction
          .insert(projectBaselines)
          .values({
            organizationId,
            workspaceId,
            projectId,
            name: normalizedName,
            taskCount: currentTasks.length,
            createdBy: actorId ?? null,
          })
          .returning();
        if (currentTasks.length) {
          await transaction.insert(projectBaselineTasks).values(
            currentTasks.map((task) => ({
              organizationId,
              workspaceId,
              projectId,
              baselineId: baseline.id,
              sourceTaskId: task.id,
              serial: task.serial,
              title: task.title,
              startDate: task.startDate,
              dueDate: task.dueDate,
              isMilestone: task.isMilestone,
              taskVersion: task.version,
            })),
          );
        }
        return {
          ...baseline,
          tasks: currentTasks.map((task) => ({
            sourceTaskId: task.id,
            serial: task.serial,
            title: task.title,
            startDate: task.startDate,
            dueDate: task.dueDate,
            isMilestone: task.isMilestone,
            taskVersion: task.version,
          })),
        };
      });
    },

    async delete(baselineId: string, projectId: string) {
      const deleted = await db
        .delete(projectBaselines)
        .where(
          and(
            eq(projectBaselines.id, baselineId),
            eq(projectBaselines.organizationId, organizationId),
            eq(projectBaselines.workspaceId, workspaceId),
            eq(projectBaselines.projectId, projectId),
          ),
        )
        .returning({ id: projectBaselines.id });
      if (!deleted.length) throw new TenantResourceNotFoundError("project baseline");
    },
  };
}
