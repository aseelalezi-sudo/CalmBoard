import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, SetMetadata } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { FastifyRequest } from "fastify";
import { parseCookies } from "./auth.guard.js";

export const CSRF_COOKIE = "calmboard_csrf";
export const CSRF_HEADER = "x-csrf-token";
export const SKIP_CSRF = Symbol("calmboard.skip-csrf");
export const SkipCsrf = () => SetMetadata(SKIP_CSRF, true);

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function csrfSecret() {
  const secret = process.env.AUTH_TOKEN_SECRET;
  if (!secret || Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("AUTH_TOKEN_SECRET must contain at least 32 bytes");
  }
  return secret;
}

function signature(nonce: string) {
  return createHmac("sha256", csrfSecret()).update(nonce, "utf8").digest("base64url");
}

export function issueCsrfToken() {
  const nonce = randomBytes(32).toString("base64url");
  return `${nonce}.${signature(nonce)}`;
}

export function validCsrfToken(token: string) {
  const separator = token.indexOf(".");
  if (separator < 1) return false;
  const nonce = token.slice(0, separator);
  const supplied = Buffer.from(token.slice(separator + 1), "base64url");
  const expected = Buffer.from(signature(nonce), "base64url");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext) {
    if (typeof context.getType === "function" && context.getType() !== "http") return true;
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    if (SAFE_METHODS.has(request.method.toUpperCase())) return true;
    if (this.reflector.getAllAndOverride<boolean>(SKIP_CSRF, [context.getHandler(), context.getClass()])) return true;

    const cookieToken = parseCookies(request.headers.cookie)[CSRF_COOKIE];
    const header = request.headers[CSRF_HEADER];
    const headerToken = Array.isArray(header) ? header[0] : header;
    if (!cookieToken || !headerToken || cookieToken !== headerToken || !validCsrfToken(cookieToken)) {
      throw new ForbiddenException("CSRF validation failed");
    }
    return true;
  }
}
