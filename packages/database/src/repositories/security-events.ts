import { createHash } from "node:crypto";
import { desc, eq, sql } from "drizzle-orm";
import { db, withDatabaseContext } from "../client.js";
import { securityEvents } from "../schema.js";

export type SecurityEventType = typeof securityEvents.$inferInsert.eventType;
export type SecurityEventOutcome = typeof securityEvents.$inferInsert.outcome;

export type RecordSecurityEventInput = {
  userId?: string | null;
  email?: string | null;
  eventType: SecurityEventType;
  outcome: SecurityEventOutcome;
  sessionId?: string | null;
  provider?: "google" | "microsoft" | null;
  ip?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
};

const sensitiveMetadataKey = /password|token|secret|authorization|cookie|credential|recovery|totp|code/i;

export function hashSecurityEmail(email: string) {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (depth > 4) return "[truncated]";
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return value.slice(0, 500);
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitizeValue(item, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !sensitiveMetadataKey.test(key))
        .slice(0, 30)
        .map(([key, nested]) => [key.slice(0, 80), sanitizeValue(nested, depth + 1)]),
    );
  }
  return String(value).slice(0, 500);
}

export function sanitizeSecurityMetadata(metadata: Record<string, unknown> = {}) {
  return sanitizeValue(metadata, 0) as Record<string, unknown>;
}

export function createSecurityEventsRepository() {
  return {
    async record(input: RecordSecurityEventInput) {
      const emailHash = input.email ? hashSecurityEmail(input.email) : null;
      if (!input.userId && !emailHash && !input.sessionId && !input.ip) {
        throw new Error("A security event requires a user, email fingerprint, session, or IP");
      }
      const [event] = await db
        .insert(securityEvents)
        .values({
          userId: input.userId,
          eventType: input.eventType,
          outcome: input.outcome,
          emailHash,
          sessionId: input.sessionId,
          provider: input.provider,
          ip: input.ip?.slice(0, 64),
          userAgent: input.userAgent?.slice(0, 500),
          metadata: sanitizeSecurityMetadata(input.metadata),
        })
        .returning();
      return event;
    },

    async listForUser(userId: string, limit = 100) {
      return db
        .select()
        .from(securityEvents)
        .where(eq(securityEvents.userId, userId))
        .orderBy(desc(securityEvents.createdAt))
        .limit(Math.min(Math.max(limit, 1), 200));
    },

    async listForOrganization(userId: string, organizationId: string, limit = 100) {
      return withDatabaseContext({ organizationId, actorId: userId }, () =>
        db
          .select()
          .from(securityEvents)
          .where(sql`${securityEvents.metadata}->>'organizationId' = ${organizationId}`)
          .orderBy(desc(securityEvents.createdAt))
          .limit(Math.min(Math.max(limit, 1), 200)),
      );
    },
  };
}
