import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { UnauthorizedException } from "@nestjs/common";
import { AuthService } from "../src/auth.service";
import type { AuthEmailService } from "../src/auth-email.service";
import {
  authTokens,
  db,
  generateTotpCode,
  memberships,
  mfaRecoveryCodes,
  organizations,
  pool,
  refreshTokens,
  subscriptions,
  usageLimits,
  userMfaFactors,
  users,
  userSessions,
  workspaces,
} from "@calmboard/database";

after(async () => {
  await pool.end();
});

describe("real TOTP and recovery-code authentication", () => {
  it("encrypts the secret, rejects arbitrary and replayed codes, and gates session creation", async () => {
    const previousAuthSecret = process.env.AUTH_TOKEN_SECRET;
    const previousMfaKey = process.env.MFA_ENCRYPTION_KEY;
    process.env.AUTH_TOKEN_SECRET = "integration-auth-secret-that-is-longer-than-thirty-two-bytes";
    process.env.MFA_ENCRYPTION_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
    const unique = randomUUID();
    const email = `mfa-${unique}@example.test`;
    const password = "Correct horse battery staple 2026!";
    const auth = new AuthService({ send: async () => true } as AuthEmailService);
    let userId: string | undefined;
    let organizationId: string | undefined;

    try {
      const registered = await auth.register(
        {
          email,
          password,
          name: "MFA user",
          organizationName: "MFA organization",
          workspaceName: "MFA workspace",
        },
        { device: "MFA setup browser" },
      );
      userId = registered.user.id;
      const [organization] = await db.select().from(organizations).where(eq(organizations.ownerId, userId));
      organizationId = organization.id;

      const setup = await auth.beginMfaSetup(userId);
      assert.match(setup.secret, /^[A-Z2-7]{32}$/);
      assert.match(setup.uri, /^otpauth:\/\/totp\//);
      const currentCode = generateTotpCode(setup.secret);
      const wrongCode = currentCode === "123456" ? "654321" : "123456";
      await assert.rejects(() => auth.enableMfa(userId!, wrongCode), UnauthorizedException);
      const enabled = await auth.enableMfa(userId, currentCode);
      assert.equal(enabled.recoveryCodes.length, 10);

      const [storedFactor] = await db.select().from(userMfaFactors).where(eq(userMfaFactors.userId, userId));
      assert.equal(storedFactor.status, "enabled");
      assert.notEqual(storedFactor.encryptedTotpSecret, setup.secret);
      assert.equal(storedFactor.encryptionAlgorithm, "aes-256-gcm");
      const storedCodes = await db.select().from(mfaRecoveryCodes).where(eq(mfaRecoveryCodes.userId, userId));
      assert.equal(storedCodes.length, 10);
      assert.ok(storedCodes.every((record) => /^[a-f0-9]{64}$/.test(record.codeHash)));
      assert.ok(storedCodes.every((record) => !enabled.recoveryCodes.includes(record.codeHash)));

      const passwordResult = await auth.login(email, password, { device: "MFA login browser" });
      assert.equal(passwordResult.requiresMfa, true);
      if (!passwordResult.requiresMfa) throw new Error("MFA challenge was not issued");
      assert.equal("tokens" in passwordResult, false);
      await assert.rejects(
        () => auth.completeMfaLogin(passwordResult.challengeToken, wrongCode, { device: "MFA login browser" }),
        UnauthorizedException,
      );
      const recoveryLogin = await auth.completeMfaLogin(passwordResult.challengeToken, enabled.recoveryCodes[0], {
        device: "MFA login browser",
      });
      assert.equal((await auth.current(recoveryLogin.tokens.accessToken)).user.id, userId);
      await assert.rejects(
        () => auth.completeMfaLogin(passwordResult.challengeToken, enabled.recoveryCodes[1], { device: "Replay" }),
        UnauthorizedException,
      );

      const replayedRecoveryChallenge = await auth.login(email, password, { device: "Recovery replay" });
      assert.equal(replayedRecoveryChallenge.requiresMfa, true);
      if (!replayedRecoveryChallenge.requiresMfa) throw new Error("MFA challenge was not issued");
      await assert.rejects(
        () =>
          auth.completeMfaLogin(replayedRecoveryChallenge.challengeToken, enabled.recoveryCodes[0], {
            device: "Replay",
          }),
        UnauthorizedException,
      );

      await db.update(userMfaFactors).set({ lastUsedStep: null }).where(eq(userMfaFactors.userId, userId));
      const totpChallenge = await auth.login(email, password, { device: "TOTP login" });
      assert.equal(totpChallenge.requiresMfa, true);
      if (!totpChallenge.requiresMfa) throw new Error("MFA challenge was not issued");
      const usedTotpCode = generateTotpCode(setup.secret);
      const totpLogin = await auth.completeMfaLogin(totpChallenge.challengeToken, usedTotpCode, {
        device: "TOTP login",
      });
      const totpSession = await auth.current(totpLogin.tokens.accessToken);

      const replayChallenge = await auth.login(email, password, { device: "TOTP replay" });
      assert.equal(replayChallenge.requiresMfa, true);
      if (!replayChallenge.requiresMfa) throw new Error("MFA challenge was not issued");
      await assert.rejects(
        () => auth.completeMfaLogin(replayChallenge.challengeToken, usedTotpCode, { device: "Replay" }),
        UnauthorizedException,
      );

      await auth.disableMfa(userId, totpSession.sessionId, enabled.recoveryCodes[1]);
      assert.equal((await auth.mfaStatus(userId)).enabled, false);
      const withoutMfa = await auth.login(email, password, { device: "Password-only login" });
      assert.equal(withoutMfa.requiresMfa, false);
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
          .delete(mfaRecoveryCodes)
          .where(eq(mfaRecoveryCodes.userId, userId))
          .catch(() => undefined);
        await db
          .delete(userMfaFactors)
          .where(eq(userMfaFactors.userId, userId))
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
      if (previousAuthSecret === undefined) delete process.env.AUTH_TOKEN_SECRET;
      else process.env.AUTH_TOKEN_SECRET = previousAuthSecret;
      if (previousMfaKey === undefined) delete process.env.MFA_ENCRYPTION_KEY;
      else process.env.MFA_ENCRYPTION_KEY = previousMfaKey;
    }
  });
});
