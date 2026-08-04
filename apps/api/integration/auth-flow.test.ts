import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { BadRequestException, HttpException, UnauthorizedException } from "@nestjs/common";
import { AuthService } from "../src/auth.service";
import type { AuthEmailService } from "../src/auth-email.service";
import {
  authTokens,
  createAuthTokensRepository,
  db,
  hashAuthToken,
  memberships,
  organizations,
  pool,
  refreshTokens,
  securityEvents,
  subscriptions,
  usageLimits,
  users,
  userSessions,
  workspaces,
} from "@calmboard/database";

after(async () => {
  await pool.end();
});

describe("production authentication flow", () => {
  it("registers with Argon2id, signs short access tokens, rotates refresh tokens, and logs out", async () => {
    const previousSecret = process.env.AUTH_TOKEN_SECRET;
    process.env.AUTH_TOKEN_SECRET = "integration-auth-secret-that-is-longer-than-thirty-two-bytes";
    const unique = randomUUID();
    const email = `auth-${unique}@example.test`;
    const password = "Correct horse battery staple 2026!";
    const replacementPassword = "A replacement password for 2026!";
    const delivered: Array<{ purpose: "email_verification" | "password_reset"; token: string; email: string }> = [];
    const authTokenRepository = createAuthTokensRepository();
    const authEmail = {
      send: async (message: {
        purpose: "email_verification" | "password_reset";
        userId: string;
        email: string;
        requestedIp?: string;
      }) => {
        const issued = await authTokenRepository.issue(message.userId, message.purpose, message.requestedIp);
        delivered.push({ purpose: message.purpose, email: message.email, token: issued.token });
        return true;
      },
    } as AuthEmailService;
    const auth = new AuthService(authEmail);
    const loginWithoutMfa = async (loginEmail: string, loginPassword: string, device: string) => {
      const result = await auth.login(loginEmail, loginPassword, { device });
      assert.equal(result.requiresMfa, false);
      if (result.requiresMfa) throw new Error("MFA was unexpectedly required");
      return result;
    };
    let userId: string | undefined;
    let organizationId: string | undefined;

    try {
      const registered = await auth.register(
        {
          email,
          password,
          name: "Authentication user",
          organizationName: "Authentication organization",
          workspaceName: "Authentication workspace",
        },
        { device: "Integration browser", userAgent: "CalmBoard integration", ip: "127.0.0.1" },
      );
      userId = registered.user.id;
      assert.equal(registered.verificationEmailSent, true);
      assert.equal("passwordHash" in registered.user, false);
      assert.equal("accessToken" in registered.user, false);

      const [storedUser] = await db.select().from(users).where(eq(users.id, userId));
      assert.match(storedUser.passwordHash ?? "", /^\$argon2id\$/);
      const [ownedOrganization] = await db.select().from(organizations).where(eq(organizations.ownerId, userId));
      organizationId = ownedOrganization.id;
      const verification = delivered.find((message) => message.purpose === "email_verification");
      assert.ok(verification);
      const [storedVerification] = await db.select().from(authTokens).where(eq(authTokens.userId, userId));
      assert.equal(storedVerification.tokenHash, hashAuthToken(verification.token));
      assert.notEqual(storedVerification.tokenHash, verification.token);
      await auth.verifyEmail(verification.token);
      await assert.rejects(() => auth.verifyEmail(verification.token), BadRequestException);

      for (let attempt = 0; attempt < 5; attempt += 1) {
        await assert.rejects(
          () => auth.login(email, "not-the-password", { device: "Integration browser" }),
          (error: unknown) => error instanceof UnauthorizedException,
        );
      }

      const [lockedUser] = await db.select().from(users).where(eq(users.id, userId));
      assert.equal(lockedUser.failedLoginAttempts, 5);
      assert.ok(lockedUser.lockedUntil && lockedUser.lockedUntil > new Date());
      await assert.rejects(
        () => auth.login(email, password, { device: "Integration browser" }),
        (error: unknown) =>
          error instanceof HttpException &&
          error.getStatus() === 423 &&
          typeof (error.getResponse() as { retryAfter?: unknown }).retryAfter === "number",
      );

      const progressiveLockDurations = new Map([
        [6, 5 * 60_000],
        [7, 15 * 60_000],
        [8, 60 * 60_000],
        [9, 24 * 60 * 60_000],
      ]);
      for (const [expectedAttempts, expectedDuration] of progressiveLockDurations) {
        await db
          .update(users)
          .set({ lockedUntil: new Date(Date.now() - 1_000) })
          .where(eq(users.id, userId));
        const attemptedAt = Date.now();
        await assert.rejects(
          () => auth.login(email, "not-the-password", { device: "Integration browser" }),
          (error: unknown) => error instanceof UnauthorizedException,
        );
        const [progressivelyLockedUser] = await db.select().from(users).where(eq(users.id, userId));
        assert.equal(progressivelyLockedUser.failedLoginAttempts, expectedAttempts);
        assert.ok(progressivelyLockedUser.lockedUntil);
        const actualDuration = progressivelyLockedUser.lockedUntil.getTime() - attemptedAt;
        assert.ok(actualDuration >= expectedDuration - 1_000);
        assert.ok(actualDuration <= expectedDuration + 5_000);
      }

      await db
        .update(users)
        .set({ lockedUntil: new Date(Date.now() - 1_000) })
        .where(eq(users.id, userId));

      const loggedIn = await loginWithoutMfa(email.toUpperCase(), password, "Integration browser");
      const [unlockedUser] = await db.select().from(users).where(eq(users.id, userId));
      assert.equal(unlockedUser.failedLoginAttempts, 0);
      assert.equal(unlockedUser.lockedUntil, null);
      assert.ok(unlockedUser.lastLoginAt);
      const current = await auth.current(loggedIn.tokens.accessToken);
      assert.equal(current.user.id, userId);
      assert.ok(current.user.emailVerifiedAt);
      assert.equal("passwordHash" in current.user, false);

      const registrationSession = await auth.current(registered.tokens.accessToken);
      const listedSessions = await auth.listSessions(userId, current.sessionId);
      assert.equal(listedSessions.filter((session) => session.isCurrent).length, 1);
      assert.equal(listedSessions.find((session) => session.isCurrent)?.id, current.sessionId);
      assert.ok(listedSessions.every((session) => !("userId" in session) && !("userAgent" in session)));
      await auth.revokeSession(userId, current.sessionId, registrationSession.sessionId);
      await assert.rejects(
        () => auth.current(registered.tokens.accessToken),
        (error: unknown) => error instanceof UnauthorizedException,
      );

      const secondaryLogin = await loginWithoutMfa(email, password, "Secondary browser");
      await auth.revokeOtherSessions(userId, current.sessionId);
      await assert.rejects(
        () => auth.current(secondaryLogin.tokens.accessToken),
        (error: unknown) => error instanceof UnauthorizedException,
      );
      assert.equal((await auth.current(loggedIn.tokens.accessToken)).sessionId, current.sessionId);

      const refreshed = await auth.refresh(loggedIn.tokens.refreshToken, { device: "Integration browser" });
      assert.equal(refreshed.user.id, userId);
      assert.notEqual(refreshed.tokens.refreshToken, loggedIn.tokens.refreshToken);

      const deliveriesBeforeUnknownReset = delivered.length;
      await auth.forgotPassword(`missing-${unique}@example.test`, "127.0.0.1");
      assert.equal(delivered.length, deliveriesBeforeUnknownReset);
      await auth.forgotPassword(email, "127.0.0.1");
      const passwordReset = delivered.find((message) => message.purpose === "password_reset");
      assert.ok(passwordReset);
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await assert.rejects(
          () => auth.login(email, "not-the-password", { device: "Integration browser" }),
          (error: unknown) => error instanceof UnauthorizedException,
        );
      }
      await auth.resetPassword(passwordReset.token, replacementPassword);
      const [resetUser] = await db.select().from(users).where(eq(users.id, userId));
      assert.equal(resetUser.failedLoginAttempts, 0);
      assert.equal(resetUser.lockedUntil, null);
      await assert.rejects(() => auth.resetPassword(passwordReset.token, replacementPassword), BadRequestException);
      const expiredResetToken = `expired-${randomUUID()}`;
      const expiredCreatedAt = new Date(Date.now() - 2 * 60 * 60 * 1_000);
      await db.insert(authTokens).values({
        userId,
        purpose: "password_reset",
        tokenHash: hashAuthToken(expiredResetToken),
        createdAt: expiredCreatedAt,
        expiresAt: new Date(expiredCreatedAt.getTime() + 30 * 60 * 1_000),
      });
      await assert.rejects(() => auth.resetPassword(expiredResetToken, replacementPassword), BadRequestException);
      await assert.rejects(
        () => auth.current(refreshed.tokens.accessToken),
        (error: unknown) => error instanceof UnauthorizedException,
      );
      await assert.rejects(
        () => auth.login(email, password, { device: "Integration browser" }),
        (error: unknown) => error instanceof UnauthorizedException,
      );
      const replacementLogin = await loginWithoutMfa(email, replacementPassword, "Integration browser");
      const logoutTarget = await loginWithoutMfa(email, replacementPassword, "Logout target");
      await auth.logout(logoutTarget.tokens.accessToken);
      await assert.rejects(
        () => auth.current(logoutTarget.tokens.accessToken),
        (error: unknown) => error instanceof UnauthorizedException,
      );
      const revokedAll = await auth.revokeAllSessions(userId);
      assert.ok(revokedAll.revoked >= 1);
      await assert.rejects(
        () => auth.current(replacementLogin.tokens.accessToken),
        (error: unknown) => error instanceof UnauthorizedException,
      );
      const auditEvents = await db.select().from(securityEvents).where(eq(securityEvents.userId, userId));
      assert.ok(auditEvents.some((event) => event.eventType === "account_registered" && event.outcome === "success"));
      assert.ok(auditEvents.some((event) => event.eventType === "login_password" && event.outcome === "failure"));
      assert.ok(auditEvents.some((event) => event.eventType === "login_password" && event.outcome === "blocked"));
      assert.ok(
        auditEvents.some((event) => event.eventType === "password_reset_completed" && event.outcome === "success"),
      );
      assert.ok(auditEvents.some((event) => event.eventType === "session_revoked"));
      assert.ok(auditEvents.some((event) => event.eventType === "sessions_revoked"));
      assert.ok(auditEvents.every((event) => !JSON.stringify(event).includes(password)));
      assert.ok(auditEvents.every((event) => !JSON.stringify(event).includes(replacementPassword)));
    } finally {
      if (userId) {
        await db
          .delete(authTokens)
          .where(eq(authTokens.userId, userId))
          .catch(() => undefined);
        await db
          .delete(refreshTokens)
          .where(eq(refreshTokens.userId, userId))
          .catch(() => undefined);
        await db
          .delete(userSessions)
          .where(eq(userSessions.userId, userId))
          .catch(() => undefined);
        await db
          .delete(memberships)
          .where(eq(memberships.userId, userId))
          .catch(() => undefined);
      }
      if (organizationId) {
        await db
          .delete(usageLimits)
          .where(eq(usageLimits.organizationId, organizationId))
          .catch(() => undefined);
        await db
          .delete(subscriptions)
          .where(eq(subscriptions.organizationId, organizationId))
          .catch(() => undefined);
        await db
          .delete(workspaces)
          .where(eq(workspaces.organizationId, organizationId))
          .catch(() => undefined);
        await db
          .delete(organizations)
          .where(eq(organizations.id, organizationId))
          .catch(() => undefined);
      }
      if (userId)
        await db
          .delete(users)
          .where(eq(users.id, userId))
          .catch(() => undefined);
      if (previousSecret === undefined) delete process.env.AUTH_TOKEN_SECRET;
      else process.env.AUTH_TOKEN_SECRET = previousSecret;
    }
  });
});
