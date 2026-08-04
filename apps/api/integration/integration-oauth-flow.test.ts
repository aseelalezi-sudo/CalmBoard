import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import { BadRequestException } from "@nestjs/common";
import {
  activities,
  createIntegrationCredentialsRepository,
  db,
  integrationCredentials,
  integrationOauthStates,
  memberships,
  organizations,
  pool,
  subscriptions,
  usageLimits,
  users,
  workspaces,
} from "@calmboard/database";
import { IntegrationOAuthService } from "../src/integration-oauth.service";

process.env.AUTH_TOKEN_SECRET = "integration-connection-oauth-secret-longer-than-thirty-two-bytes";
process.env.INTEGRATION_CREDENTIALS_KEY = Buffer.alloc(32, 23).toString("base64");
process.env.INTEGRATION_CREDENTIALS_ACTIVE_KEY_VERSION = "1";
process.env.API_PUBLIC_URL = "http://localhost:5500";
process.env.APP_URL = "http://localhost:3000";

const providers = ["github", "slack", "gcal", "microsoft"] as const;
for (const provider of providers) {
  const prefix = `INTEGRATION_${provider === "gcal" ? "GOOGLE" : provider.toUpperCase()}`;
  process.env[`${prefix}_OAUTH_ENABLED`] = "true";
  process.env[`${prefix}_CLIENT_ID`] = `${provider}-client-id`;
  process.env[`${prefix}_CLIENT_SECRET`] = `${provider}-client-secret`;
}

after(async () => {
  await pool.end();
});

