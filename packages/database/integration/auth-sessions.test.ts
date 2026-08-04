import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  createAuthSessionsRepository,
  db,
  hashRefreshToken,
  InvalidAuthSessionError,
  pool,
  refreshTokens,
  RefreshTokenReuseError,
  users,
  userSessions,
} from "../src/index";

after(async () => {
  await pool.end();
});

describe("authentication sessions and refresh rotation", () => {
  it("rotates hashed tokens and revokes the family when an old token is reused", async () => {
    const userId = randomUUID();
    const otherUserId = randomUUID();
    const repository = createAuthSessionsRepository();

    try {
      await db.insert(users).values([
        { id: userId, email: `session-${userId}@example.test`, name: "Session user" },
        { id: otherUserId, email: `session-${otherUserId}@example.test`, name: "Other session user" },
      ]);
      const created = await repository.create({
        userId,
        device: "Integration browser",
        browser: "Test",
        ip: "127.0.0.1",
        userAgent: "CalmBoard integration test",
      });
      const [storedInitial] = await db
        .select()
        .from(refreshTokens)
        .where(eq(refreshTokens.sessionId, created.session.id));
      assert.equal(storedInitial.tokenHash, hashRefreshToken(created.refreshToken));
      assert.notEqual(storedInitial.tokenHash, created.refreshToken);

      const rotated = await repository.rotate({ refreshToken: created.refreshToken, ip: "127.0.0.2" });
      assert.equal(rotated.sessionId, created.session.id);
      assert.notEqual(rotated.refreshToken, created.refreshToken);
      const familyAfterRotation = await db
        .select()
        .from(refreshTokens)
        .where(eq(refreshTokens.familyId, created.session.id));
      assert.equal(familyAfterRotation.length, 2);
      assert.ok(familyAfterRotation.find((token) => token.id === storedInitial.id)?.usedAt);
      assert.equal(
        familyAfterRotation.find((token) => token.id === storedInitial.id)?.replacedByTokenId,
        familyAfterRotation.find((token) => token.parentTokenId === storedInitial.id)?.id,
      );

      await assert.rejects(
        () => repository.rotate({ refreshToken: created.refreshToken }),
        (error: unknown) => error instanceof RefreshTokenReuseError,
      );
      const [revokedSession] = await db.select().from(userSessions).where(eq(userSessions.id, created.session.id));
      assert.equal(revokedSession.revokeReason, "refresh_token_reuse");
      assert.equal(
        (
          await db
            .select({ id: refreshTokens.id })
            .from(refreshTokens)
            .where(and(eq(refreshTokens.familyId, created.session.id), isNull(refreshTokens.revokedAt)))
        ).length,
        0,
      );
      await assert.rejects(
        () => repository.rotate({ refreshToken: rotated.refreshToken }),
        (error: unknown) => error instanceof InvalidAuthSessionError,
      );

      await assert.rejects(
        () =>
          db.insert(refreshTokens).values({
            sessionId: created.session.id,
            userId: otherUserId,
            familyId: created.session.id,
            tokenHash: "a".repeat(64),
            expiresAt: new Date(Date.now() + 60_000),
          }),
        (error: unknown) =>
          (error as { cause?: { message?: string } }).cause?.message ===
          "Refresh token does not belong to its user and session family",
      );

      const kept = await repository.create({ userId, device: "Kept session" });
      const revoked = await repository.create({ userId, device: "Revoked session" });
      await repository.revokeOther(userId, kept.session.id);
      assert.deepEqual(
        (await repository.list(userId, kept.session.id)).map((session) => session.id),
        [kept.session.id],
      );
      const [revokedOther] = await db.select().from(userSessions).where(eq(userSessions.id, revoked.session.id));
      assert.equal(revokedOther.revokeReason, "logout_other_sessions");
    } finally {
      await db
        .delete(users)
        .where(inArray(users.id, [userId, otherUserId]))
        .catch(() => undefined);
    }
  });
});
