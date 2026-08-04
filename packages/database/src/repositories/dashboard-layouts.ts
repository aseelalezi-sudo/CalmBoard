import { and, eq, or, isNull } from "drizzle-orm";
import { db } from "../client.js";
import { TenantConflictError, TenantPermissionDeniedError, TenantResourceNotFoundError } from "../errors.js";
import { dashboardLayouts, memberships, workspaces, type DashboardWidgetDefinition } from "../schema.js";
import { assertWorkspaceTenantContext, type DatabaseTenantContext } from "../tenant-context.js";

export type { DashboardWidgetDefinition, DashboardWidgetId, DashboardWidgetWidth } from "../schema.js";

export const defaultDashboardWidgets: DashboardWidgetDefinition[] = [
  { id: "total_tasks", width: "small" },
  { id: "completed_tasks", width: "small" },
  { id: "in_progress_tasks", width: "small" },
  { id: "overdue_tasks", width: "small" },
  { id: "status_chart", width: "wide" },
  { id: "project_completion", width: "medium" },
  {
    id: "custom_chart",
    width: "full",
    settings: { chartType: "bar", groupBy: "priority", metric: "count" },
  },
  { id: "goals", width: "medium" },
  { id: "team_distribution", width: "medium" },
  { id: "time_logged", width: "medium" },
  { id: "activity", width: "full" },
];

export function createDashboardLayoutsRepository(context: DatabaseTenantContext) {
  assertWorkspaceTenantContext(context);
  const { organizationId, workspaceId } = context;
  if (!context.actorId) {
    throw new TenantPermissionDeniedError("actorId is required to manage a dashboard layout");
  }
  const actorId = context.actorId;

  async function requireScope() {
    const [membership] = await db
      .select({ id: memberships.id })
      .from(memberships)
      .innerJoin(workspaces, and(eq(workspaces.id, workspaceId), eq(workspaces.organizationId, organizationId)))
      .where(
        and(
          eq(memberships.userId, actorId),
          eq(memberships.organizationId, organizationId),
          eq(memberships.status, "active"),
          or(isNull(memberships.workspaceId), eq(memberships.workspaceId, workspaceId)),
        ),
      )
      .limit(1);
    if (!membership) throw new TenantResourceNotFoundError("dashboard layout");
  }

  async function current() {
    const [layout] = await db
      .select()
      .from(dashboardLayouts)
      .where(
        and(
          eq(dashboardLayouts.organizationId, organizationId),
          eq(dashboardLayouts.workspaceId, workspaceId),
          eq(dashboardLayouts.userId, actorId),
        ),
      )
      .limit(1);
    return layout;
  }

  return {
    async get() {
      await requireScope();
      const layout = await current();
      return (
        layout ?? {
          id: null,
          organizationId,
          workspaceId,
          userId: actorId,
          widgets: defaultDashboardWidgets,
          version: 0,
          createdAt: null,
          updatedAt: null,
        }
      );
    },

    async update(widgets: DashboardWidgetDefinition[], expectedVersion: number) {
      await requireScope();
      return db.transaction(async (transaction) => {
        const [existing] = await transaction
          .select()
          .from(dashboardLayouts)
          .where(
            and(
              eq(dashboardLayouts.organizationId, organizationId),
              eq(dashboardLayouts.workspaceId, workspaceId),
              eq(dashboardLayouts.userId, actorId),
            ),
          )
          .for("update")
          .limit(1);

        if (!existing) {
          if (expectedVersion !== 0) throw new TenantConflictError("Dashboard layout version is stale");
          const [created] = await transaction
            .insert(dashboardLayouts)
            .values({ organizationId, workspaceId, userId: actorId, widgets, version: 1 })
            .returning();
          return created;
        }
        if (existing.version !== expectedVersion) {
          throw new TenantConflictError("Dashboard layout version is stale");
        }
        const [updated] = await transaction
          .update(dashboardLayouts)
          .set({ widgets, version: existing.version + 1, updatedAt: new Date() })
          .where(and(eq(dashboardLayouts.id, existing.id), eq(dashboardLayouts.version, expectedVersion)))
          .returning();
        if (!updated) throw new TenantConflictError("Dashboard layout version is stale");
        return updated;
      });
    },
  };
}
