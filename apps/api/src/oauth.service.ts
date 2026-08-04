import { createHash, randomBytes, randomUUID } from "node:crypto";
import { BadGatewayException, BadRequestException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { createOAuthIdentityRepository, type OAuthProfile, type OAuthProvider } from "@calmboard/database";
import { EncryptJWT, jwtDecrypt } from "jose";

const STATE_TTL_SECONDS = 10 * 60;

type ProviderConfiguration = {
  clientId: string;
  clientSecret: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  userInfoEndpoint: string;
};

function enabled(name: string) {
  return process.env[name]?.trim().toLowerCase() === "true";
}

function requiredOAuthSecret(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new ServiceUnavailableException(`${name} is required when this OAuth provider is enabled`);
  return value;
}

function providerConfiguration(provider: OAuthProvider): ProviderConfiguration {
  if (provider === "google") {
    if (!enabled("AUTH_GOOGLE_OAUTH_ENABLED")) throw new ServiceUnavailableException("Google OAuth is disabled");
    return {
      clientId: requiredOAuthSecret("GOOGLE_OAUTH_CLIENT_ID"),
      clientSecret: requiredOAuthSecret("GOOGLE_OAUTH_CLIENT_SECRET"),
      authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenEndpoint: "https://oauth2.googleapis.com/token",
      userInfoEndpoint: "https://openidconnect.googleapis.com/v1/userinfo",
    };
  }

  if (!enabled("AUTH_MICROSOFT_OAUTH_ENABLED")) throw new ServiceUnavailableException("Microsoft OAuth is disabled");
  const tenant = process.env.MICROSOFT_OAUTH_TENANT?.trim() || "common";
  if (!/^[A-Za-z0-9.-]{1,255}$/.test(tenant)) {
    throw new ServiceUnavailableException("MICROSOFT_OAUTH_TENANT is invalid");
  }
  return {
    clientId: requiredOAuthSecret("MICROSOFT_OAUTH_CLIENT_ID"),
    clientSecret: requiredOAuthSecret("MICROSOFT_OAUTH_CLIENT_SECRET"),
    authorizationEndpoint: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`,
    tokenEndpoint: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
    userInfoEndpoint: "https://graph.microsoft.com/oidc/userinfo",
  };
}

function oauthStateKey() {
  const secret = process.env.AUTH_TOKEN_SECRET;
  if (!secret || Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("AUTH_TOKEN_SECRET must contain at least 32 bytes");
  }
  return createHash("sha256").update("calmboard:oauth-state:v1\0").update(secret).digest();
}

function apiPublicUrl() {
  const value = process.env.API_PUBLIC_URL?.trim() || "http://localhost:5500";
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ServiceUnavailableException("API_PUBLIC_URL must be an absolute URL");
  }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new ServiceUnavailableException("API_PUBLIC_URL must be a clean HTTP(S) origin");
  }
  return url.origin;
}

function callbackUrl(provider: OAuthProvider) {
  return `${apiPublicUrl()}/auth/oauth/${provider}/callback`;
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new BadGatewayException("OAuth response is invalid");
  return value as Record<string, unknown>;
}

async function readJson(response: Response) {
  const body = asObject(await response.json().catch(() => null));
  if (!response.ok) throw new BadGatewayException("OAuth provider rejected the request");
  return body;
}

export function oauthProviderAvailability() {
  return {
    google: enabled("AUTH_GOOGLE_OAUTH_ENABLED"),
    microsoft: enabled("AUTH_MICROSOFT_OAUTH_ENABLED"),
  };
}

export function parseOAuthProvider(value: string): OAuthProvider {
  if (value === "google" || value === "microsoft") return value;
  throw new BadRequestException("Unsupported OAuth provider");
}

@Injectable()
export class OAuthService {
  private readonly identities = createOAuthIdentityRepository();

  async begin(provider: OAuthProvider, requestedIp?: string) {
    const configuration = providerConfiguration(provider);
    const verifier = randomBytes(64).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const expiresAt = new Date(Date.now() + STATE_TTL_SECONDS * 1_000);
    const state = await new EncryptJWT({ provider, verifier })
      .setProtectedHeader({ alg: "dir", enc: "A256GCM", typ: "oauth-state+jwt" })
      .setIssuer("calmboard-api")
      .setAudience("calmboard-oauth-callback")
      .setJti(randomUUID())
      .setIssuedAt()
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1_000))
      .encrypt(oauthStateKey());
    await this.identities.createState(provider, state, expiresAt, requestedIp);

    const url = new URL(configuration.authorizationEndpoint);
    url.search = new URLSearchParams({
      client_id: configuration.clientId,
      redirect_uri: callbackUrl(provider),
      response_type: "code",
      scope: "openid email profile",
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
    }).toString();
    if (provider === "microsoft") url.searchParams.set("response_mode", "query");
    return url.toString();
  }

  async complete(provider: OAuthProvider, state: string, code: string): Promise<OAuthProfile> {
    const configuration = providerConfiguration(provider);
    let payload: Record<string, unknown>;
    try {
      const decrypted = await jwtDecrypt(state, oauthStateKey(), {
        issuer: "calmboard-api",
        audience: "calmboard-oauth-callback",
        keyManagementAlgorithms: ["dir"],
        contentEncryptionAlgorithms: ["A256GCM"],
      });
      payload = decrypted.payload;
    } catch {
      throw new BadRequestException("OAuth state is invalid or expired");
    }
    if (payload.provider !== provider || typeof payload.verifier !== "string" || payload.verifier.length < 43) {
      throw new BadRequestException("OAuth state is invalid");
    }
    if (!(await this.identities.consumeState(provider, state))) {
      throw new BadRequestException("OAuth state was already used or has expired");
    }

    const tokenResponse = await fetch(configuration.tokenEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({
        client_id: configuration.clientId,
        client_secret: configuration.clientSecret,
        code,
        code_verifier: payload.verifier,
        grant_type: "authorization_code",
        redirect_uri: callbackUrl(provider),
      }),
      signal: AbortSignal.timeout(10_000),
    }).then(readJson);
    const accessToken = tokenResponse.access_token;
    if (typeof accessToken !== "string" || !accessToken)
      throw new BadGatewayException("OAuth token response is incomplete");

    const userInfo = await fetch(configuration.userInfoEndpoint, {
      headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    }).then(readJson);
    const subject = userInfo.sub;
    const email = userInfo.email;
    if (typeof subject !== "string" || !subject || subject.length > 255) {
      throw new BadGatewayException("OAuth identity subject is missing");
    }
    if (typeof email !== "string" || email.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new BadGatewayException("OAuth provider did not return a usable email address");
    }
    const name = typeof userInfo.name === "string" && userInfo.name.trim() ? userInfo.name.trim().slice(0, 255) : email;
    const picture = typeof userInfo.picture === "string" ? userInfo.picture.slice(0, 2_000) : null;
    return {
      provider,
      subject,
      email: email.toLowerCase(),
      name,
      avatarUrl: picture,
      emailVerified: provider === "google" && userInfo.email_verified === true,
    };
  }
}
