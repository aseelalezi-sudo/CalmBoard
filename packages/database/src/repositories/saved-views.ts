import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "../client.js";
import { TenantConflictError, TenantPermissionDeniedError, TenantResourceNotFoundError } from "../errors.js";
import { projects, savedViews, tasks, workspaces } from "../schema.js";
import { assertWorkspaceTenantContext, type DatabaseTenantContext } from "../tenant-context.js";
import type { CustomFieldFilter } from "../custom-field-query.js";

export type SavedViewType = "board" | "list" | "table" | "calendar" | "timeline" | "workload";

export type SavedViewFilters = Partial<Record<"search" | "status" | "priority" | "assignee" | "assigneeId", string>> & {
  customFields?: CustomFieldFilter[];
};

export type SavedViewTableConfiguration = {
  sorting?: Array<{ id: string; desc: boolean }>;
  columnVisibility?: Record<string, boolean>;
  columnOrder?: string[];
  columnPinning?: { left?: string[]; right?: string[] };
  columnSizing?: Record<string, number>;
  groupBy?: "none" | "status" | "priority" | "custom";
  collapsedGroups?: Record<string, boolean>;
  customGroups?: Array<{ id: string; name: string; color: string; taskIds: string[] }>;
};

export type SavedViewBoardConfiguration = {
  groupBy?: "status" | "priority" | "assignee";
  collapsedColumns?: Record<string, boolean>;
};

export type SavedViewCalendarConfiguration = {
  mode?: "month" | "week" | "day";
};

export type SavedViewTimelineConfiguration = {
  zoom?: "days" | "weeks" | "months";
  showCritical?: boolean;
};

export type SavedViewListConfiguration = {
  sorting?: Array<{ id: string; desc: boolean }>;
  groupBy?: "none" | "status" | "priority";
};

export type SavedViewConfiguration = {
  schemaVersion: 1 | 2;
  table?: SavedViewTableConfiguration;
  board?: SavedViewBoardConfiguration;
  calendar?: SavedViewCalendarConfiguration;
  timeline?: SavedViewTimelineConfiguration;
  list?: SavedViewListConfiguration;
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

export function canonicalizeValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(canonicalizeValue);
  if (typeof value === "object") {
    const sortedKeys = Object.keys(value as Record<string, unknown>).sort();
    const result: Record<string, unknown> = {};
    for (const key of sortedKeys) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) {
        result[key] = canonicalizeValue(v);
      }
    }
    return result;
  }
  return value;
}

export function areCanonicalValuesEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(canonicalizeValue(a)) === JSON.stringify(canonicalizeValue(b));
}

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

  async function pruneCustomGroupTasks(
    config: SavedViewConfiguration,
    targetProjectId?: string | null,
  ): Promise<SavedViewConfiguration> {
    if (!config.table?.customGroups || config.table.customGroups.length === 0) {
      return config;
    }
    const allReferencedTaskIds = [...new Set(config.table.customGroups.flatMap((group) => group.taskIds ?? []))].filter(
      Boolean,
    );

    if (allReferencedTaskIds.length === 0) {
      return config;
    }

    const validTaskRows = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(
        and(
          eq(tasks.organizationId, organizationId),
          eq(tasks.workspaceId, workspaceId),
          targetProjectId ? eq(tasks.projectId, targetProjectId) : undefined,
          isNull(tasks.deletedAt),
          inArray(tasks.id, allReferencedTaskIds),
        ),
      );

    const validSet = new Set(validTaskRows.map((r) => r.id));

    return {
      ...config,
      table: {
        ...config.table,
        customGroups: config.table.customGroups.map((group) => ({
          ...group,
          taskIds: (group.taskIds ?? []).filter((id) => validSet.has(id)),
        })),
      },
    };
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

      const sanitizedConfig = await pruneCustomGroupTasks(input.configuration, input.projectId);

      return db.transaction(async (transaction) => {
        if (input.isDefault) {
          await transaction
            .update(savedViews)
            .set({ isDefault: false, updatedAt: new Date() })
            .where(and(activeScope, eq(savedViews.projectId, input.projectId), eq(savedViews.isDefault, true)));
        }
        const [view] = await transaction
          .insert(savedViews)
          .values({
            ...input,
            configuration: sanitizedConfig,
            organizationId,
            workspaceId,
            createdBy: currentActorId,
          })
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

        const sanitizedConfig =
          input.configuration !== undefined
            ? await pruneCustomGroupTasks(input.configuration, existing.projectId)
            : undefined;

        // Check for canonical no-op
        const nameUnchanged = input.name === undefined || input.name === existing.name;
        const filtersUnchanged =
          input.filters === undefined || areCanonicalValuesEqual(input.filters, existing.filters);
        const configUnchanged =
          sanitizedConfig === undefined || areCanonicalValuesEqual(sanitizedConfig, existing.configuration);
        const sharedUnchanged = input.isShared === undefined || input.isShared === existing.isShared;
        const defaultUnchanged = input.isDefault === undefined || input.isDefault === existing.isDefault;

        if (nameUnchanged && filtersUnchanged && configUnchanged && sharedUnchanged && defaultUnchanged) {
          return existing;
        }

        if (input.isDefault === true && !existing.isDefault) {
          if (!existing.projectId) {
            throw new TenantConflictError("a project-scoped saved view is required to set a default");
          }
          await transaction
            .update(savedViews)
            .set({ isDefault: false, updatedAt: new Date() })
            .where(and(activeScope, eq(savedViews.projectId, existing.projectId), eq(savedViews.isDefault, true)));
        }

        const updates: Record<string, unknown> = { updatedAt: new Date() };
        if (input.name !== undefined) updates.name = input.name;
        if (input.filters !== undefined) updates.filters = input.filters;
        if (sanitizedConfig !== undefined) updates.configuration = sanitizedConfig;
        if (input.isShared !== undefined) updates.isShared = input.isShared;
        if (input.isDefault !== undefined) updates.isDefault = input.isDefault;

        const [updated] = await transaction
          .update(savedViews)
          .set(updates)
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
