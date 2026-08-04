import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, gt, isNull, lte, ne } from "drizzle-orm";
import { db } from "../client.js";
import { TenantResourceNotFoundError } from "../errors.js";
import { refreshTokens, users, userSessions } from "../schema.js";

const DEFAULT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const DEFAULT_REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
export const SESSION_ACTIVITY_TOUCH_INTERVAL_MS = 60_000;

export function sessionActivityIsStale(lastActive: Date, now: Date) {
  return now.getTime() - lastActive.getTime() >= SESSION_ACTIVITY_TOUCH_INTERVAL_MS;
}

export class InvalidAuthSessionError extends Error {
  constructor(message = "Authentication session is invalid or expired") {
    super(message);
    this.name = "InvalidAuthSessionError";
  }
}

export class RefreshTokenReuseError extends Error {
  constructor() {
    super("Refresh token reuse detected; the complete session family was revoked");
    this.name = "RefreshTokenReuseError";
  }
}

export type CreateAuthSessionInput = {
  userId: string;
  device: string;
  browser?: string | null;
  userAgent?: string | null;
  ip?: string | null;
  location?: string | null;
  sessionExpiresAt?: Date;
  refreshExpiresAt?: Date;
};

export type RotateRefreshTokenInput = {
  refreshToken: string;
  ip?: string | null;
  userAgent?: string | null;
};

export function hashRefreshToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function generateRefreshToken() {
  return randomBytes(48).toString("base64url");
}

