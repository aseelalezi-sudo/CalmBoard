import { and, eq, isNull } from "drizzle-orm";
import { db } from "./client.js";
import { projects } from "./schema.js";
import { assertWorkspaceTenantContext, type DatabaseTenantContext } from "./tenant-context.js";
import { createAuthorizationRepository } from "./repositories/authorization.js";

// Use the same effective permission/override decision as project-scoped HTTP
// guards. Filter before task pagination, not after returning a page of data.
export async function accessibleProjectIds(context: DatabaseTenantContext, includeDeleted = false) {
  assertWorkspaceTenantContext(context);
  const rows = await db
    .select({ id: projects.id, privacy: projects.privacy, deletedAt: projects.deletedAt })
    .from(projects)
    .where(
      and(
        eq(projects.organizationId, context.organizationId),
        eq(projects.workspaceId, context.workspaceId),
        includeDeleted ? undefined : isNull(projects.deletedAt),
      ),
    );
  const ids: string[] = [];
  const authorization = createAuthorizationRepository();
  for (const project of rows) {
    if (!["private", "private-members"].includes(project.privacy)) ids.push(project.id);
    else if (
      context.actorId &&
      (
        await authorization.resolve(
          context.actorId,
          {
            organizationId: context.organizationId,
            workspaceId: context.workspaceId,
            projectId: project.id,
          },
          project.deletedAt ? "projects.view_private" : undefined,
        )
      )[project.deletedAt ? "allowed" : "member"]
    )
      ids.push(project.id);
  }
  return ids;
}

export async function canAccessProject(context: DatabaseTenantContext, projectId: string, includeDeleted = false) {
  assertWorkspaceTenantContext(context);
  const [project] = await db
    .select({ privacy: projects.privacy, deletedAt: projects.deletedAt })
    .from(projects)
    .where(
      and(
        eq(projects.id, projectId),
        eq(projects.organizationId, context.organizationId),
        eq(projects.workspaceId, context.workspaceId),
        includeDeleted ? undefined : isNull(projects.deletedAt),
      ),
    )
    .limit(1);
  if (!project) return false;
  if (!["private", "private-members"].includes(project.privacy)) return true;
  if (!context.actorId) return false;
  return (
    await createAuthorizationRepository().resolve(
      context.actorId,
      {
        organizationId: context.organizationId,
        workspaceId: context.workspaceId,
        projectId,
      },
      project.deletedAt ? "projects.view_private" : undefined,
    )
  )[project.deletedAt ? "allowed" : "member"];
}
