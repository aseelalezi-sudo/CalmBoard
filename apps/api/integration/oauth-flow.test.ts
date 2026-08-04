import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { BadRequestException, ConflictException } from "@nestjs/common";
import {
  authTokens,
  db,
  generateTotpCode,
  memberships,
  mfaRecoveryCodes,
  oauthIdentities,
  oauthLoginStates,
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
import { AuthService } from "../src/auth.service";
import type { AuthEmailService } from "../src/auth-email.service";
import { OAuthService } from "../src/oauth.service";

after(async () => {
  await pool.end();
});

describe("OAuth Authorization Code login", () => {
  it("uses PKCE and one-time encrypted state, discards provider tokens, and preserves local MFA", async () => {
    const environmentNames = [
      "AUTH_TOKEN_SECRET",
      "MFA_ENCRYPTION_KEY",
      "API_PUBLIC_URL",
      "AUTH_GOOGLE_OAUTH_ENABLED",
      "GOOGLE_OAUTH_CLIENT_ID",
      "GOOGLE_OAUTH_CLIENT_SECRET",
      "AUTH_MICROSOFT_OAUTH_ENABLED",
    ] as const;
    const previousEnvironment = Object.fromEntries(environmentNames.map((name) => [name, process.env[name]]));
    const previousFetch = globalThis.fetch;
    process.env.AUTH_TOKEN_SECRET = "integration-oauth-secret-that-is-longer-than-thirty-two-bytes";
    process.env.MFA_ENCRYPTION_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
    process.env.API_PUBLIC_URL = "http://localhost:5500";
    process.env.AUTH_GOOGLE_OAUTH_ENABLED = "true";
    process.env.GOOGLE_OAUTH_CLIENT_ID = "google-client-id";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "google-client-secret";
    process.env.AUTH_MICROSOFT_OAUTH_ENABLED = "false";
    const unique = randomUUID();
    const email = `oauth-${unique}@example.test`;
    const oauth = new OAuthService();
    const auth = new AuthService({ send: async () => true } as unknown as AuthEmailService);
    let userId: string | undefined;
    let organizationId: string | undefined;

    try {
      const authorizationUrl = new URL(await oauth.begin("google", "127.0.0.1"));
      assert.equal(authorizationUrl.origin, "https://accounts.google.com");
      assert.equal(authorizationUrl.searchParams.get("response_type"), "code");
      assert.equal(authorizationUrl.searchParams.get("code_challenge_method"), "S256");
      assert.match(authorizationUrl.searchParams.get("code_challenge") ?? "", /^[A-Za-z0-9_-]{43}$/);
      assert.equal(authorizationUrl.searchParams.has("code_verifier"), false);
      const state = authorizationUrl.searchParams.get("state");
      assert.ok(state);
      assert.equal(state.split(".").length, 5);

      const [storedState] = await db.select().from(oauthLoginStates).where(eq(oauthLoginStates.provider, "google"));
      assert.equal(storedState.stateHash, createHash("sha256").update(state).digest("hex"));
      assert.equal(JSON.stringify(storedState).includes(state), false);

      let providerRequests = 0;
      globalThis.fetch = async (input, init) => {
        providerRequests += 1;
        const url = String(input);
        if (url === "https://oauth2.googleapis.com/token") {
          const body = new URLSearchParams(String(init?.body));
          assert.equal(body.get("code"), "authorization-code");
          assert.match(body.get("code_verifier") ?? "", /^[A-Za-z0-9_-]{43,128}$/);
          return Response.json({ access_token: "ephemeral-provider-access-token", token_type: "Bearer" });
        }
        assert.equal(url, "https://openidconnect.googleapis.com/v1/userinfo");
        assert.equal(new Headers(init?.headers).get("authorization"), "Bearer ephemeral-provider-access-token");
        return Response.json({
          sub: `google-${unique}`,
          email,
          email_verified: true,
          name: "OAuth user",
          picture: "https://example.test/avatar.png",
        });
      };

      const profile = await oauth.complete("google", state, "authorization-code");
      assert.equal(profile.emailVerified, true);
      assert.equal(providerRequests, 2);
      await assert.rejects(() => oauth.complete("google", state, "replayed-code"), BadRequestException);
      assert.equal(providerRequests, 2);

      const firstLogin = await auth.oauthLogin(profile, { device: "OAuth browser" });
      assert.equal(firstLogin.requiresMfa, false);
      if (firstLogin.requiresMfa) throw new Error("MFA was unexpectedly required");
      userId = firstLogin.user.id;
      assert.equal((await auth.current(firstLogin.tokens.accessToken)).user.id, userId);
      const [storedUser] = await db.select().from(users).where(eq(users.id, userId));
      assert.equal(storedUser.passwordHash, null);
      assert.ok(storedUser.emailVerifiedAt);
      const [storedIdentity] = await db.select().from(oauthIdentities).where(eq(oauthIdentities.userId, userId));
      assert.equal(storedIdentity.providerSubject, profile.subject);
      assert.equal(JSON.stringify(storedIdentity).includes("ephemeral-provider-access-token"), false);
      const [organization] = await db.select().from(organizations).where(eq(organizations.ownerId, userId));
      organizationId = organization.id;

      const setup = await auth.beginMfaSetup(userId);
      const enabledMfa = await auth.enableMfa(userId, generateTotpCode(setup.secret));
      const protectedLogin = await auth.oauthLogin(profile, { device: "OAuth MFA browser" });
      assert.equal(protectedLogin.requiresMfa, true);
      if (!protectedLogin.requiresMfa) throw new Error("OAuth bypassed MFA");
      assert.equal("tokens" in protectedLogin, false);
      const completed = await auth.completeMfaLogin(protectedLogin.challengeToken, enabledMfa.recoveryCodes[0], {
        device: "OAuth MFA browser",
      });
      assert.equal((await auth.current(completed.tokens.accessToken)).user.id, userId);

      await assert.rejects(
        () =>
          auth.oauthLogin(
            {
              provider: "microsoft",
              subject: `microsoft-${unique}`,
              email,
              name: "Conflicting account",
              emailVerified: false,
            },
            { device: "Collision attempt" },
          ),
        ConflictException,
      );
    } finally {
      globalThis.fetch = previousFetch;
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
          .delete(oauthIdentities)
          .where(eq(oauthIdentities.userId, userId))
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
      await db
        .delete(oauthLoginStates)
        .where(eq(oauthLoginStates.provider, "google"))
        .catch(() => undefined);
      for (const name of environmentNames) {
        const previous = previousEnvironment[name];
        if (previous === undefined) delete process.env[name];
        else process.env[name] = previous;
      }
    }
  });
});
