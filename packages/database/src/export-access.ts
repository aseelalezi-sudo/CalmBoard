import { and, eq, inArray } from "drizzle-orm";
import { db, withDatabaseContext } from "./client.js";
import { TenantPermissionDeniedError } from "./errors.js";
import { projects, workspaces } from "./schema.js";
import { assertTenantContext, type DatabaseTenantContext } from "./tenant-context.js";
import { createAuthorizationRepository } from "./repositories/authorization.js";
import { createDocumentsRepository } from "./repositories/documents.js";

// Full archives/reports must not silently include projects hidden from their
// requester or recipient. This also checks historical private projects: ZIP
// portability archives include deleted records, unlike ordinary list endpoints.
export async function assertExportProjectAccess(context: DatabaseTenantContext, requireExportPermission = true) {
  assertTenantContext(context);
  if (!context.actorId) throw new TenantPermissionDeniedError("An export identity is required");
  const actorId = context.actorId;
  return withDatabaseContext(context, async () => {
    const authorization = createAuthorizationRepository();
    const decision = await authorization.resolve(actorId, context, requireExportPermission ? "data.export" : undefined);
    if (!decision.member || (requireExportPermission && !decision.allowed)) {
      throw new TenantPermissionDeniedError("Current export access is required");
    }
    if (requireExportPermission && !context.workspaceId) {
      const organizationWorkspaces = await db
        .select({ id: workspaces.id })
        .from(workspaces)
        .where(eq(workspaces.organizationId, context.organizationId));
      for (const workspace of organizationWorkspaces) {
        const access = await authorization.resolve(
          actorId,
          { organizationId: context.organizationId, workspaceId: workspace.id },
          "data.export",
        );
        if (!access.allowed)
          throw new TenantPermissionDeniedError("Full organization export requires access to every workspace");
      }
    }
    const privateProjects = await db
      .select({ id: projects.id, workspaceId: projects.workspaceId, deletedAt: projects.deletedAt })
      .from(projects)
      .where(
        and(
          eq(projects.organizationId, context.organizationId),
          context.workspaceId ? eq(projects.workspaceId, context.workspaceId) : undefined,
          inArray(projects.privacy, ["private", "private-members"]),
        ),
      );
    for (const project of privateProjects) {
      const access = await authorization.resolve(
        actorId,
        {
          organizationId: context.organizationId,
          workspaceId: project.workspaceId,
          projectId: project.id,
        },
        project.deletedAt ? "projects.view_private" : undefined,
      );
      if (!access.member || (project.deletedAt && !access.allowed)) {
        throw new TenantPermissionDeniedError("Full export requires access to every private project");
      }
    }
    const documentWorkspaces = context.workspaceId
      ? [{ id: context.workspaceId }]
      : await db
          .select({ id: workspaces.id })
          .from(workspaces)
          .where(eq(workspaces.organizationId, context.organizationId));
    for (const workspace of documentWorkspaces) {
      const workspaceContext = { organizationId: context.organizationId, workspaceId: workspace.id, actorId };
      const workspaceAccess = context.workspaceId ? decision : await authorization.resolve(actorId, workspaceContext);
      if (!workspaceAccess.member) throw new TenantPermissionDeniedError("Full export requires workspace access");
      await createDocumentsRepository(workspaceContext, {
        canManageWorkspaceDocuments: workspaceAccess.permissions.includes("documents.manage"),
      }).assertFullExportAccess(requireExportPermission ? "manager" : "viewer");
    }
  });
}
