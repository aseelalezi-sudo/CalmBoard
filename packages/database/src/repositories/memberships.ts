import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { encryptInvitationEmailPayload } from "@calmboard/notifications";
import { db, withDatabaseContext } from "../client.js";
import { TenantConflictError, TenantPermissionDeniedError, TenantResourceNotFoundError } from "../errors.js";
import {
  activities,
  invitationEmailOutbox,
  invitations,
  memberships,
  notifications,
  organizations,
  teams,
  users,
  workspaces,
} from "../schema.js";
import { assertWorkspaceTenantContext, type DatabaseTenantContext } from "../tenant-context.js";

export type MembershipRecord = typeof memberships.$inferSelect;
export type MembershipRole = MembershipRecord["role"];

export type InviteMemberInput = {
  email: string;
  role?: MembershipRole;
};

type DatabaseTransaction = Parameters<Parameters<(typeof db)["transaction"]>[0]>[0];

const managerRoles = new Set<MembershipRole>(["owner", "admin"]);
const tokenPattern =
  /^v1\.([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.([A-Za-z0-9_-]{43})$/i;

export function invitationLifetimeHours(env: NodeJS.ProcessEnv = process.env) {
  const value = Number(env.INVITATION_TOKEN_TTL_HOURS ?? "168");
  if (!Number.isInteger(value) || value < 1 || value > 720) {
    throw new Error("INVITATION_TOKEN_TTL_HOURS must be an integer between 1 and 720");
  }
  return value;
}

function generateInvitationToken(organizationId: string) {
  return `v1.${organizationId}.${randomBytes(32).toString("base64url")}`;
}

export function hashInvitationToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function tokenOrganizationId(token: string) {
  const match = tokenPattern.exec(token);
  if (!match?.[1]) throw new TenantResourceNotFoundError("invitation");
  return match[1].toLowerCase();
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function emailPayload(email: string, token: string) {
  const url = new URL("/accept-invitation", process.env.APP_URL ?? "http://localhost:3000");
  url.searchParams.set("token", token);
  const link = escapeHtml(url.toString());
  return {
    to: email,
    name: email,
    subject: "دعوة للانضمام إلى CalmBoard | CalmBoard invitation",
    html: `<div style="font-family:sans-serif;padding:20px"><h2>دعوة للانضمام إلى CalmBoard</h2><p>استخدم الرابط الآمن التالي لقبول الدعوة. تنتهي صلاحيته تلقائياً.</p><p><a href="${link}">قبول الدعوة</a></p><hr><h2>You're invited to CalmBoard</h2><p>Use this secure, time-limited link to accept your invitation.</p><p><a href="${link}">Accept invitation</a></p><p>If you were not expecting this invitation, you can ignore this email.</p></div>`,
  };
}

async function enqueueInvitationEmail(
  transaction: DatabaseTransaction,
  invitation: typeof invitations.$inferSelect,
  rawToken: string,
) {
  const outboxId = randomUUID();
  const envelope = encryptInvitationEmailPayload(
    {
      id: outboxId,
      organizationId: invitation.organizationId,
      workspaceId: invitation.workspaceId,
      invitationId: invitation.id,
      tokenVersion: invitation.tokenVersion,
    },
    emailPayload(invitation.email, rawToken),
  );
  await transaction.insert(invitationEmailOutbox).values({
    id: outboxId,
    organizationId: invitation.organizationId,
    workspaceId: invitation.workspaceId,
    invitationId: invitation.id,
    tokenVersion: invitation.tokenVersion,
    recipientEmail: invitation.email,
    ...envelope,
    idempotencyKey: `invitation-email/${invitation.id}/${invitation.tokenVersion}`,
  });
}

export function effectiveInvitationStatus(invitation: typeof invitations.$inferSelect, now = new Date()) {
  if (invitation.status === "pending" && invitation.expiresAt && invitation.expiresAt <= now) return "expired";
  if (invitation.status === "pending" && (!invitation.tokenHash || !invitation.expiresAt)) return "resend_required";
  return invitation.status;
}

export function createMembershipsRepository(context: DatabaseTenantContext) {
  assertWorkspaceTenantContext(context);
  const { organizationId, workspaceId, actorId } = context;
  const visibleMembershipScope = and(
    eq(memberships.organizationId, organizationId),
    eq(memberships.status, "active"),
    or(isNull(memberships.workspaceId), eq(memberships.workspaceId, workspaceId)),
  )!;

  async function requireActorMembership() {
    if (!actorId) throw new TenantPermissionDeniedError("actorId is required for membership access");
    const [membership] = await db
      .select()
      .from(memberships)
      .where(and(eq(memberships.userId, actorId), visibleMembershipScope))
      .limit(1);
    if (!membership) throw new TenantPermissionDeniedError();
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
    if (!workspace) throw new TenantResourceNotFoundError("workspace");
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
      const invitationRows = managerRoles.has(actorMembership.role)
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
        invitations: invitationRows.map((invitation) => ({
          ...invitation,
          status: effectiveInvitationStatus(invitation),
        })),
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
      const [existingUser] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
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
        if (alreadyMember) throw new TenantConflictError("User is already a member of this workspace");
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
      if (existingInvitation) throw new TenantConflictError("A pending invitation already exists for this email");

      const now = new Date();
      const rawToken = generateInvitationToken(organizationId);
      const expiresAt = new Date(now.getTime() + invitationLifetimeHours() * 60 * 60 * 1_000);
      return db.transaction(async (transaction) => {
        const [invitation] = await transaction
          .insert(invitations)
          .values({
            organizationId,
            workspaceId,
            email,
            role,
            invitedBy: actorId,
            tokenHash: hashInvitationToken(rawToken),
            tokenVersion: 1,
            expiresAt,
            lastSentAt: now,
            updatedAt: now,
          })
          .returning();
        if (!invitation) throw new Error("Invitation insert did not return a row");
        await enqueueInvitationEmail(transaction, invitation, rawToken);
        await transaction.insert(activities).values({
          organizationId,
          workspaceId,
          actorId: actorId!,
          action: "invitation_created",
          entityType: "invitation",
          entityId: invitation.id,
          newValues: { email, role },
        });
        return {
          invitation: { ...invitation, status: effectiveInvitationStatus(invitation) },
          immediate: false as const,
        };
      });
    },

    async resend(invitationId: string) {
      await requireManager();
      await requireWorkspace();
      return db.transaction(async (transaction) => {
        const [current] = await transaction
          .select()
          .from(invitations)
          .where(
            and(
              eq(invitations.id, invitationId),
              eq(invitations.organizationId, organizationId),
              eq(invitations.workspaceId, workspaceId),
            ),
          )
          .for("update")
          .limit(1);
        if (!current) throw new TenantResourceNotFoundError("invitation");
        if (current.status !== "pending") throw new TenantConflictError("Only pending invitations can be resent");
        const now = new Date();
        const rawToken = generateInvitationToken(organizationId);
        const [updated] = await transaction
          .update(invitations)
          .set({
            tokenHash: hashInvitationToken(rawToken),
            tokenVersion: current.tokenVersion + 1,
            expiresAt: new Date(now.getTime() + invitationLifetimeHours() * 60 * 60 * 1_000),
            lastSentAt: now,
            updatedAt: now,
          })
          .where(eq(invitations.id, current.id))
          .returning();
        if (!updated) throw new Error("Invitation update did not return a row");
        await enqueueInvitationEmail(transaction, updated, rawToken);
        await transaction.insert(activities).values({
          organizationId,
          workspaceId,
          actorId: actorId!,
          action: "invitation_resent",
          entityType: "invitation",
          entityId: current.id,
          newValues: { tokenVersion: updated.tokenVersion },
        });
        return { ...updated, status: effectiveInvitationStatus(updated) };
      });
    },

    async revoke(invitationId: string) {
      await requireManager();
      const now = new Date();
      return db.transaction(async (transaction) => {
        const [updated] = await transaction
          .update(invitations)
          .set({ status: "revoked", revokedAt: now, updatedAt: now })
          .where(
            and(
              eq(invitations.id, invitationId),
              eq(invitations.organizationId, organizationId),
              eq(invitations.workspaceId, workspaceId),
              eq(invitations.status, "pending"),
            ),
          )
          .returning();
        if (!updated) throw new TenantResourceNotFoundError("pending invitation");
        await transaction.insert(activities).values({
          organizationId,
          workspaceId,
          actorId: actorId!,
          action: "invitation_revoked",
          entityType: "invitation",
          entityId: invitationId,
        });
        return updated;
      });
    },

    async updateRole(membershipId: string, role: MembershipRole) {
      const actorMembership = await requireManager();
      const [target] = await db
        .select()
        .from(memberships)
        .where(and(eq(memberships.id, membershipId), visibleMembershipScope))
        .limit(1);
      if (!target) throw new TenantResourceNotFoundError("membership");
      if (target.userId === actorId) throw new TenantPermissionDeniedError("members cannot change their own role");
      if (actorMembership.role !== "owner" && (target.role === "owner" || role === "owner")) {
        throw new TenantPermissionDeniedError("only an owner can manage the owner role");
      }
      const [updated] = await db
        .update(memberships)
        .set({ role })
        .where(and(eq(memberships.id, membershipId), visibleMembershipScope))
        .returning();
      if (!updated) throw new TenantResourceNotFoundError("membership");
      return updated;
    },
  };
}

export async function inspectInvitation(rawToken: string) {
  const organizationId = tokenOrganizationId(rawToken);
  const tokenHash = hashInvitationToken(rawToken);
  return withDatabaseContext({ organizationId }, async () => {
    const [row] = await db
      .select({ invitation: invitations, organization: organizations, workspace: workspaces })
      .from(invitations)
      .innerJoin(organizations, eq(invitations.organizationId, organizations.id))
      .leftJoin(workspaces, eq(invitations.workspaceId, workspaces.id))
      .where(and(eq(invitations.organizationId, organizationId), eq(invitations.tokenHash, tokenHash)))
      .limit(1);
    if (!row) return { status: "invalid" as const };
    return {
      status: effectiveInvitationStatus(row.invitation),
      email: row.invitation.email,
      role: row.invitation.role,
      expiresAt: row.invitation.expiresAt,
      organization: { name: row.organization.name },
      workspace: row.workspace ? { name: row.workspace.name } : null,
    };
  });
}

export async function acceptInvitation(rawToken: string, userId: string) {
  const organizationId = tokenOrganizationId(rawToken);
  const tokenHash = hashInvitationToken(rawToken);
  return withDatabaseContext({ organizationId, actorId: userId }, async () => {
    const [invitation] = await db
      .select()
      .from(invitations)
      .where(and(eq(invitations.organizationId, organizationId), eq(invitations.tokenHash, tokenHash)))
      .for("update")
      .limit(1);
    if (!invitation) throw new TenantResourceNotFoundError("invitation");
    if (invitation.status !== "pending") throw new TenantConflictError("Invitation is no longer pending");
    if (!invitation.expiresAt || invitation.expiresAt <= new Date()) {
      throw new TenantConflictError("Invitation has expired and must be resent");
    }
    const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
    if (!user || user.email.toLowerCase() !== invitation.email.toLowerCase()) {
      throw new TenantPermissionDeniedError("Invitation is not intended for the authenticated identity");
    }
    const [existing] = await db
      .select()
      .from(memberships)
      .where(
        and(
          eq(memberships.userId, userId),
          eq(memberships.organizationId, invitation.organizationId),
          invitation.workspaceId
            ? or(isNull(memberships.workspaceId), eq(memberships.workspaceId, invitation.workspaceId))
            : isNull(memberships.workspaceId),
        ),
      )
      .limit(1);
    let membership = existing;
    if (!membership) {
      const [inserted] = await db
        .insert(memberships)
        .values({
          userId,
          organizationId: invitation.organizationId,
          workspaceId: invitation.workspaceId,
          role: invitation.role,
          status: "active",
        })
        .onConflictDoNothing()
        .returning();
      membership = inserted;
    }
    if (!membership) {
      [membership] = await db
        .select()
        .from(memberships)
        .where(
          and(
            eq(memberships.userId, userId),
            eq(memberships.organizationId, invitation.organizationId),
            invitation.workspaceId
              ? eq(memberships.workspaceId, invitation.workspaceId)
              : isNull(memberships.workspaceId),
          ),
        )
        .limit(1);
    }
    if (!membership) throw new TenantConflictError("Membership could not be created");
    const now = new Date();
    await db
      .update(invitations)
      .set({ status: "accepted", acceptedAt: now, acceptedBy: userId, updatedAt: now })
      .where(and(eq(invitations.id, invitation.id), eq(invitations.status, "pending")));
    if (invitation.workspaceId) {
      await db
        .insert(notifications)
        .values({
          organizationId: invitation.organizationId,
          workspaceId: invitation.workspaceId,
          userId,
          type: "invitation_accepted",
          title: "تم قبول دعوتك | Invitation accepted",
          body: "أصبحت عضواً في مساحة العمل | You are now a workspace member",
          entityType: "workspace",
          entityId: invitation.workspaceId,
          deduplicationKey: `invitation-accepted:${invitation.id}:${userId}`,
          actionPath: "/?view=members",
        })
        .onConflictDoNothing();
      await db.insert(activities).values({
        organizationId: invitation.organizationId,
        workspaceId: invitation.workspaceId,
        actorId: userId,
        action: "invitation_accepted",
        entityType: "invitation",
        entityId: invitation.id,
      });
    }
    return { membership, organizationId: invitation.organizationId, workspaceId: invitation.workspaceId };
  });
}

export async function declineInvitation(rawToken: string, userId: string) {
  const organizationId = tokenOrganizationId(rawToken);
  const tokenHash = hashInvitationToken(rawToken);
  return withDatabaseContext({ organizationId, actorId: userId }, async () => {
    const [invitation] = await db
      .select()
      .from(invitations)
      .where(and(eq(invitations.organizationId, organizationId), eq(invitations.tokenHash, tokenHash)))
      .for("update")
      .limit(1);
    if (!invitation) throw new TenantResourceNotFoundError("invitation");
    if (invitation.status !== "pending") throw new TenantConflictError("Invitation is no longer pending");
    const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
    if (!user || user.email.toLowerCase() !== invitation.email.toLowerCase()) {
      throw new TenantPermissionDeniedError("Invitation is not intended for the authenticated identity");
    }
    const now = new Date();
    await db
      .update(invitations)
      .set({ status: "declined", declinedAt: now, updatedAt: now })
      .where(and(eq(invitations.id, invitation.id), eq(invitations.status, "pending")));
    return { ok: true };
  });
}
