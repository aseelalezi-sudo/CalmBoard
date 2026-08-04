import { and, eq, inArray, isNull, or, type SQL } from "drizzle-orm";
import { db } from "../client.js";
import { TenantPermissionDeniedError, TenantResourceNotFoundError } from "../errors.js";
import { memberships, organizations, teams, users, workspaces } from "../schema.js";
import { assertTenantContext, assertWorkspaceTenantContext, type DatabaseTenantContext } from "../tenant-context.js";

export type WorkspaceRecord = typeof workspaces.$inferSelect;
export type CreateWorkspaceInput = Pick<WorkspaceRecord, "name"> &
  Partial<Pick<WorkspaceRecord, "slug" | "color" | "icon" | "description">>;
export type UpdateWorkspaceInput = Partial<Pick<WorkspaceRecord, "name" | "slug" | "color" | "icon" | "description">>;

export function createWorkspaceDirectoryRepository(actorId: string) {
  if (!actorId.trim()) {
    throw new Error("actorId is required for workspace directory access");
  }

  return {
    async listAccessible() {
      const actorMemberships = await db
        .select()
        .from(memberships)
        .where(and(eq(memberships.userId, actorId), eq(memberships.status, "active")));

      const organizationIds = [...new Set(actorMemberships.map((membership) => membership.organizationId))];
      if (!organizationIds.length) {
        return { workspaces: [], organizations: [], users: [], teams: [] };
      }

      const organizationWideIds = [
        ...new Set(
          actorMemberships
            .filter((membership) => membership.workspaceId === null)
            .map((membership) => membership.organizationId),
        ),
      ];
      const explicitWorkspaceIds = [
        ...new Set(actorMemberships.flatMap((membership) => (membership.workspaceId ? [membership.workspaceId] : []))),
      ];

      const workspaceConditions: SQL[] = [];
      if (organizationWideIds.length) {
        workspaceConditions.push(inArray(workspaces.organizationId, organizationWideIds));
      }
      if (explicitWorkspaceIds.length) {
        workspaceConditions.push(inArray(workspaces.id, explicitWorkspaceIds));
      }

      const accessibleWorkspaces = workspaceConditions.length
        ? await db
            .select()
            .from(workspaces)
            .where(
              and(
                isNull(workspaces.deletedAt),
                workspaceConditions.length === 1 ? workspaceConditions[0] : or(...workspaceConditions),
              ),
            )
        : [];
      const accessibleWorkspaceIds = accessibleWorkspaces.map((workspace) => workspace.id);

      const accessibleOrganizations = await db
        .select()
        .from(organizations)
        .where(and(inArray(organizations.id, organizationIds), isNull(organizations.deletedAt)));
      const accessibleTeams = accessibleWorkspaceIds.length
        ? await db
            .select()
            .from(teams)
            .where(and(inArray(teams.workspaceId, accessibleWorkspaceIds), isNull(teams.deletedAt)))
        : [];
      const relatedMemberships = await db
        .select({ userId: memberships.userId })
        .from(memberships)
        .where(
          and(
            inArray(memberships.organizationId, organizationIds),
            eq(memberships.status, "active"),
            accessibleWorkspaceIds.length
              ? or(isNull(memberships.workspaceId), inArray(memberships.workspaceId, accessibleWorkspaceIds))
              : isNull(memberships.workspaceId),
          ),
        );

      const userIds = [...new Set(relatedMemberships.map((membership) => membership.userId))];
      const accessibleUsers = userIds.length
        ? await db
            .select({
              id: users.id,
              name: users.name,
              email: users.email,
              avatarUrl: users.avatarUrl,
              locale: users.locale,
              skills: users.skills,
            })
            .from(users)
            .where(inArray(users.id, userIds))
        : [];

      return {
        workspaces: accessibleWorkspaces,
        organizations: accessibleOrganizations,
        users: accessibleUsers,
        teams: accessibleTeams,
      };
    },
  };
}

export function createOrganizationWorkspacesRepository(context: DatabaseTenantContext) {
  assertTenantContext(context);
  const { organizationId, actorId } = context;

  async function requireWorkspaceManager() {
    if (!actorId) {
      throw new TenantResourceNotFoundError("workspace manager");
    }
    const [membership] = await db
      .select({ id: memberships.id })
      .from(memberships)
      .where(
        and(
          eq(memberships.userId, actorId),
          eq(memberships.organizationId, organizationId),
          eq(memberships.status, "active"),
          inArray(memberships.role, ["owner", "admin"]),
        ),
      )
      .limit(1);
    if (!membership) {
      throw new TenantResourceNotFoundError("workspace manager");
    }
  }

  return {
    async create(input: CreateWorkspaceInput) {
      await requireWorkspaceManager();
      const [workspace] = await db
        .insert(workspaces)
        .values({
          organizationId,
          name: input.name,
          slug: input.slug ?? input.name.toLowerCase().replace(/\s+/g, "-"),
          color: input.color,
          icon: input.icon,
          description: input.description,
        })
        .returning();
      return workspace;
    },
  };
}

export function createWorkspaceRepository(context: DatabaseTenantContext) {
  assertWorkspaceTenantContext(context);
  const { organizationId, workspaceId, actorId } = context;
  const workspaceScope = and(
    eq(workspaces.id, workspaceId),
    eq(workspaces.organizationId, organizationId),
    isNull(workspaces.deletedAt),
  )!;

  async function requireManager() {
    if (!actorId) throw new TenantPermissionDeniedError("actorId is required to update a workspace");
    const [membership] = await db
      .select({ id: memberships.id })
      .from(memberships)
      .where(
        and(
          eq(memberships.userId, actorId),
          eq(memberships.organizationId, organizationId),
          eq(memberships.status, "active"),
          inArray(memberships.role, ["owner", "admin"]),
          or(isNull(memberships.workspaceId), eq(memberships.workspaceId, workspaceId)),
        ),
      )
      .limit(1);
    if (!membership) throw new TenantPermissionDeniedError("workspace updates require owner or admin access");
  }

  return {
    async get() {
      const [workspace] = await db.select().from(workspaces).where(workspaceScope).limit(1);
      if (!workspace) {
        throw new TenantResourceNotFoundError("workspace");
      }
      return workspace;
    },

    async update(input: UpdateWorkspaceInput) {
      await requireManager();
      const [workspace] = await db
        .update(workspaces)
        .set({ ...input, updatedAt: new Date() })
        .where(workspaceScope)
        .returning();
      if (!workspace) {
        throw new TenantResourceNotFoundError("workspace");
      }
      return workspace;
    },
  };
}
