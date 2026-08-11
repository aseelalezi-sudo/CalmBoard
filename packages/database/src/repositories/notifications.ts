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
  deduplicationKey?: string | null;
  actionPath?: string | null;
};

type NotificationDatabase = Pick<typeof db, "select" | "insert" | "update">;

export function createNotificationsRepository(context: DatabaseTenantContext, database: NotificationDatabase = db) {
  assertWorkspaceTenantContext(context);
  const { organizationId, workspaceId } = context;

  async function requireRecipient(userId: string) {
    const [membership] = await database
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
      return database
        .select()
        .from(notifications)
        .where(and(tenantScope, eq(notifications.userId, userId)))
        .orderBy(desc(notifications.createdAt))
        .limit(Math.min(Math.max(limit, 1), 100));
    },

    async create(input: CreateNotificationInput) {
      await requireRecipient(input.userId);
      const [notification] = await database
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
          deduplicationKey: input.deduplicationKey ?? null,
          actionPath: input.actionPath ?? null,
          isRead: false,
        })
        .onConflictDoNothing()
        .returning();
      if (notification) return notification;
      if (!input.deduplicationKey) throw new Error("Notification insert did not return a row");
      const [existing] = await database
        .select()
        .from(notifications)
        .where(
          and(
            tenantScope,
            eq(notifications.userId, input.userId),
            eq(notifications.deduplicationKey, input.deduplicationKey),
          ),
        )
        .limit(1);
      if (!existing) throw new Error("Notification deduplication lookup failed");
      return existing;
    },

    async enqueueEmail(input: CreateNotificationInput, notificationId?: string | null) {
      await requireRecipient(input.userId);
      const id = randomUUID();
      const idempotencyKey = input.deduplicationKey
        ? `notification-email/${organizationId}/${input.userId}/${input.deduplicationKey}`
        : `notification-email/${id}`;
      const [email] = await database
        .insert(notificationEmailOutbox)
        .values({
          id,
          organizationId,
          workspaceId,
          userId: input.userId,
          notificationId: notificationId ?? null,
          subject: input.title,
          body: input.body ?? null,
          idempotencyKey,
        })
        .onConflictDoNothing()
        .returning();
      if (email) return email;
      const [existing] = await database
        .select()
        .from(notificationEmailOutbox)
        .where(eq(notificationEmailOutbox.idempotencyKey, idempotencyKey))
        .limit(1);
      if (!existing) throw new Error("Notification email deduplication lookup failed");
      return existing;
    },

    async markAllRead(userId: string) {
      await requireRecipient(userId);
      await database
        .update(notifications)
        .set({ isRead: true })
        .where(and(tenantScope, eq(notifications.userId, userId)));
    },

    async markRead(notificationId: string, userId: string) {
      await requireRecipient(userId);
      const [notification] = await database
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
      const [user] = await database.select().from(users).where(eq(users.id, userId)).limit(1);
      if (!user) {
        throw new TenantResourceNotFoundError("user");
      }
      const [preferences] = await database
        .select()
        .from(notificationPreferences)
        .where(eq(notificationPreferences.userId, userId))
        .limit(1);
      return { user, preferences };
    },
  };
}
