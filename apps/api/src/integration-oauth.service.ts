import { createHash, randomBytes, randomUUID } from "node:crypto";
import { BadGatewayException, BadRequestException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import {
  createActivitiesRepository,
  createIntegrationCredentialsRepository,
  createIntegrationOAuthStateRepository,
  type DatabaseTenantContext,
  type IntegrationOAuthProvider,
  withDatabaseContext,
} from "@calmboard/database";
import { EncryptJWT, jwtDecrypt } from "jose";

const STATE_TTL_SECONDS = 10 * 60;
const REFRESH_SKEW_MILLISECONDS = 60_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ProviderConfiguration = {
  clientId: string;
  clientSecret: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  requestedScopes: string[];
  scopeSeparator: " " | ",";
};

type OAuthToken = {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  scopes: string[];
  raw: Record<string, unknown>;
};

export type IntegrationOAuthIdentity = {
  externalAccountId: string;
  displayName: string;
  metadata: Record<string, string>;
};

function enabled(name: string) {
  return process.env[name]?.trim().toLowerCase() === "true";
}

function requiredProviderSecret(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new ServiceUnavailableException(`${name} is required when this integration is enabled`);
  return value;
}

function scopesFromEnvironment(name: string, fallback: string[]) {
  const value = process.env[name]?.trim();
  if (!value) return fallback;
  const scopes = value
    .split(/[\s,]+/)
    .map((scope) => scope.trim())
    .filter(Boolean);
  if (!scopes.length || scopes.length > 30 || scopes.some((scope) => scope.length > 200)) {
    throw new ServiceUnavailableException(`${name} is invalid`);
  }
  return [...new Set(scopes)];
}

function providerConfiguration(provider: IntegrationOAuthProvider): ProviderConfiguration {
  const prefix = `INTEGRATION_${provider === "gcal" ? "GOOGLE" : provider.toUpperCase()}`;
  if (!enabled(`${prefix}_OAUTH_ENABLED`)) {
    throw new ServiceUnavailableException(`${provider} OAuth integration is disabled`);
  }
  const clientId = requiredProviderSecret(`${prefix}_CLIENT_ID`);
  const clientSecret = requiredProviderSecret(`${prefix}_CLIENT_SECRET`);

  if (provider === "github") {
    return {
      clientId,
      clientSecret,
      authorizationEndpoint: "https://github.com/login/oauth/authorize",
      tokenEndpoint: "https://github.com/login/oauth/access_token",
      requestedScopes: scopesFromEnvironment(`${prefix}_SCOPES`, ["read:user", "repo"]),
      scopeSeparator: " ",
    };
  }
  if (provider === "slack") {
    return {
      clientId,
      clientSecret,
      authorizationEndpoint: "https://slack.com/oauth/v2/authorize",
      tokenEndpoint: "https://slack.com/api/oauth.v2.access",
      requestedScopes: scopesFromEnvironment(`${prefix}_SCOPES`, ["chat:write", "channels:read"]),
      scopeSeparator: ",",
    };
  }
  if (provider === "gcal") {
    return {
      clientId,
      clientSecret,
      authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenEndpoint: "https://oauth2.googleapis.com/token",
      requestedScopes: scopesFromEnvironment(`${prefix}_SCOPES`, [
        "openid",
        "email",
        "profile",
        "https://www.googleapis.com/auth/calendar.events",
      ]),
      scopeSeparator: " ",
    };
  }

  const tenant = process.env.INTEGRATION_MICROSOFT_TENANT?.trim() || "common";
  if (!/^[A-Za-z0-9.-]{1,255}$/.test(tenant)) {
    throw new ServiceUnavailableException("INTEGRATION_MICROSOFT_TENANT is invalid");
  }
  return {
    clientId,
    clientSecret,
    authorizationEndpoint: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`,
    tokenEndpoint: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
    requestedScopes: scopesFromEnvironment(`${prefix}_SCOPES`, [
      "openid",
      "profile",
      "email",
      "offline_access",
      "User.Read",
      "Calendars.ReadWrite",
    ]),
    scopeSeparator: " ",
  };
}

function cleanOrigin(name: string, fallback: string) {
  const value = process.env[name]?.trim() || fallback;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ServiceUnavailableException(`${name} must be an absolute URL`);
  }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new ServiceUnavailableException(`${name} must be a clean HTTP(S) origin`);
  }
  return url.origin;
}

function callbackUrl(provider: IntegrationOAuthProvider) {
  return `${cleanOrigin("API_PUBLIC_URL", "http://localhost:5500")}/integrations/oauth/${provider}/callback`;
}

export function integrationOAuthAppUrl(
  provider: IntegrationOAuthProvider,
  status: "success" | "error",
  reason?: string,
) {
  const url = new URL(cleanOrigin("APP_URL", "http://localhost:3000"));
  url.searchParams.set("integration_oauth", status);
  url.searchParams.set("provider", provider);
  if (reason) url.searchParams.set("reason", reason.slice(0, 80));
  return url.toString();
}

function stateKey() {
  const secret = process.env.AUTH_TOKEN_SECRET;
  if (!secret || Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("AUTH_TOKEN_SECRET must contain at least 32 bytes");
  }
  return createHash("sha256").update("calmboard:integration-oauth-state:v1\0").update(secret).digest();
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BadGatewayException("OAuth provider response is invalid");
  }
  return value as Record<string, unknown>;
}

async function readProviderJson(response: Response, provider: IntegrationOAuthProvider) {
  const body = asObject(await response.json().catch(() => null));
  if (!response.ok || (provider === "slack" && body.ok !== true)) {
    throw new BadGatewayException("OAuth provider rejected the request");
  }
  return body;
}

function splitScopes(value: unknown, fallback: string[]) {
  if (typeof value !== "string") return fallback;
  return [...new Set(value.split(/[\s,]+/).filter(Boolean))];
}

function parseToken(
  provider: IntegrationOAuthProvider,
  body: Record<string, unknown>,
  fallbackScopes: string[],
): OAuthToken {
  const accessToken = body.access_token;
  if (typeof accessToken !== "string" || !accessToken) {
    throw new BadGatewayException("OAuth token response is incomplete");
  }
  const refreshToken = typeof body.refresh_token === "string" && body.refresh_token ? body.refresh_token : undefined;
  const expiresIn = typeof body.expires_in === "number" ? body.expires_in : Number(body.expires_in);
  const expiresAt = Number.isFinite(expiresIn) && expiresIn > 0 ? new Date(Date.now() + expiresIn * 1_000) : undefined;
  return {
    accessToken,
    ...(refreshToken ? { refreshToken } : {}),
    ...(expiresAt ? { expiresAt } : {}),
    scopes: splitScopes(body.scope, fallbackScopes),
    raw: body,
  };
}

async function exchangeCode(
  provider: IntegrationOAuthProvider,
  configuration: ProviderConfiguration,
  code: string,
  verifier: string,
) {
  const body = new URLSearchParams({
    client_id: configuration.clientId,
    client_secret: configuration.clientSecret,
    code,
    code_verifier: verifier,
    grant_type: "authorization_code",
    redirect_uri: callbackUrl(provider),
  });
  const response = await fetch(configuration.tokenEndpoint, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  return parseToken(provider, await readProviderJson(response, provider), configuration.requestedScopes);
}

async function refreshAccessToken(
  provider: IntegrationOAuthProvider,
  configuration: ProviderConfiguration,
  refreshToken: string,
) {
  const response = await fetch(configuration.tokenEndpoint, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: configuration.clientId,
      client_secret: configuration.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(10_000),
  });
  return parseToken(provider, await readProviderJson(response, provider), configuration.requestedScopes);
}

function safeString(value: unknown, fallback: string, maximum = 255) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, maximum) : fallback;
}

export async function fetchIntegrationOAuthIdentity(
  provider: IntegrationOAuthProvider,
  accessToken: string,
): Promise<IntegrationOAuthIdentity> {
  const headers = { authorization: `Bearer ${accessToken}`, accept: "application/json" };
  if (provider === "github") {
    const response = await fetch("https://api.github.com/user", {
      headers: { ...headers, "user-agent": "CalmBoard-OAuth" },
      signal: AbortSignal.timeout(10_000),
    });
    const body = await readProviderJson(response, provider);
    if ((typeof body.id !== "number" && typeof body.id !== "string") || typeof body.login !== "string") {
      throw new BadGatewayException("GitHub identity response is incomplete");
    }
    return {
      externalAccountId: String(body.id).slice(0, 255),
      displayName: safeString(body.name, body.login, 160),
      metadata: { login: body.login.slice(0, 255) },
    };
  }
  if (provider === "slack") {
    const response = await fetch("https://slack.com/api/auth.test", {
      method: "POST",
      headers,
      signal: AbortSignal.timeout(10_000),
    });
    const body = await readProviderJson(response, provider);
    const accountId = typeof body.team_id === "string" ? body.team_id : body.enterprise_id;
    if (typeof accountId !== "string" || !accountId) {
      throw new BadGatewayException("Slack identity response is incomplete");
    }
    return {
      externalAccountId: accountId.slice(0, 255),
      displayName: safeString(body.team, "Slack workspace", 160),
      metadata: {
        ...(typeof body.user_id === "string" ? { userId: body.user_id.slice(0, 255) } : {}),
        ...(typeof body.url === "string" ? { url: body.url.slice(0, 2_000) } : {}),
      },
    };
  }
  if (provider === "gcal") {
    const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers,
      signal: AbortSignal.timeout(10_000),
    });
    const body = await readProviderJson(response, provider);
    if (typeof body.sub !== "string" || !body.sub) {
      throw new BadGatewayException("Google identity response is incomplete");
    }
    const email = safeString(body.email, "Google Calendar account");
    return {
      externalAccountId: body.sub.slice(0, 255),
      displayName: safeString(body.name, email, 160),
      metadata: typeof body.email === "string" ? { email: body.email.slice(0, 255) } : {},
    };
  }
  const response = await fetch("https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName", {
    headers,
    signal: AbortSignal.timeout(10_000),
  });
  const body = await readProviderJson(response, provider);
  if (typeof body.id !== "string" || !body.id) {
    throw new BadGatewayException("Microsoft identity response is incomplete");
  }
  const email = safeString(body.mail, safeString(body.userPrincipalName, "Microsoft account"));
  return {
    externalAccountId: body.id.slice(0, 255),
    displayName: safeString(body.displayName, email, 160),
    metadata: email === "Microsoft account" ? {} : { email: email.slice(0, 255) },
  };
}

async function revokeAtProvider(
  provider: IntegrationOAuthProvider,
  configuration: ProviderConfiguration,
  accessToken: string,
) {
  if (provider === "microsoft") return false;
  let response: Response;
  if (provider === "github") {
    response = await fetch(`https://api.github.com/applications/${encodeURIComponent(configuration.clientId)}/grant`, {
      method: "DELETE",
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Basic ${Buffer.from(`${configuration.clientId}:${configuration.clientSecret}`).toString("base64")}`,
        "content-type": "application/json",
        "user-agent": "CalmBoard-OAuth",
      },
      body: JSON.stringify({ access_token: accessToken }),
      signal: AbortSignal.timeout(10_000),
    });
  } else if (provider === "slack") {
    response = await fetch("https://slack.com/api/auth.revoke", {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    const body = await readProviderJson(response, provider);
    return body.ok === true;
  } else {
    response = await fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: accessToken }),
      signal: AbortSignal.timeout(10_000),
    });
  }
  return response.ok;
}

export function integrationOAuthProviderAvailability() {
  return {
    github: enabled("INTEGRATION_GITHUB_OAUTH_ENABLED"),
    slack: enabled("INTEGRATION_SLACK_OAUTH_ENABLED"),
    gcal: enabled("INTEGRATION_GOOGLE_OAUTH_ENABLED"),
    microsoft: enabled("INTEGRATION_MICROSOFT_OAUTH_ENABLED"),
  };
}

export function parseIntegrationOAuthProvider(value: string): IntegrationOAuthProvider {
  if (value === "github" || value === "slack" || value === "gcal" || value === "microsoft") return value;
  throw new BadRequestException("Unsupported integration OAuth provider");
}

@Injectable()
export class IntegrationOAuthService {
  private readonly states = createIntegrationOAuthStateRepository();

  async begin(provider: IntegrationOAuthProvider, context: DatabaseTenantContext, requestedIp?: string) {
    const configuration = providerConfiguration(provider);
    if (!context.organizationId || !context.workspaceId || !context.actorId) {
      throw new BadRequestException("A complete tenant context is required");
    }
    const verifier = randomBytes(64).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const expiresAt = new Date(Date.now() + STATE_TTL_SECONDS * 1_000);
    const state = await new EncryptJWT({
      provider,
      verifier,
      organizationId: context.organizationId,
      workspaceId: context.workspaceId,
      actorId: context.actorId,
    })
      .setProtectedHeader({ alg: "dir", enc: "A256GCM", typ: "integration-oauth-state+jwt" })
      .setIssuer("calmboard-api")
      .setAudience("calmboard-integration-oauth-callback")
      .setJti(randomUUID())
      .setIssuedAt()
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1_000))
      .encrypt(stateKey());
    await this.states.createState(provider, state, expiresAt, requestedIp);

    const url = new URL(configuration.authorizationEndpoint);
    url.search = new URLSearchParams({
      client_id: configuration.clientId,
      redirect_uri: callbackUrl(provider),
      response_type: "code",
      scope: configuration.requestedScopes.join(configuration.scopeSeparator),
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
    }).toString();
    if (provider === "gcal") {
      url.searchParams.set("access_type", "offline");
      url.searchParams.set("include_granted_scopes", "true");
      url.searchParams.set("prompt", "consent");
    }
    if (provider === "microsoft") url.searchParams.set("response_mode", "query");
    return url.toString();
  }

  async complete(provider: IntegrationOAuthProvider, state: string, code: string) {
    const configuration = providerConfiguration(provider);
    let payload: Record<string, unknown>;
    try {
      const decrypted = await jwtDecrypt(state, stateKey(), {
        issuer: "calmboard-api",
        audience: "calmboard-integration-oauth-callback",
        keyManagementAlgorithms: ["dir"],
        contentEncryptionAlgorithms: ["A256GCM"],
      });
      payload = decrypted.payload;
    } catch {
      throw new BadRequestException("Integration OAuth state is invalid or expired");
    }
    const organizationId = payload.organizationId;
    const workspaceId = payload.workspaceId;
    const actorId = payload.actorId;
    const verifier = payload.verifier;
    if (
      payload.provider !== provider ||
      typeof verifier !== "string" ||
      verifier.length < 43 ||
      typeof organizationId !== "string" ||
      !UUID_PATTERN.test(organizationId) ||
      typeof workspaceId !== "string" ||
      !UUID_PATTERN.test(workspaceId) ||
      typeof actorId !== "string" ||
      !UUID_PATTERN.test(actorId)
    ) {
      throw new BadRequestException("Integration OAuth state is invalid");
    }
    if (!(await this.states.consumeState(provider, state))) {
      throw new BadRequestException("Integration OAuth state was already used or has expired");
    }

    const token = await exchangeCode(provider, configuration, code, verifier);
    const identity = await fetchIntegrationOAuthIdentity(provider, token.accessToken);
    const context = { organizationId, workspaceId, actorId };
    return withDatabaseContext(context, async () => {
      const credential = await createIntegrationCredentialsRepository(context).save({
        provider,
        displayName: identity.displayName,
        authType: "oauth2",
        secrets: {
          accessToken: token.accessToken,
          ...(token.refreshToken ? { refreshToken: token.refreshToken } : {}),
        },
        externalAccountId: identity.externalAccountId,
        scopes: token.scopes,
        metadata: identity.metadata,
        expiresAt: token.expiresAt,
      });
      await createActivitiesRepository(context).create({
        actorId,
        action: `integration.${provider}.connected`,
        entityType: "integration_credential",
        entityId: credential.id,
        newValues: { provider, externalAccountId: identity.externalAccountId, scopes: token.scopes },
      });
      return { credential, identity };
    });
  }

  private async accessToken(provider: IntegrationOAuthProvider, context: DatabaseTenantContext) {
    const configuration = providerConfiguration(provider);
    const repository = createIntegrationCredentialsRepository(context);
    const current = await repository.getOAuthForRefresh(provider);
    const expiresAt = current.credential.expiresAt;
    if (!expiresAt || expiresAt.getTime() > Date.now() + REFRESH_SKEW_MILLISECONDS) {
      return (await repository.getForUse(provider)).secrets.accessToken;
    }
    const refreshToken = current.secrets.refreshToken;
    if (!refreshToken) throw new BadRequestException("The OAuth access token expired and cannot be refreshed");
    const refreshed = await refreshAccessToken(provider, configuration, refreshToken);
    await repository.save({
      provider,
      credentialKey: current.credential.credentialKey,
      displayName: current.credential.displayName,
      authType: "oauth2",
      secrets: {
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken ?? refreshToken,
      },
      externalAccountId: current.credential.externalAccountId,
      scopes: refreshed.scopes.length ? refreshed.scopes : current.credential.scopes,
      metadata: current.credential.metadata,
      expiresAt: refreshed.expiresAt,
    });
    return (await repository.getForUse(provider)).secrets.accessToken;
  }

  async testConnection(provider: IntegrationOAuthProvider, context: DatabaseTenantContext) {
    const accessToken = await this.accessToken(provider, context);
    return fetchIntegrationOAuthIdentity(provider, accessToken);
  }

  async disconnect(provider: IntegrationOAuthProvider, context: DatabaseTenantContext) {
    const repository = createIntegrationCredentialsRepository(context);
    const current = await repository.getOAuthForRefresh(provider);
    let providerRevoked = false;
    try {
      const configuration = providerConfiguration(provider);
      providerRevoked = await revokeAtProvider(provider, configuration, current.secrets.accessToken);
    } catch {
      providerRevoked = false;
    }
    const credential = await repository.revoke(current.credential.id);
    await createActivitiesRepository(context).create({
      actorId: context.actorId!,
      action: `integration.${provider}.disconnected`,
      entityType: "integration_credential",
      entityId: credential.id,
      oldValues: { provider, providerRevoked },
    });
    return { credential, providerRevoked };
  }
}
