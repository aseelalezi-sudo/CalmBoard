import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { FastifyRequest } from "fastify";
import { AuthService } from "./auth.service.js";
import { PUBLIC_ROUTE } from "./public-route.decorator.js";

export const ACCESS_COOKIE = "calmboard_access";

export interface AuthenticatedRequest extends FastifyRequest {
  auth?: { userId: string; sessionId: string };
}

export function parseCookies(header = "") {
  const cookies: Record<string, string> = {};
  for (const part of header.split(";")) {
    const value = part.trim();
    if (!value) continue;
    const separator = value.indexOf("=");
    const name = separator < 0 ? value : value.slice(0, separator);
    const encoded = separator < 0 ? "" : value.slice(separator + 1);
    try {
      cookies[name] = decodeURIComponent(encoded);
    } catch {
      cookies[name] = "";
    }
  }
  return cookies;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext) {
    if (typeof context.getType === "function" && context.getType() !== "http") return true;
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [context.getHandler(), context.getClass()])) {
      return true;
    }
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const accessToken = parseCookies(request.headers.cookie)[ACCESS_COOKIE];
    if (!accessToken) throw new UnauthorizedException("Authentication is required");
    request.auth = await this.auth.verifyAccessToken(accessToken);
    return true;
  }
}
