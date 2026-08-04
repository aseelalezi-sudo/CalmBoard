import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull, or } from "drizzle-orm";
import { db } from "../client.js";
import { TenantResourceNotFoundError } from "../errors.js";
import { memberships, notificationEmailOutbox, notificationPreferences, notifications, users } from "../schema.js";
import { assertWorkspaceTenantContext, type DatabaseTenantContext } from "../tenant-context.js";

export type CreateNotificationInput = {
  userId: string;
  type: string;
  title: string;
  body?: string | null;
  entityType?: string | null;
  entityId?: string | null;
};

export function createNotificationsRepository(context: DatabaseTenantContext) {
  assertWorkspaceTenantContext(context);
  const { organizationId, workspaceId } = context;

  async function requireRecipient(userId: string) {
    const [membership] = await db
      .select({ id: memberships.id })
      .from(memberships)
      .where(
        and(
          eq(memberships.userId, userId),
          eq(memberships.organizationId, organizationId),
          or(eq(memberships.workspaceId, workspaceId), isNull(memberships.workspaceId)),
          eq(memberships.status, "active"),
        ),
      )
      .limit(1);
    if (!membership) {
      throw new TenantResourceNotFoundError("notification recipient");
    }
  }

  const tenantScope = and(eq(notifications.organizationId, organizationId), eq(notifications.workspaceId, workspaceId));

  return {
    async listForUser(userId: string, limit = 50) {
      await requireRecipient(userId);
      return db
        .select()
        .from(notifications)
        .where(and(tenantScope, eq(notifications.userId, userId)))
        .orderBy(desc(notifications.createdAt))
        .limit(Math.min(Math.max(limit, 1), 100));
    },

    async create(input: CreateNotificationInput) {
      await requireRecipient(input.userId);
      const [notification] = await db
        .insert(notifications)
        .values({
          organizationId,
          workspaceId,
          userId: input.userId,
          type: input.type,
          title: input.title,
          body: input.body ?? null,
          entityType: input.entityType ?? null,
          entityId: input.entityId ?? null,
          isRead: false,
        })
        .returning();
      return notification;
    },

    async enqueueEmail(input: CreateNotificationInput, notificationId?: string | null) {
      await requireRecipient(input.userId);
      const id = randomUUID();
      const [email] = await db
        .insert(notificationEmailOutbox)
        .values({
          id,
          organizationId,
          workspaceId,
          userId: input.userId,
          notificationId: notificationId ?? null,
          subject: input.title,
          body: input.body ?? null,
          idempotencyKey: `notification-email/${id}`,
        })
        .returning();
      return email;
    },

    async markAllRead(userId: string) {
      await requireRecipient(userId);
      await db
        .update(notifications)
        .set({ isRead: true })
        .where(and(tenantScope, eq(notifications.userId, userId)));
    },

    async markRead(notificationId: string, userId: string) {
      await requireRecipient(userId);
      const [notification] = await db
        .update(notifications)
        .set({ isRead: true })
        .where(and(tenantScope, eq(notifications.id, notificationId), eq(notifications.userId, userId)))
        .returning();
      if (!notification) {
        throw new TenantResourceNotFoundError("notification");
      }
      return notification;
    },

    async getDeliveryProfile(userId: string) {
      await requireRecipient(userId);
      const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
      if (!user) {
        throw new TenantResourceNotFoundError("user");
      }
      const [preferences] = await db
        .select()
        .from(notificationPreferences)
        .where(eq(notificationPreferences.userId, userId))
        .limit(1);
      return { user, preferences };
    },
  };
}
