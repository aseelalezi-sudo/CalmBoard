import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { AuthService, type AuthClient } from "./auth.service.js";
import { ACCESS_COOKIE, parseCookies } from "./auth.guard.js";
import { PublicRoute } from "./public-route.decorator.js";
import { CSRF_COOKIE, issueCsrfToken } from "./csrf.guard.js";
import { requiredString, type JsonObject } from "./request-validation.js";
import { OAuthService, oauthProviderAvailability, parseOAuthProvider } from "./oauth.service.js";
import { secureCookieAttribute } from "./cookie-security.js";

const REFRESH_COOKIE = "calmboard_refresh";
const OAUTH_MFA_COOKIE = "calmboard_oauth_mfa";

function cookie(name: string, value: string, maxAge: number) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secureCookieAttribute()}`;
}

function clearCookie(name: string) {
  return `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secureCookieAttribute()}`;
}

function csrfCookie(value: string) {
  return `${CSRF_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${8 * 60 * 60}${secureCookieAttribute()}`;
}

export function describeAuthClient(userAgent = "") {
  const device = /iPhone/i.test(userAgent)
    ? "iPhone"
    : /iPad/i.test(userAgent)
      ? "iPad"
      : /Android/i.test(userAgent)
        ? "Android device"
        : /Windows/i.test(userAgent)
          ? "Windows device"
          : /Macintosh|Mac OS X/i.test(userAgent)
            ? "Mac"
            : /Linux/i.test(userAgent)
              ? "Linux device"
              : "Web browser";
  const browser = /Edg\//i.test(userAgent)
    ? "Microsoft Edge"
    : /Firefox|FxiOS/i.test(userAgent)
      ? "Firefox"
      : /Chrome|CriOS/i.test(userAgent)
        ? "Google Chrome"
        : /Safari/i.test(userAgent)
          ? "Safari"
          : null;
  return { device, browser };
}

function authClient(request: FastifyRequest, userAgent?: string): AuthClient {
  const description = describeAuthClient(userAgent);
  return {
    ...description,
    userAgent: userAgent?.slice(0, 500),
    ip: request.ip,
  };
}

function emailAddress(value: unknown) {
  const email = requiredString(value, "email").toLowerCase();
  if (email.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new BadRequestException("email is invalid");
  }
  return email;
}

function securePassword(value: unknown) {
  const password = requiredString(value, "password");
  if (password.length < 12 || password.length > 128) {
    throw new BadRequestException("Password must contain between 12 and 128 characters");
  }
  return password;
}

function mfaCode(value: unknown) {
  const code = requiredString(value, "code").trim();
  if (!/^\d{6}$/.test(code) && !/^[A-Fa-f0-9]{8}(?:-[A-Fa-f0-9]{8}){3}$/.test(code)) {
    throw new BadRequestException("code must be a six-digit TOTP or a recovery code");
  }
  return code;
}

function setAuthCookies(
  response: FastifyReply,
  tokens: { accessToken: string; refreshToken: string; accessMaxAge: number; refreshExpiresAt: Date },
) {
  const refreshMaxAge = Math.max(1, Math.floor((tokens.refreshExpiresAt.getTime() - Date.now()) / 1_000));
  response.header("Set-Cookie", [
    cookie(ACCESS_COOKIE, tokens.accessToken, tokens.accessMaxAge),
    cookie(REFRESH_COOKIE, tokens.refreshToken, refreshMaxAge),
  ]);
}

@PublicRoute()
@Controller("auth")
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(OAuthService) private readonly oauth: OAuthService,
  ) {}

  @Get("csrf")
  csrf(@Res({ passthrough: true }) response: FastifyReply) {
    const token = issueCsrfToken();
    response.header("Set-Cookie", csrfCookie(token));
    return { token };
  }

  @Post("register")
  async register(
    @Body() body: JsonObject,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) response: FastifyReply,
    @Headers("user-agent") userAgent?: string,
  ) {
    const password = securePassword(body.password);
    const email = emailAddress(body.email);
    const name = requiredString(body.name, "name");
    const organizationName = requiredString(body.organizationName, "organizationName");
    const workspaceName = requiredString(body.workspaceName, "workspaceName");
    if ([name, organizationName, workspaceName].some((value) => value.length > 255)) {
      throw new BadRequestException("name fields must not exceed 255 characters");
    }
    const result = await this.auth.register(
      {
        email,
        name,
        password,
        organizationName,
        workspaceName,
      },
      authClient(request, userAgent),
    );
    setAuthCookies(response, result.tokens);
    return { user: result.user, verificationEmailSent: result.verificationEmailSent };
  }

  @Post("login")
  async login(
    @Body() body: JsonObject,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) response: FastifyReply,
    @Headers("user-agent") userAgent?: string,
  ) {
    const email = emailAddress(body.email);
    const password = requiredString(body.password, "password");
    if (email.length > 320 || password.length > 128) throw new UnauthorizedException("Invalid email or password");
    const result = await this.auth.login(email, password, authClient(request, userAgent));
    if (result.requiresMfa) return result;
    setAuthCookies(response, result.tokens);
    return { requiresMfa: false, user: result.user };
  }

  @Post("mfa/verify")
  async verifyMfaLogin(
    @Body() body: JsonObject,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) response: FastifyReply,
    @Headers("user-agent") userAgent?: string,
  ) {
    const result = await this.auth.completeMfaLogin(
      requiredString(body.challengeToken, "challengeToken"),
      mfaCode(body.code),
      authClient(request, userAgent),
    );
    setAuthCookies(response, result.tokens);
    return { user: result.user };
  }

  @Get("oauth/providers")
  oauthProviders() {
    return oauthProviderAvailability();
  }

  @Get("oauth/:provider/start")
  async beginOAuth(
    @Param("provider") providerValue: string,
    @Req() request: FastifyRequest,
    @Res() response: FastifyReply,
  ) {
    const destination = await this.oauth.begin(parseOAuthProvider(providerValue), request.ip);
    return response.redirect(destination);
  }

  @Get("oauth/:provider/callback")
  async completeOAuth(
    @Param("provider") providerValue: string,
    @Query("state") stateValue: string | undefined,
    @Query("code") codeValue: string | undefined,
    @Query("error") providerError: string | undefined,
    @Req() request: FastifyRequest,
    @Res() response: FastifyReply,
    @Headers("user-agent") userAgent?: string,
  ) {
    const provider = parseOAuthProvider(providerValue);
    const client = authClient(request, userAgent);
    if (providerError) {
      await this.auth.recordOAuthFailure(provider, client);
      throw new BadRequestException("OAuth authorization was denied");
    }
    const state = requiredString(stateValue, "state");
    const code = requiredString(codeValue, "code");
    if (state.length > 2_048 || code.length > 2_048) throw new BadRequestException("OAuth callback is invalid");
    let profile;
    try {
      profile = await this.oauth.complete(provider, state, code);
    } catch (error) {
      await this.auth.recordOAuthFailure(provider, client);
      throw error;
    }
    const result = await this.auth.oauthLogin(profile, client);
    const appUrl = new URL(process.env.APP_URL?.trim() || "http://localhost:3000");
    if (result.requiresMfa) {
      response.header("Set-Cookie", cookie(OAUTH_MFA_COOKIE, result.challengeToken, 5 * 60));
      appUrl.searchParams.set("oauth_mfa", "1");
      return response.redirect(appUrl.toString());
    }
    setAuthCookies(response, result.tokens);
    appUrl.searchParams.set("oauth", "success");
    return response.redirect(appUrl.toString());
  }

  @Post("oauth/mfa/verify")
  async verifyOAuthMfaLogin(
    @Body() body: JsonObject,
    @Headers("cookie") cookieHeader: string | undefined,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) response: FastifyReply,
    @Headers("user-agent") userAgent?: string,
  ) {
    const challenge = parseCookies(cookieHeader)[OAUTH_MFA_COOKIE];
    if (!challenge) throw new UnauthorizedException("OAuth MFA challenge is missing");
    const result = await this.auth.completeMfaLogin(challenge, mfaCode(body.code), authClient(request, userAgent));
    response.header("Set-Cookie", [
      cookie(ACCESS_COOKIE, result.tokens.accessToken, result.tokens.accessMaxAge),
      cookie(
        REFRESH_COOKIE,
        result.tokens.refreshToken,
        Math.max(1, Math.floor((result.tokens.refreshExpiresAt.getTime() - Date.now()) / 1_000)),
      ),
      clearCookie(OAUTH_MFA_COOKIE),
    ]);
    return { user: result.user };
  }

  @Post("email/verification/request")
  async requestEmailVerification(@Body() body: JsonObject, @Req() request: FastifyRequest) {
    await this.auth.requestEmailVerification(emailAddress(body.email), request.ip);
    return { ok: true, message: "If the account requires verification, an email has been sent" };
  }

  @Post("email/verify")
  verifyEmail(@Body() body: JsonObject) {
    return this.auth.verifyEmail(requiredString(body.token, "token"));
  }

  @Post("password/forgot")
  async forgotPassword(@Body() body: JsonObject, @Req() request: FastifyRequest) {
    await this.auth.forgotPassword(emailAddress(body.email), request.ip);
    return { ok: true, message: "If the account exists, a password reset email has been sent" };
  }

  @Post("password/reset")
  resetPassword(@Body() body: JsonObject) {
    return this.auth.resetPassword(requiredString(body.token, "token"), securePassword(body.password));
  }

  @Get("session")
  current(@Headers("cookie") cookieHeader = "") {
    const accessToken = parseCookies(cookieHeader)[ACCESS_COOKIE];
    if (!accessToken) throw new UnauthorizedException("Authentication is required");
    return this.auth.current(accessToken);
  }

  @Post("refresh")
  async refresh(
    @Headers("cookie") cookieHeader: string | undefined,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) response: FastifyReply,
    @Headers("user-agent") userAgent?: string,
  ) {
    const refreshToken = parseCookies(cookieHeader)[REFRESH_COOKIE];
    if (!refreshToken) throw new UnauthorizedException("Refresh token is required");
    try {
      const result = await this.auth.refresh(refreshToken, authClient(request, userAgent));
      setAuthCookies(response, result.tokens);
      return { user: result.user };
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        response.header("Set-Cookie", [clearCookie(ACCESS_COOKIE), clearCookie(REFRESH_COOKIE)]);
      }
      throw error;
    }
  }

  @Post("logout")
  async logout(
    @Headers("cookie") cookieHeader: string | undefined,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) response: FastifyReply,
    @Headers("user-agent") userAgent?: string,
  ) {
    const accessToken = parseCookies(cookieHeader)[ACCESS_COOKIE];
    if (accessToken) await this.auth.logout(accessToken, authClient(request, userAgent)).catch(() => undefined);
    response.header("Set-Cookie", [clearCookie(ACCESS_COOKIE), clearCookie(REFRESH_COOKIE)]);
    return { ok: true };
  }
}
