import { createHash, randomBytes, randomUUID } from "node:crypto";
import { encryptAuthEmailPayload, type AuthEmailPayload } from "@calmboard/notifications";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "../client.js";
import { authEmailOutbox, authTokens, userSessions, users } from "../schema.js";

export type AuthTokenPurpose = "email_verification" | "password_reset" | "mfa_login";

const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1_000;
const PASSWORD_RESET_TTL_MS = 30 * 60 * 1_000;
const MFA_LOGIN_TTL_MS = 5 * 60 * 1_000;

export function hashAuthToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function tokenTtl(purpose: AuthTokenPurpose) {
  if (purpose === "email_verification") return EMAIL_VERIFICATION_TTL_MS;
  if (purpose === "password_reset") return PASSWORD_RESET_TTL_MS;
  return MFA_LOGIN_TTL_MS;
}

export function createAuthTokensRepository() {
  return {
    async issue(userId: string, purpose: AuthTokenPurpose, requestedIp?: string) {
      const token = randomBytes(32).toString("base64url");
      const tokenHash = hashAuthToken(token);
      const now = new Date();
      const expiresAt = new Date(now.getTime() + tokenTtl(purpose));

      await db.transaction(async (transaction) => {
        await transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${`${userId}:${purpose}`}))`);
        await transaction
          .update(authTokens)
          .set({ invalidatedAt: now })
          .where(
            and(
              eq(authTokens.userId, userId),
              eq(authTokens.purpose, purpose),
              isNull(authTokens.consumedAt),
              isNull(authTokens.invalidatedAt),
            ),
          );
        await transaction.insert(authTokens).values({
          userId,
          purpose,
          tokenHash,
          expiresAt,
          requestedIp: requestedIp?.slice(0, 64),
        });
      });
      return { token, expiresAt };
    },

    async issueEmail(
      userId: string,
      purpose: Exclude<AuthTokenPurpose, "mfa_login">,
      buildPayload: (token: string) => AuthEmailPayload,
      requestedIp?: string,
    ) {
      const token = randomBytes(32).toString("base64url");
      const tokenHash = hashAuthToken(token);
      const tokenId = randomUUID();
      const outboxId = randomUUID();
      const now = new Date();
      const expiresAt = new Date(now.getTime() + tokenTtl(purpose));
      const envelope = encryptAuthEmailPayload(
        { id: outboxId, userId, authTokenId: tokenId, purpose },
        buildPayload(token),
      );

      await db.transaction(async (transaction) => {
        await transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${`${userId}:${purpose}`}))`);
        await transaction
          .update(authTokens)
          .set({ invalidatedAt: now })
          .where(
            and(
              eq(authTokens.userId, userId),
              eq(authTokens.purpose, purpose),
              isNull(authTokens.consumedAt),
              isNull(authTokens.invalidatedAt),
            ),
          );
        await transaction.insert(authTokens).values({
          id: tokenId,
          userId,
          purpose,
          tokenHash,
          expiresAt,
          requestedIp: requestedIp?.slice(0, 64),
        });
        await transaction.insert(authEmailOutbox).values({
          id: outboxId,
          userId,
          authTokenId: tokenId,
          purpose,
          ...envelope,
          idempotencyKey: `auth-email/${outboxId}`,
        });
      });
      return { token, expiresAt, outboxId };
    },

    async verifyEmail(token: string) {
      const now = new Date();
      return db.transaction(async (transaction) => {
        const [record] = await transaction
          .update(authTokens)
          .set({ consumedAt: now })
          .where(
            and(
              eq(authTokens.tokenHash, hashAuthToken(token)),
              eq(authTokens.purpose, "email_verification"),
              isNull(authTokens.consumedAt),
              isNull(authTokens.invalidatedAt),
              gt(authTokens.expiresAt, now),
            ),
          )
          .returning({ userId: authTokens.userId });
        if (!record) return null;
        const [user] = await transaction
          .update(users)
          .set({ emailVerifiedAt: now, updatedAt: now })
          .where(eq(users.id, record.userId))
          .returning({ id: users.id, email: users.email, emailVerifiedAt: users.emailVerifiedAt });
        return user ?? null;
      });
    },

    async findMfaChallenge(token: string) {
      const now = new Date();
      const [record] = await db
        .select({ userId: authTokens.userId })
        .from(authTokens)
        .where(
          and(
            eq(authTokens.tokenHash, hashAuthToken(token)),
            eq(authTokens.purpose, "mfa_login"),
            isNull(authTokens.consumedAt),
            isNull(authTokens.invalidatedAt),
            gt(authTokens.expiresAt, now),
          ),
        )
        .limit(1);
      return record ?? null;
    },

    async consumeMfaChallenge(token: string, userId: string) {
      const now = new Date();
      const [record] = await db
        .update(authTokens)
        .set({ consumedAt: now })
        .where(
          and(
            eq(authTokens.tokenHash, hashAuthToken(token)),
            eq(authTokens.userId, userId),
            eq(authTokens.purpose, "mfa_login"),
            isNull(authTokens.consumedAt),
            isNull(authTokens.invalidatedAt),
            gt(authTokens.expiresAt, now),
          ),
        )
        .returning({ userId: authTokens.userId });
      return record ?? null;
    },

    async resetPassword(token: string, passwordHash: string) {
      const now = new Date();
      return db.transaction(async (transaction) => {
        const [record] = await transaction
          .update(authTokens)
          .set({ consumedAt: now })
          .where(
            and(
              eq(authTokens.tokenHash, hashAuthToken(token)),
              eq(authTokens.purpose, "password_reset"),
              isNull(authTokens.consumedAt),
              isNull(authTokens.invalidatedAt),
              gt(authTokens.expiresAt, now),
            ),
          )
          .returning({ userId: authTokens.userId });
        if (!record) return null;
        await transaction
          .update(users)
          .set({
            passwordHash,
            passwordChangedAt: now,
            failedLoginAttempts: 0,
            lockedUntil: null,
            updatedAt: now,
          })
          .where(eq(users.id, record.userId));
        await transaction
          .update(userSessions)
          .set({ revokedAt: now, revokeReason: "password_reset", isCurrent: false, updatedAt: now })
          .where(and(eq(userSessions.userId, record.userId), isNull(userSessions.revokedAt)));
        return { userId: record.userId };
      });
    },
  };
}