export function createAuthSessionsRepository() {
  return {
    async create(input: CreateAuthSessionInput) {
      const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, input.userId)).limit(1);
      if (!user) throw new TenantResourceNotFoundError("user");

      const now = new Date();
      const sessionExpiresAt = input.sessionExpiresAt ?? new Date(now.getTime() + DEFAULT_SESSION_TTL_MS);
      const refreshExpiresAt = input.refreshExpiresAt ?? new Date(now.getTime() + DEFAULT_REFRESH_TTL_MS);
      if (sessionExpiresAt <= now || refreshExpiresAt <= now || refreshExpiresAt > sessionExpiresAt) {
        throw new InvalidAuthSessionError("Session and refresh token expiry are invalid");
      }
      const refreshToken = generateRefreshToken();
      const session = await db.transaction(async (transaction) => {
        const [createdSession] = await transaction
          .insert(userSessions)
          .values({
            userId: input.userId,
            device: input.device.trim() || "Unknown device",
            browser: input.browser ?? null,
            userAgent: input.userAgent ?? null,
            ip: input.ip ?? null,
            location: input.location ?? null,
            expiresAt: sessionExpiresAt,
            lastRefreshAt: now,
          })
          .returning();
        await transaction.insert(refreshTokens).values({
          sessionId: createdSession.id,
          userId: input.userId,
          familyId: createdSession.id,
          tokenHash: hashRefreshToken(refreshToken),
          expiresAt: refreshExpiresAt,
          createdIp: input.ip ?? null,
          userAgent: input.userAgent ?? null,
        });
        return createdSession;
      });
      return { session, refreshToken, refreshExpiresAt };
    },

    async rotate(input: RotateRefreshTokenInput) {
      if (!input.refreshToken) throw new InvalidAuthSessionError("Refresh token is required");
      const tokenHash = hashRefreshToken(input.refreshToken);
      const nextRefreshToken = generateRefreshToken();
      const nextTokenHash = hashRefreshToken(nextRefreshToken);
      const now = new Date();

      const result = await db.transaction(async (transaction) => {
        const [token] = await transaction
          .select()
          .from(refreshTokens)
          .where(eq(refreshTokens.tokenHash, tokenHash))
          .for("update")
          .limit(1);
        if (!token) return { status: "invalid" as const };

        const [session] = await transaction
          .select()
          .from(userSessions)
          .where(eq(userSessions.id, token.sessionId))
          .for("update")
          .limit(1);
        if (!session) return { status: "invalid" as const };

        if (token.usedAt) {
          if (!session.revokedAt) {
            await transaction
              .update(userSessions)
              .set({ revokedAt: now, revokeReason: "refresh_token_reuse", updatedAt: now })
              .where(eq(userSessions.id, session.id));
          }
          return { status: "reuse" as const };
        }

        if (token.revokedAt || session.revokedAt || token.expiresAt <= now || session.expiresAt <= now) {
          if (!session.revokedAt && session.expiresAt <= now) {
            await transaction
              .update(userSessions)
              .set({ revokedAt: now, revokeReason: "session_expired", updatedAt: now })
              .where(eq(userSessions.id, session.id));
          }
          return { status: "invalid" as const };
        }

        const nextExpiresAt = new Date(Math.min(session.expiresAt.getTime(), now.getTime() + DEFAULT_REFRESH_TTL_MS));
        const [replacement] = await transaction
          .insert(refreshTokens)
          .values({
            sessionId: session.id,
            userId: session.userId,
            familyId: token.familyId,
            tokenHash: nextTokenHash,
            parentTokenId: token.id,
            expiresAt: nextExpiresAt,
            createdIp: input.ip ?? null,
            userAgent: input.userAgent ?? null,
          })
          .returning({ id: refreshTokens.id });
        await transaction
          .update(refreshTokens)
          .set({ usedAt: now, replacedByTokenId: replacement.id })
          .where(eq(refreshTokens.id, token.id));
        await transaction
          .update(userSessions)
          .set({
            lastActive: now,
            lastRefreshAt: now,
            updatedAt: now,
            ...(input.ip === undefined ? {} : { ip: input.ip }),
            ...(input.userAgent === undefined ? {} : { userAgent: input.userAgent }),
          })
          .where(eq(userSessions.id, session.id));
        return {
          status: "rotated" as const,
          sessionId: session.id,
          userId: session.userId,
          refreshExpiresAt: nextExpiresAt,
        };
      });

      if (result.status === "reuse") throw new RefreshTokenReuseError();
      if (result.status === "invalid") throw new InvalidAuthSessionError();
      return { ...result, refreshToken: nextRefreshToken };
    },

    async validate(sessionId: string, userId?: string) {
      const now = new Date();
      const conditions = [
        eq(userSessions.id, sessionId),
        isNull(userSessions.revokedAt),
        gt(userSessions.expiresAt, now),
      ];
      if (userId) conditions.push(eq(userSessions.userId, userId));
      const [session] = await db
        .select()
        .from(userSessions)
        .where(and(...conditions))
        .limit(1);
      if (!session) throw new InvalidAuthSessionError();
      if (!sessionActivityIsStale(session.lastActive, now)) return session;

      const activityThreshold = new Date(now.getTime() - SESSION_ACTIVITY_TOUCH_INTERVAL_MS);
      const [touched] = await db
        .update(userSessions)
        .set({ lastActive: now, updatedAt: now })
        .where(and(...conditions, lte(userSessions.lastActive, activityThreshold)))
        .returning();
      if (touched) return touched;

      const [revalidated] = await db
        .select()
        .from(userSessions)
        .where(and(...conditions))
        .limit(1);
      if (!revalidated) throw new InvalidAuthSessionError();
      return revalidated;
    },

    async list(userId: string, currentSessionId: string) {
      const now = new Date();
      const rows = await db
        .select()
        .from(userSessions)
        .where(and(eq(userSessions.userId, userId), isNull(userSessions.revokedAt), gt(userSessions.expiresAt, now)))
        .orderBy(desc(userSessions.lastActive));
      return rows.map((session) => ({
        ...session,
        isCurrent: session.id === currentSessionId,
      }));
    },

    async revoke(userId: string, sessionId: string, reason = "user_logout") {
      const now = new Date();
      const [session] = await db
        .update(userSessions)
        .set({ revokedAt: now, revokeReason: reason, isCurrent: false, updatedAt: now })
        .where(and(eq(userSessions.id, sessionId), eq(userSessions.userId, userId), isNull(userSessions.revokedAt)))
        .returning();
      if (!session) throw new TenantResourceNotFoundError("active session");
      return session;
    },

    async revokeOther(userId: string, currentSessionId: string) {
      const now = new Date();
      return db
        .update(userSessions)
        .set({ revokedAt: now, revokeReason: "logout_other_sessions", isCurrent: false, updatedAt: now })
        .where(
          and(eq(userSessions.userId, userId), ne(userSessions.id, currentSessionId), isNull(userSessions.revokedAt)),
        )
        .returning({ id: userSessions.id });
    },

    async revokeAll(userId: string) {
      const now = new Date();
      return db
        .update(userSessions)
        .set({ revokedAt: now, revokeReason: "logout_all_sessions", isCurrent: false, updatedAt: now })
        .where(and(eq(userSessions.userId, userId), isNull(userSessions.revokedAt)))
        .returning({ id: userSessions.id });
    },
  };
}