describe("workspace integration OAuth", () => {
  it("connects all providers with PKCE and one-time tenant-bound state, refreshes, verifies, and revokes", async () => {
    const organizationId = randomUUID();
    const workspaceId = randomUUID();
    const ownerId = randomUUID();
    const context = { organizationId, workspaceId, actorId: ownerId };
    const oauth = new IntegrationOAuthService();
    const previousFetch = globalThis.fetch;
    let activeProvider: (typeof providers)[number] = "github";
    let providerRequests = 0;
    let refreshedGoogleToken = false;
    let slackRevoked = false;

    try {
      await db.insert(users).values({
        id: ownerId,
        email: `integration-oauth-${ownerId}@example.test`,
        name: "Integration OAuth owner",
      });
      await db.insert(organizations).values({
        id: organizationId,
        name: "Integration OAuth tenant",
        slug: `integration-oauth-${organizationId}`,
        ownerId,
      });
      await db.insert(workspaces).values({
        id: workspaceId,
        organizationId,
        name: "Integration OAuth workspace",
        slug: `integration-oauth-${workspaceId}`,
      });
      await db.insert(memberships).values({
        userId: ownerId,
        organizationId,
        role: "owner",
        status: "active",
      });

      globalThis.fetch = async (input, init) => {
        providerRequests += 1;
        const url = String(input);
        const body = new URLSearchParams(String(init?.body ?? ""));

        if (url.includes("/token") || url.includes("access_token") || url.includes("oauth.v2.access")) {
          if (body.get("grant_type") === "refresh_token") {
            assert.equal(activeProvider, "gcal");
            assert.equal(body.get("refresh_token"), "gcal-refresh-token");
            refreshedGoogleToken = true;
            return Response.json({
              access_token: "gcal-refreshed-access-token",
              refresh_token: "gcal-rotated-refresh-token",
              expires_in: 3600,
              scope: "openid email profile https://www.googleapis.com/auth/calendar.events",
            });
          }
          assert.equal(body.get("code"), `${activeProvider}-authorization-code`);
          assert.match(body.get("code_verifier") ?? "", /^[A-Za-z0-9_-]{43,128}$/);
          const token = {
            access_token: `${activeProvider}-access-token`,
            refresh_token: `${activeProvider}-refresh-token`,
            scope: activeProvider === "slack" ? "chat:write,channels:read" : "openid email profile",
            ...(activeProvider === "gcal" ? { expires_in: 1 } : {}),
            ...(activeProvider === "slack" ? { ok: true } : {}),
          };
          return Response.json(token);
        }

        if (url === "https://api.github.com/user") {
          assert.equal(new Headers(init?.headers).get("authorization"), "Bearer github-access-token");
          return Response.json({ id: "github-account-id", login: "calmboard", name: "github account" });
        }
        if (url === "https://slack.com/api/auth.test") {
          return Response.json({
            ok: true,
            team_id: "slack-account-id",
            team: "slack account",
            user_id: "slack-user-id",
          });
        }
        if (url === "https://slack.com/api/auth.revoke") {
          slackRevoked = true;
          return Response.json({ ok: true, revoked: true });
        }
        if (url === "https://openidconnect.googleapis.com/v1/userinfo") {
          const expectedToken = refreshedGoogleToken ? "gcal-refreshed-access-token" : "gcal-access-token";
          assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${expectedToken}`);
          return Response.json({
            sub: "gcal-account-id",
            email: "calendar@example.test",
            name: "gcal account",
          });
        }
        if (url.startsWith("https://graph.microsoft.com/v1.0/me")) {
          return Response.json({
            id: "microsoft-account-id",
            displayName: "microsoft account",
            mail: "microsoft@example.test",
          });
        }
        throw new Error(`Unexpected provider request: ${url}`);
      };

      for (const provider of providers) {
        activeProvider = provider;
        const authorizationUrl = new URL(await oauth.begin(provider, context, "127.0.0.1"));
        assert.equal(authorizationUrl.searchParams.get("response_type"), "code");
        assert.equal(authorizationUrl.searchParams.get("code_challenge_method"), "S256");
        assert.match(authorizationUrl.searchParams.get("code_challenge") ?? "", /^[A-Za-z0-9_-]{43}$/);
        assert.equal(authorizationUrl.searchParams.has("code_verifier"), false);
        const state = authorizationUrl.searchParams.get("state");
        assert.ok(state);
        assert.equal(state.split(".").length, 5);

        const [storedState] = await db
          .select()
          .from(integrationOauthStates)
          .where(eq(integrationOauthStates.provider, provider));
        assert.equal(storedState.stateHash, createHash("sha256").update(state).digest("hex"));
        assert.equal(JSON.stringify(storedState).includes(state), false);
        assert.equal(JSON.stringify(storedState).includes(organizationId), false);

        const requestsBeforeWrongProvider = providerRequests;
        const wrongProvider = provider === "github" ? "slack" : "github";
        await assert.rejects(() => oauth.complete(wrongProvider, state, "wrong-provider-code"), BadRequestException);
        assert.equal(providerRequests, requestsBeforeWrongProvider);

        const result = await oauth.complete(provider, state, `${provider}-authorization-code`);
        assert.equal(result.identity.externalAccountId, `${provider}-account-id`);
        assert.equal(result.identity.displayName, `${provider} account`);
        const requestsAfterComplete = providerRequests;
        await assert.rejects(() => oauth.complete(provider, state, `${provider}-replayed-code`), BadRequestException);
        assert.equal(providerRequests, requestsAfterComplete);
      }

      const credentialRows = await db
        .select()
        .from(integrationCredentials)
        .where(
          and(
            eq(integrationCredentials.organizationId, organizationId),
            eq(integrationCredentials.workspaceId, workspaceId),
          ),
        );
      assert.equal(credentialRows.length, 4);
      assert.equal(JSON.stringify(credentialRows).includes("github-access-token"), false);
      assert.equal(JSON.stringify(credentialRows).includes("gcal-refresh-token"), false);

      activeProvider = "gcal";
      const verifiedGoogle = await oauth.testConnection("gcal", context);
      assert.equal(verifiedGoogle.externalAccountId, "gcal-account-id");
      assert.equal(verifiedGoogle.displayName, "gcal account");
      assert.equal(refreshedGoogleToken, true);
      assert.deepEqual((await createIntegrationCredentialsRepository(context).getForUse("gcal")).secrets, {
        accessToken: "gcal-refreshed-access-token",
        refreshToken: "gcal-rotated-refresh-token",
      });

      activeProvider = "slack";
      const disconnected = await oauth.disconnect("slack", context);
      assert.equal(disconnected.providerRevoked, true);
      assert.equal(slackRevoked, true);
      assert.equal(disconnected.credential.status, "revoked");
    } finally {
      globalThis.fetch = previousFetch;
      await db
        .delete(activities)
        .where(eq(activities.organizationId, organizationId))
        .catch(() => undefined);
      await db
        .delete(integrationCredentials)
        .where(eq(integrationCredentials.organizationId, organizationId))
        .catch(() => undefined);
      await db
        .delete(integrationOauthStates)
        .where(inArray(integrationOauthStates.provider, [...providers]))
        .catch(() => undefined);
      await db
        .delete(memberships)
        .where(eq(memberships.organizationId, organizationId))
        .catch(() => undefined);
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
      await db
        .delete(users)
        .where(eq(users.id, ownerId))
        .catch(() => undefined);
    }
  });
});
