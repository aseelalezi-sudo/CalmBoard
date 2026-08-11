import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import {
  createAuthIdentityRepository,
  createAuthSessionsRepository,
  createAuthTokensRepository,
  createMfaRepository,
  createOAuthIdentityRepository,
  createSecurityEventsRepository,
  InvalidAuthSessionError,
  type OAuthProfile,
} from "@calmboard/database";
import { argon2id, hash, verify } from "argon2";
import { SignJWT, jwtVerify } from "jose";
import { AuthEmailService, type AuthEmailPurpose } from "./auth-email.service.js";

const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const ARGON2_OPTIONS = { type: argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;
let dummyPasswordHashPromise: Promise<string> | undefined;

function dummyPasswordHash() {
  dummyPasswordHashPromise ??= hash("CalmBoard timing equalization credential", ARGON2_OPTIONS);
  return dummyPasswordHashPromise;
}

export type AuthClient = {
  device: string;
  browser?: string | null;
  userAgent?: string;
  ip?: string;
};

export type RegisterInput = {
  email: string;
  name: string;
  password: string;
  organizationName: string;
  workspaceName: string;
};

function accessTokenSecret() {
  const value = process.env.AUTH_TOKEN_SECRET;
  if (!value || Buffer.byteLength(value, "utf8") < 32) {
    throw new Error("AUTH_TOKEN_SECRET must contain at least 32 bytes");
  }
  return new TextEncoder().encode(value);
}

function isUniqueViolation(error: unknown) {
  const cause = (error as { cause?: { code?: string } }).cause;
  return cause?.code === "23505" || (error as { code?: string }).code === "23505";
}

@Injectable()
export class AuthService {
  private readonly identities = createAuthIdentityRepository();
  private readonly sessions = createAuthSessionsRepository();
  private readonly authTokens = createAuthTokensRepository();
  private readonly mfa = createMfaRepository();
  private readonly oauthIdentities = createOAuthIdentityRepository();
  private readonly securityEvents = createSecurityEventsRepository();

  constructor(@Inject(AuthEmailService) private readonly authEmail: AuthEmailService = new AuthEmailService()) {}

  private passwordHash(password: string) {
    return hash(password, ARGON2_OPTIONS);
  }

  private async sendAuthEmail(
    identity: { id: string; email: string; name: string },
    purpose: AuthEmailPurpose,
    requestedIp?: string,
  ) {
    try {
      return await this.authEmail.send({
        purpose,
        userId: identity.id,
        email: identity.email,
        name: identity.name,
        requestedIp,
      });
    } catch {
      console.error("Authentication email delivery failed");
      return false;
    }
  }

  private async accessToken(userId: string, sessionId: string) {
    return new SignJWT({ type: "access", sid: sessionId })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setSubject(userId)
      .setIssuer("calmboard-api")
      .setAudience("calmboard-web")
      .setIssuedAt()
      .setExpirationTime(`${ACCESS_TOKEN_TTL_SECONDS}s`)
      .sign(accessTokenSecret());
  }

  private async createSession(userId: string, client: AuthClient) {
    const result = await this.sessions.create({
      userId,
      device: client.device,
      browser: client.browser,
      userAgent: client.userAgent,
      ip: client.ip,
    });
    return {
      accessToken: await this.accessToken(userId, result.session.id),
      refreshToken: result.refreshToken,
      accessMaxAge: ACCESS_TOKEN_TTL_SECONDS,
      refreshExpiresAt: result.refreshExpiresAt,
    };
  }

  async register(input: RegisterInput, client: AuthClient) {
    if (await this.identities.findByEmail(input.email)) throw new ConflictException("Email is already registered");
    const passwordHash = await this.passwordHash(input.password);
    try {
      const identity = await this.identities.register({ ...input, passwordHash });
      const [tokens, verificationEmailSent] = await Promise.all([
        this.createSession(identity.user.id, client),
        this.sendAuthEmail(identity.user, "email_verification", client.ip),
      ]);
      await this.securityEvents.record({
        userId: identity.user.id,
        email: identity.user.email,
        eventType: "account_registered",
        outcome: "success",
        ip: client.ip,
        userAgent: client.userAgent,
      });
      return { user: identity.user, tokens, verificationEmailSent };
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException("Email is already registered");
      throw error;
    }
  }

  async login(email: string, password: string, client: AuthClient) {
    const identity = await this.identities.findByEmail(email);
    const passwordMatches = await verify(identity?.passwordHash ?? (await dummyPasswordHash()), password).catch(
      () => false,
    );
    const locked = Boolean(identity?.lockedUntil && identity.lockedUntil > new Date());
    if (!identity?.passwordHash || !passwordMatches) {
      if (identity?.passwordHash && !locked) await this.identities.recordLoginFailure(identity.id);
      await this.securityEvents.record({
        userId: identity?.id,
        email,
        eventType: "login_password",
        outcome: locked ? "blocked" : "failure",
        ip: client.ip,
        userAgent: client.userAgent,
      });
      throw new UnauthorizedException("Invalid email or password");
    }
    if (!["active", "deletion_pending"].includes(identity.lifecycleState)) {
      throw new UnauthorizedException("Invalid email or password");
    }
    if (locked) {
      const retryAfter = Math.max(1, Math.ceil((identity.lockedUntil!.getTime() - Date.now()) / 1_000));
      await this.securityEvents.record({
        userId: identity.id,
        email,
        eventType: "login_password",
        outcome: "blocked",
        ip: client.ip,
        userAgent: client.userAgent,
        metadata: { retryAfter },
      });
      throw new HttpException(
        { error: "Account is temporarily locked", statusCode: HttpStatus.LOCKED, retryAfter },
        HttpStatus.LOCKED,
      );
    }
    const {
      passwordHash: _passwordHash,
      failedLoginAttempts: _failedLoginAttempts,
      lockedUntil: _lockedUntil,
      ...user
    } = identity;
    if (await this.mfa.isEnabled(user.id)) {
      const challenge = await this.authTokens.issue(user.id, "mfa_login", client.ip);
      await this.securityEvents.record({
        userId: user.id,
        email,
        eventType: "login_password",
        outcome: "challenge",
        ip: client.ip,
        userAgent: client.userAgent,
        metadata: { challenge: "mfa" },
      });
      return {
        requiresMfa: true as const,
        challengeToken: challenge.token,
        challengeExpiresAt: challenge.expiresAt,
      };
    }
    await this.identities.recordLoginSuccess(identity.id);
    const tokens = await this.createSession(user.id, client);
    await this.securityEvents.record({
      userId: user.id,
      email,
      eventType: "login_password",
      outcome: "success",
      ip: client.ip,
      userAgent: client.userAgent,
    });
    return { requiresMfa: false as const, user, tokens };
  }

  async completeMfaLogin(challengeToken: string, code: string, client: AuthClient) {
    const challenge = await this.authTokens.findMfaChallenge(challengeToken);
    if (!challenge || !(await this.mfa.verify(challenge.userId, code))) {
      if (challenge?.userId || client.ip) {
        await this.securityEvents.record({
          userId: challenge?.userId,
          eventType: "login_mfa",
          outcome: "failure",
          ip: client.ip,
          userAgent: client.userAgent,
        });
      }
      throw new UnauthorizedException("MFA challenge or code is invalid");
    }
    const consumed = await this.authTokens.consumeMfaChallenge(challengeToken, challenge.userId);
    if (!consumed) throw new UnauthorizedException("MFA challenge is invalid or expired");
    const user = await this.identities.findPublicUser(challenge.userId);
    if (!user) throw new UnauthorizedException("Authentication user no longer exists");
    await this.identities.recordLoginSuccess(user.id);
    const tokens = await this.createSession(user.id, client);
    await this.securityEvents.record({
      userId: user.id,
      eventType: "login_mfa",
      outcome: "success",
      ip: client.ip,
      userAgent: client.userAgent,
    });
    return { user, tokens };
  }

  async oauthLogin(profile: OAuthProfile, client: AuthClient) {
    let identity = await this.oauthIdentities.findByProviderSubject(profile.provider, profile.subject);
    if (!identity) {
      const existingUser = await this.identities.findByEmail(profile.email);
      if (existingUser) {
        if (profile.provider !== "google" || !profile.emailVerified) {
          await this.securityEvents.record({
            userId: existingUser.id,
            email: profile.email,
            eventType: "login_oauth",
            outcome: "blocked",
            provider: profile.provider,
            ip: client.ip,
            userAgent: client.userAgent,
            metadata: { reason: "existing_account_requires_link" },
          });
          throw new ConflictException(
            "This email already has an account. Sign in with the existing method before linking this provider",
          );
        }
        try {
          await this.oauthIdentities.linkExistingUser(existingUser.id, profile);
        } catch (error) {
          if (isUniqueViolation(error)) throw new ConflictException("This OAuth identity is already linked");
          throw error;
        }
        identity = await this.oauthIdentities.findByProviderSubject(profile.provider, profile.subject);
      } else {
        try {
          const created = await this.oauthIdentities.registerExternal(profile);
          identity = await this.oauthIdentities.findByProviderSubject(profile.provider, profile.subject);
          if (!identity) throw new UnauthorizedException(`OAuth identity for ${created.user.id} could not be resolved`);
        } catch (error) {
          if (isUniqueViolation(error))
            throw new ConflictException("This email or OAuth identity is already registered");
          throw error;
        }
      }
    }
    if (!identity) throw new UnauthorizedException("OAuth identity could not be resolved");
    const { oauthIdentityId, ...user } = identity;
    if (!["active", "deletion_pending"].includes(user.lifecycleState)) {
      throw new UnauthorizedException("OAuth identity could not be resolved");
    }
    if (await this.mfa.isEnabled(user.id)) {
      const challenge = await this.authTokens.issue(user.id, "mfa_login", client.ip);
      await this.securityEvents.record({
        userId: user.id,
        email: profile.email,
        eventType: "login_oauth",
        outcome: "challenge",
        provider: profile.provider,
        ip: client.ip,
        userAgent: client.userAgent,
        metadata: { challenge: "mfa" },
      });
      return {
        requiresMfa: true as const,
        challengeToken: challenge.token,
        challengeExpiresAt: challenge.expiresAt,
      };
    }
    await this.oauthIdentities.recordLogin(user.id, oauthIdentityId);
    const tokens = await this.createSession(user.id, client);
    await this.securityEvents.record({
      userId: user.id,
      email: profile.email,
      eventType: "login_oauth",
      outcome: "success",
      provider: profile.provider,
      ip: client.ip,
      userAgent: client.userAgent,
    });
    return { requiresMfa: false as const, user, tokens };
  }

  async recordOAuthFailure(provider: OAuthProfile["provider"], client: AuthClient) {
    await this.securityEvents.record({
      eventType: "login_oauth",
      outcome: "failure",
      provider,
      ip: client.ip,
      userAgent: client.userAgent,
    });
  }

  mfaStatus(userId: string) {
    return this.mfa.status(userId);
  }

  async beginMfaSetup(userId: string) {
    const user = await this.identities.findPublicUser(userId);
    if (!user) throw new UnauthorizedException("Authentication user no longer exists");
    const setup = await this.mfa.beginSetup(user.id, user.email);
    if (!setup) throw new ConflictException("TOTP is already enabled");
    return setup;
  }

  async verifyRecentAuthentication(userId: string, credential: { password?: string; code?: string }) {
    const identity = await this.identities.findForReauthentication(userId);
    if (!identity || !["active", "deletion_pending"].includes(identity.lifecycleState)) {
      throw new UnauthorizedException("Account is not available for re-authentication");
    }
    const password = credential.password?.trim();
    if (password && identity.passwordHash && (await verify(identity.passwordHash, password).catch(() => false))) {
      return new Date();
    }
    const code = credential.code?.trim();
    if (code && (await this.mfa.isEnabled(userId)) && (await this.mfa.verify(userId, code))) {
      return new Date();
    }
    throw new UnauthorizedException("Recent authentication is required");
  }

  async enableMfa(userId: string, code: string) {
    const result = await this.mfa.enable(userId, code);
    if (!result) {
      await this.securityEvents.record({ userId, eventType: "mfa_enabled", outcome: "failure" });
      throw new UnauthorizedException("TOTP code is invalid or expired");
    }
    await this.securityEvents.record({ userId, eventType: "mfa_enabled", outcome: "success" });
    return { enabled: true as const, ...result };
  }

  async disableMfa(userId: string, currentSessionId: string, code: string) {
    if (!(await this.mfa.disable(userId, code))) {
      await this.securityEvents.record({ userId, eventType: "mfa_disabled", outcome: "failure" });
      throw new UnauthorizedException("MFA code is invalid");
    }
    await this.sessions.revokeOther(userId, currentSessionId);
    await this.securityEvents.record({
      userId,
      sessionId: currentSessionId,
      eventType: "mfa_disabled",
      outcome: "success",
    });
    return { enabled: false as const };
  }

  async requestEmailVerification(email: string, requestedIp?: string) {
    const identity = await this.identities.findByEmail(email);
    if (identity && !identity.emailVerifiedAt) {
      await this.sendAuthEmail(identity, "email_verification", requestedIp);
    }
    return { ok: true };
  }

  async verifyEmail(token: string) {
    const user = await this.authTokens.verifyEmail(token);
    if (!user) throw new BadRequestException("Verification link is invalid or expired");
    await this.securityEvents.record({
      userId: user.id,
      email: user.email,
      eventType: "email_verified",
      outcome: "success",
    });
    return { ok: true, emailVerifiedAt: user.emailVerifiedAt };
  }

  async forgotPassword(email: string, requestedIp?: string) {
    const identity = await this.identities.findByEmail(email);
    if (identity?.passwordHash) await this.sendAuthEmail(identity, "password_reset", requestedIp);
    await this.securityEvents.record({
      userId: identity?.id,
      email,
      eventType: "password_reset_requested",
      outcome: "success",
      ip: requestedIp,
    });
    return { ok: true };
  }

  async resetPassword(token: string, password: string) {
    const passwordHash = await this.passwordHash(password);
    const result = await this.authTokens.resetPassword(token, passwordHash);
    if (!result) throw new BadRequestException("Password reset link is invalid or expired");
    await this.securityEvents.record({
      userId: result.userId,
      eventType: "password_reset_completed",
      outcome: "success",
    });
    return { ok: true };
  }

  async verifyAccessToken(token: string) {
    try {
      const result = await jwtVerify(token, accessTokenSecret(), {
        issuer: "calmboard-api",
        audience: "calmboard-web",
        algorithms: ["HS256"],
      });
      const sessionId = result.payload.sid;
      if (result.payload.type !== "access" || !result.payload.sub || typeof sessionId !== "string") {
        throw new UnauthorizedException("Invalid access token");
      }
      const session = await this.sessions.validate(sessionId, result.payload.sub);
      return { userId: result.payload.sub, sessionId: session.id };
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException("Authentication session is invalid or expired");
    }
  }

  async current(token: string) {
    const session = await this.verifyAccessToken(token);
    const user = await this.identities.findPublicUser(session.userId);
    if (!user || !["active", "deletion_pending"].includes(user.lifecycleState)) {
      throw new UnauthorizedException("Authentication user is disabled");
    }
    return { user, sessionId: session.sessionId };
  }

  async refresh(refreshToken: string, client: AuthClient) {
    try {
      const rotated = await this.sessions.rotate({
        refreshToken,
        ip: client.ip,
        userAgent: client.userAgent,
      });
      const user = await this.identities.findPublicUser(rotated.userId);
      if (!user || !["active", "deletion_pending"].includes(user.lifecycleState)) {
        throw new UnauthorizedException("Authentication user is disabled");
      }
      return {
        user,
        tokens: {
          accessToken: await this.accessToken(rotated.userId, rotated.sessionId),
          refreshToken: rotated.refreshToken,
          accessMaxAge: ACCESS_TOKEN_TTL_SECONDS,
          refreshExpiresAt: rotated.refreshExpiresAt,
        },
      };
    } catch (error) {
      if (error instanceof InvalidAuthSessionError) throw new UnauthorizedException(error.message);
      throw error;
    }
  }

  async logout(accessToken: string, client: AuthClient = { device: "Web browser" }) {
    const session = await this.verifyAccessToken(accessToken);
    await this.sessions.revoke(session.userId, session.sessionId);
    await this.securityEvents.record({
      userId: session.userId,
      sessionId: session.sessionId,
      eventType: "logout",
      outcome: "success",
      ip: client.ip,
      userAgent: client.userAgent,
    });
  }

  async listSessions(userId: string, currentSessionId: string) {
    const sessions = await this.sessions.list(userId, currentSessionId);
    return sessions.map((session) => ({
      id: session.id,
      device: session.device,
      browser: session.browser,
      ip: session.ip,
      location: session.location,
      isCurrent: session.isCurrent,
      lastActive: session.lastActive,
      lastRefreshAt: session.lastRefreshAt,
      expiresAt: session.expiresAt,
      createdAt: session.createdAt,
    }));
  }

  async revokeSession(userId: string, currentSessionId: string, sessionId: string) {
    await this.sessions.revoke(userId, sessionId, "user_revoked_session");
    await this.securityEvents.record({
      userId,
      sessionId,
      eventType: "session_revoked",
      outcome: "success",
      metadata: { revokedCurrent: sessionId === currentSessionId },
    });
    return { revokedCurrent: sessionId === currentSessionId };
  }

  async revokeOtherSessions(userId: string, currentSessionId: string) {
    const revoked = await this.sessions.revokeOther(userId, currentSessionId);
    await this.securityEvents.record({
      userId,
      sessionId: currentSessionId,
      eventType: "sessions_revoked",
      outcome: "success",
      metadata: { scope: "other", count: revoked.length },
    });
    return { revoked: revoked.length, revokedCurrent: false };
  }

  async revokeAllSessions(userId: string) {
    const revoked = await this.sessions.revokeAll(userId);
    await this.securityEvents.record({
      userId,
      eventType: "sessions_revoked",
      outcome: "success",
      metadata: { scope: "all", count: revoked.length },
    });
    return { revoked: revoked.length, revokedCurrent: true };
  }
}
