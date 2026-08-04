import { and, eq, isNull } from "drizzle-orm";
import { db } from "../client.js";
import { TenantResourceNotFoundError } from "../errors.js";
import { projects, projectWipLimits } from "../schema.js";
import { assertWorkspaceTenantContext, type DatabaseTenantContext } from "../tenant-context.js";
import type { TaskStatus } from "./tasks.js";

export function createProjectWorkflowRepository(context: DatabaseTenantContext) {
  assertWorkspaceTenantContext(context);
  const { organizationId, workspaceId } = context;

  async function requireProject(projectId: string) {
    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(
        and(
          eq(projects.id, projectId),
          eq(projects.organizationId, organizationId),
          eq(projects.workspaceId, workspaceId),
          isNull(projects.deletedAt),
        ),
      )
      .limit(1);
    if (!project) throw new TenantResourceNotFoundError("project");
  }

  async function listWipLimits(projectId: string) {
    await requireProject(projectId);
    const rows = await db
      .select({ status: projectWipLimits.status, limit: projectWipLimits.limit })
      .from(projectWipLimits)
      .where(
        and(
          eq(projectWipLimits.organizationId, organizationId),
          eq(projectWipLimits.workspaceId, workspaceId),
          eq(projectWipLimits.projectId, projectId),
        ),
      );
    return Object.fromEntries(rows.map((row) => [row.status, row.limit])) as Partial<Record<TaskStatus, number>>;
  }

  return {
    listWipLimits,

    async setWipLimit(projectId: string, status: TaskStatus, limit: number | null) {
      await requireProject(projectId);
      if (limit === null) {
        await db
          .delete(projectWipLimits)
          .where(
            and(
              eq(projectWipLimits.organizationId, organizationId),
              eq(projectWipLimits.workspaceId, workspaceId),
              eq(projectWipLimits.projectId, projectId),
              eq(projectWipLimits.status, status),
            ),
          );
      } else {
        await db
          .insert(projectWipLimits)
          .values({ organizationId, workspaceId, projectId, status, limit })
          .onConflictDoUpdate({
            target: [projectWipLimits.projectId, projectWipLimits.status],
            set: { limit, updatedAt: new Date() },
          });
      }
      return listWipLimits(projectId);
    },
  };
}
