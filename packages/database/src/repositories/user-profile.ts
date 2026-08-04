import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "../client.js";
import { TenantPermissionDeniedError, TenantResourceNotFoundError } from "../errors.js";
import { memberships, notificationPreferences, users } from "../schema.js";
import { assertWorkspaceTenantContext, type DatabaseTenantContext } from "../tenant-context.js";

export type NotificationPreferenceUpdate = Partial<
  Pick<
    typeof notificationPreferences.$inferInsert,
    "emailEnabled" | "pushEnabled" | "inAppEnabled" | "dndStart" | "dndEnd" | "dndEnabled"
  >
>;

export function createUserProfileRepository(userId: string) {
  if (!userId.trim()) throw new Error("userId is required for profile access");

  async function requireUser() {
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) throw new TenantResourceNotFoundError("user");
    return user;
  }

  async function getOrCreatePreferences() {
    await requireUser();
    const [existing] = await db
      .select()
      .from(notificationPreferences)
      .where(eq(notificationPreferences.userId, userId))
      .limit(1);
    if (existing) return existing;
    const [created] = await db
      .insert(notificationPreferences)
      .values({
        userId,
        emailEnabled: true,
        pushEnabled: true,
        inAppEnabled: true,
        dndStart: "22:00",
        dndEnd: "07:00",
        dndEnabled: false,
      })
      .returning();
    return created;
  }

  return {
    getPreferences: getOrCreatePreferences,

    async updatePreferences(input: NotificationPreferenceUpdate) {
      await getOrCreatePreferences();
      const [updated] = await db
        .update(notificationPreferences)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(notificationPreferences.userId, userId))
        .returning();
      return updated;
    },
  };
}

export function createUserSkillsRepository(context: DatabaseTenantContext) {
  assertWorkspaceTenantContext(context);
  const { organizationId, workspaceId, actorId } = context;
  const visibleMembershipScope = and(
    eq(memberships.organizationId, organizationId),
    eq(memberships.status, "active"),
    or(isNull(memberships.workspaceId), eq(memberships.workspaceId, workspaceId)),
  )!;

  async function requireManager() {
    if (!actorId) throw new TenantPermissionDeniedError("actorId is required to manage user skills");
    const [membership] = await db
      .select({ id: memberships.id })
      .from(memberships)
      .where(
        and(
          eq(memberships.userId, actorId),
          visibleMembershipScope,
          inArray(memberships.role, ["owner", "admin", "manager"]),
        ),
      )
      .limit(1);
    if (!membership) throw new TenantPermissionDeniedError("skill management requires manager access");
  }

  async function requireVisibleUser(userId: string) {
    const [membership] = await db
      .select({ id: memberships.id })
      .from(memberships)
      .where(and(eq(memberships.userId, userId), visibleMembershipScope))
      .limit(1);
    if (!membership) throw new TenantResourceNotFoundError("user");
  }

  return {
    async update(userId: string, skills: string[]) {
      await requireManager();
      await requireVisibleUser(userId);
      const [user] = await db
        .update(users)
        .set({ skills, updatedAt: new Date() })
        .where(eq(users.id, userId))
        .returning();
      if (!user) throw new TenantResourceNotFoundError("user");
      return user;
    },
  };
}
