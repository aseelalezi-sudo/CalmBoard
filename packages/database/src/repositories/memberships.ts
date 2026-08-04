import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "../client.js";
import { TenantConflictError, TenantPermissionDeniedError, TenantResourceNotFoundError } from "../errors.js";
import { invitations, memberships, teams, users, workspaces } from "../schema.js";
import { assertWorkspaceTenantContext, type DatabaseTenantContext } from "../tenant-context.js";
import { createNotificationsRepository } from "./notifications.js";

export type MembershipRecord = typeof memberships.$inferSelect;
export type MembershipRole = MembershipRecord["role"];

export type InviteMemberInput = {
  email: string;
  role?: MembershipRole;
};

const managerRoles = new Set<MembershipRole>(["owner", "admin"]);

export function createMembershipsRepository(context: DatabaseTenantContext) {
  assertWorkspaceTenantContext(context);
  const { organizationId, workspaceId, actorId } = context;
  const visibleMembershipScope = and(
    eq(memberships.organizationId, organizationId),
    eq(memberships.status, "active"),
    or(isNull(memberships.workspaceId), eq(memberships.workspaceId, workspaceId)),
  )!;

  async function requireActorMembership() {
    if (!actorId) {
      throw new TenantPermissionDeniedError("actorId is required for membership access");
    }

    const [membership] = await db
      .select()
      .from(memberships)
      .where(and(eq(memberships.userId, actorId), visibleMembershipScope))
      .limit(1);
    if (!membership) {
      throw new TenantPermissionDeniedError();
    }
    return membership;
  }

  async function requireManager() {
    const actorMembership = await requireActorMembership();
    if (!managerRoles.has(actorMembership.role)) {
      throw new TenantPermissionDeniedError("membership management requires owner or admin");
    }
    return actorMembership;
  }

  async function requireWorkspace() {
    const [workspace] = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(and(eq(workspaces.id, workspaceId), eq(workspaces.organizationId, organizationId)))
      .limit(1);
    if (!workspace) {
      throw new TenantResourceNotFoundError("workspace");
    }
  }

  return {
    async list() {
      const actorMembership = await requireActorMembership();

      const memberRows = await db
        .select()
        .from(memberships)
        .where(visibleMembershipScope)
        .orderBy(desc(memberships.joinedAt));
      const userIds = [...new Set(memberRows.map((membership) => membership.userId))];
      const teamIds = [...new Set(memberRows.flatMap((membership) => (membership.teamId ? [membership.teamId] : [])))];

      const memberUsers = userIds.length ? await db.select().from(users).where(inArray(users.id, userIds)) : [];
      const memberTeams = teamIds.length
        ? await db
            .select()
            .from(teams)
            .where(and(inArray(teams.id, teamIds), eq(teams.workspaceId, workspaceId)))
        : [];
      const pendingInvitations = managerRoles.has(actorMembership.role)
        ? await db
            .select()
            .from(invitations)
            .where(
              and(
                eq(invitations.organizationId, organizationId),
                or(isNull(invitations.workspaceId), eq(invitations.workspaceId, workspaceId)),
              ),
            )
            .orderBy(desc(invitations.createdAt))
        : [];

      const userMap = new Map(memberUsers.map((user) => [user.id, user]));
      const teamMap = new Map(memberTeams.map((team) => [team.id, team]));

      return {
        members: memberRows.map((membership) => ({
          ...membership,
          user: userMap.get(membership.userId) ?? null,
          team: membership.teamId ? (teamMap.get(membership.teamId) ?? null) : null,
        })),
        invitations: pendingInvitations,
      };
    },

    async invite(input: InviteMemberInput) {
      const actorMembership = await requireManager();
      await requireWorkspace();
      const email = input.email.trim().toLowerCase();
      const role = input.role ?? "member";
      if (role === "owner" && actorMembership.role !== "owner") {
        throw new TenantPermissionDeniedError("only an owner can invite another owner");
      }
      const [existingUser] = await db.select().from(users).where(eq(users.email, email)).limit(1);

      if (existingUser) {
        const [alreadyMember] = await db
          .select({ id: memberships.id })
          .from(memberships)
          .where(
            and(
              eq(memberships.userId, existingUser.id),
              eq(memberships.organizationId, organizationId),
              or(isNull(memberships.workspaceId), eq(memberships.workspaceId, workspaceId)),
            ),
          )
          .limit(1);
        if (alreadyMember) {
          throw new TenantConflictError("User is already a member of this workspace");
        }

        const [membership] = await db
          .insert(memberships)
          .values({
            userId: existingUser.id,
            organizationId,
            workspaceId,
            role,
            status: "active",
          })
          .returning();

        await createNotificationsRepository(context)
          .create({
            userId: existingUser.id,
            type: "workspace_invite",
            title: "تمت إضافتك إلى مساحة عمل جديدة",
            body: `تمت إضافتك بدور ${role}`,
            entityType: "workspace",
            entityId: workspaceId,
          })
          .catch(() => undefined);

        return { membership, user: existingUser, immediate: true as const };
      }

      const [existingInvitation] = await db
        .select({ id: invitations.id })
        .from(invitations)
        .where(
          and(
            eq(invitations.organizationId, organizationId),
            eq(invitations.workspaceId, workspaceId),
            eq(invitations.email, email),
            eq(invitations.status, "pending"),
          ),
        )
        .limit(1);
      if (existingInvitation) {
        throw new TenantConflictError("A pending invitation already exists for this email");
      }

      const [invitation] = await db
        .insert(invitations)
        .values({
          organizationId,
          workspaceId,
          email,
          role,
          invitedBy: actorId,
        })
        .returning();

      return { invitation, immediate: false as const };
    },

    async updateRole(membershipId: string, role: MembershipRole) {
      const actorMembership = await requireManager();
      const [target] = await db
        .select()
        .from(memberships)
        .where(and(eq(memberships.id, membershipId), visibleMembershipScope))
        .limit(1);
      if (!target) {
        throw new TenantResourceNotFoundError("membership");
      }
      if (target.userId === actorId) {
        throw new TenantPermissionDeniedError("members cannot change their own role");
      }
      if (actorMembership.role !== "owner" && (target.role === "owner" || role === "owner")) {
        throw new TenantPermissionDeniedError("only an owner can manage the owner role");
      }

      const [updated] = await db
        .update(memberships)
        .set({ role })
        .where(and(eq(memberships.id, membershipId), visibleMembershipScope))
        .returning();
      if (!updated) {
        throw new TenantResourceNotFoundError("membership");
      }
      return updated;
    },
  };
}
