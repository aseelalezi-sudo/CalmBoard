import { and, desc, eq, isNull, or } from "drizzle-orm";
import { db } from "../client.js";
import { TenantConflictError, TenantPermissionDeniedError, TenantResourceNotFoundError } from "../errors.js";
import { projects, savedViews, workspaces } from "../schema.js";
import { assertWorkspaceTenantContext, type DatabaseTenantContext } from "../tenant-context.js";

export type SavedViewType = "board" | "list" | "table" | "calendar" | "timeline" | "workload";
export type SavedViewFilters = Partial<Record<"search" | "status" | "priority" | "assignee", string>>;
export type SavedViewConfiguration = {
  schemaVersion: 1;
  table?: {
    sorting?: Array<{ id: string; desc: boolean }>;
    columnVisibility?: Record<string, boolean>;
    columnOrder?: string[];
    columnPinning?: { left?: string[]; right?: string[] };
    columnSizing?: Record<string, number>;
  };
};
export type CreateSavedViewInput = {
  projectId: string;
  name: string;
  viewType: SavedViewType;
  filters: SavedViewFilters;
  configuration: SavedViewConfiguration;
  isShared: boolean;
  isDefault: boolean;
};
export type UpdateSavedViewInput = Partial<Omit<CreateSavedViewInput, "projectId" | "viewType">>;

export function createSavedViewsRepository(context: DatabaseTenantContext) {
  assertWorkspaceTenantContext(context);
  const { organizationId, workspaceId, actorId } = context;
  const activeScope = and(
    eq(savedViews.organizationId, organizationId),
    eq(savedViews.workspaceId, workspaceId),
    isNull(savedViews.deletedAt),
  )!;

  function requireActor() {
    if (!actorId) throw new TenantPermissionDeniedError("actorId is required for saved views");
    return actorId;
  }

  async function requireWorkspace() {
    const [workspace] = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(and(eq(workspaces.id, workspaceId), eq(workspaces.organizationId, organizationId)))
      .limit(1);
    if (!workspace) throw new TenantResourceNotFoundError("workspace");
  }

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

  return {
    async list(projectId?: string) {
      const currentActorId = requireActor();
      await requireWorkspace();
      if (projectId) await requireProject(projectId);
      return db
        .select()
        .from(savedViews)
        .where(
          and(
            activeScope,
            or(eq(savedViews.isShared, true), eq(savedViews.createdBy, currentActorId)),
            projectId ? or(eq(savedViews.projectId, projectId), isNull(savedViews.projectId)) : undefined,
          ),
        )
        .orderBy(desc(savedViews.isDefault), desc(savedViews.updatedAt));
    },

    async create(input: CreateSavedViewInput) {
      const currentActorId = requireActor();
      await requireWorkspace();
      await requireProject(input.projectId);
      return db.transaction(async (transaction) => {
        if (input.isDefault) {
          await transaction
            .update(savedViews)
            .set({ isDefault: false, updatedAt: new Date() })
            .where(
              and(
                activeScope,
                eq(savedViews.projectId, input.projectId),
                eq(savedViews.createdBy, currentActorId),
                eq(savedViews.isDefault, true),
              ),
            );
        }
        const [view] = await transaction
          .insert(savedViews)
          .values({ ...input, organizationId, workspaceId, createdBy: currentActorId })
          .returning();
        return view;
      });
    },

    async update(viewId: string, expectedViewType: SavedViewType, input: UpdateSavedViewInput) {
      const currentActorId = requireActor();
      await requireWorkspace();
      return db.transaction(async (transaction) => {
        const [existing] = await transaction
          .select()
          .from(savedViews)
          .where(and(eq(savedViews.id, viewId), activeScope, eq(savedViews.createdBy, currentActorId)))
          .for("update")
          .limit(1);
        if (!existing) throw new TenantResourceNotFoundError("saved view");
        if (existing.viewType !== expectedViewType) {
          throw new TenantConflictError("saved view type does not match the stored view");
        }
        if (input.isDefault) {
          if (!existing.projectId) {
            throw new TenantConflictError("a project-scoped saved view is required to set a default");
          }
          await transaction
            .update(savedViews)
            .set({ isDefault: false, updatedAt: new Date() })
            .where(
              and(
                activeScope,
                eq(savedViews.projectId, existing.projectId),
                eq(savedViews.createdBy, currentActorId),
                eq(savedViews.isDefault, true),
              ),
            );
        }
        const [updated] = await transaction
          .update(savedViews)
          .set({ ...input, updatedAt: new Date() })
          .where(and(eq(savedViews.id, viewId), activeScope, eq(savedViews.createdBy, currentActorId)))
          .returning();
        return updated;
      });
    },

    async delete(viewId: string) {
      const currentActorId = requireActor();
      await requireWorkspace();
      const [view] = await db
        .update(savedViews)
        .set({ isDefault: false, deletedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(savedViews.id, viewId), activeScope, eq(savedViews.createdBy, currentActorId)))
        .returning();
      if (!view) throw new TenantResourceNotFoundError("saved view");
      return view;
    },
  };
}
