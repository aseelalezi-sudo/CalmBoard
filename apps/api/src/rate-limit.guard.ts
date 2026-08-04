import { createHash } from "node:crypto";
import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { FastifyReply } from "fastify";
import type { AuthenticatedRequest } from "./auth.guard.js";
import { RedisRateLimitStore, type RateLimitStore } from "./rate-limit.service.js";

type RateLimitRule = {
  name: string;
  limit: number;
  windowMs: number;
  sensitive: boolean;
  subject: "ip" | "identity" | "actor";
};

const MINUTE = 60_000;
const AUTH_RULES: Record<string, RateLimitRule[]> = {
  "/auth/login": [
    { name: "login-ip", limit: 10, windowMs: 15 * MINUTE, sensitive: true, subject: "ip" },
    { name: "login-account", limit: 10, windowMs: 15 * MINUTE, sensitive: true, subject: "identity" },
  ],
  "/auth/register": [{ name: "register-ip", limit: 5, windowMs: 60 * MINUTE, sensitive: true, subject: "ip" }],
  "/auth/password/forgot": [
    { name: "forgot-ip", limit: 5, windowMs: 15 * MINUTE, sensitive: true, subject: "ip" },
    { name: "forgot-account", limit: 3, windowMs: 15 * MINUTE, sensitive: true, subject: "identity" },
  ],
  "/auth/password/reset": [{ name: "reset-ip", limit: 10, windowMs: 15 * MINUTE, sensitive: true, subject: "ip" }],
  "/auth/email/verification/request": [
    { name: "verify-ip", limit: 5, windowMs: 15 * MINUTE, sensitive: true, subject: "ip" },
    { name: "verify-account", limit: 3, windowMs: 15 * MINUTE, sensitive: true, subject: "identity" },
  ],
  "/auth/refresh": [{ name: "refresh-ip", limit: 60, windowMs: 15 * MINUTE, sensitive: true, subject: "ip" }],
  "/auth/mfa/verify": [{ name: "mfa-login-ip", limit: 10, windowMs: 5 * MINUTE, sensitive: true, subject: "ip" }],
  "/auth/oauth/start": [{ name: "oauth-start-ip", limit: 20, windowMs: 15 * MINUTE, sensitive: true, subject: "ip" }],
  "/auth/oauth/callback": [
    { name: "oauth-callback-ip", limit: 20, windowMs: 15 * MINUTE, sensitive: true, subject: "ip" },
  ],
  "/auth/oauth/mfa/verify": [{ name: "oauth-mfa-ip", limit: 10, windowMs: 5 * MINUTE, sensitive: true, subject: "ip" }],
  "/profile/mfa/setup": [
    { name: "mfa-setup-account", limit: 5, windowMs: 60 * MINUTE, sensitive: true, subject: "actor" },
  ],
  "/profile/mfa/enable": [
    { name: "mfa-enable-account", limit: 10, windowMs: 5 * MINUTE, sensitive: true, subject: "actor" },
  ],
  "/profile/mfa/disable": [
    { name: "mfa-disable-account", limit: 5, windowMs: 15 * MINUTE, sensitive: true, subject: "actor" },
  ],
  "/forms/:submit": [{ name: "public-form-ip", limit: 30, windowMs: 10 * MINUTE, sensitive: true, subject: "ip" }],
  "/integrations/webhooks/receive/:provider/:endpointToken": [
    { name: "integration-webhook-ip", limit: 120, windowMs: MINUTE, sensitive: true, subject: "ip" },
  ],
};
const GENERAL_RULE: RateLimitRule = {
  name: "api",
  limit: 300,
  windowMs: MINUTE,
  sensitive: false,
  subject: "actor",
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function routeRules(request: AuthenticatedRequest) {
  const path = request.url.split("?", 1)[0] ?? request.url;
  if (request.method === "POST" && /^\/forms\/[^/]+\/submit$/.test(path)) return AUTH_RULES["/forms/:submit"];
  if (request.method === "POST" && /^\/integrations\/webhooks\/receive\/[^/]+\/[^/]+$/.test(path)) {
    return AUTH_RULES["/integrations/webhooks/receive/:provider/:endpointToken"];
  }
  if (request.method === "GET" && /^\/auth\/oauth\/[^/]+\/start$/.test(path)) return AUTH_RULES["/auth/oauth/start"];
  if (request.method === "GET" && /^\/auth\/oauth\/[^/]+\/callback$/.test(path)) {
    return AUTH_RULES["/auth/oauth/callback"];
  }
  return AUTH_RULES[path] ?? [GENERAL_RULE];
}

function fingerprint(request: AuthenticatedRequest, subject: RateLimitRule["subject"]) {
  if (subject === "ip") return request.ip;
  if (subject === "actor") return request.auth?.userId ?? request.ip;
  const email = asRecord(request.body).email;
  const identity = typeof email === "string" ? email.trim().toLowerCase() : "unknown";
  return `${request.ip}:${createHash("sha256").update(identity).digest("hex")}`;
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(@Inject(RedisRateLimitStore) private readonly store: RateLimitStore) {}

  async canActivate(context: ExecutionContext) {
    if (typeof context.getType === "function" && context.getType() !== "http") return true;
    const http = context.switchToHttp();
    const request = http.getRequest<AuthenticatedRequest>();
    const response = http.getResponse<FastifyReply>();
    const rules = routeRules(request);

    for (const rule of rules) {
      const bucket = Math.floor(Date.now() / rule.windowMs);
      const subject = fingerprint(request, rule.subject);
      const key = `calmboard:rate:${rule.name}:${bucket}:${subject}`;
      let hit;
      try {
        hit = await this.store.hit(key, rule.windowMs);
      } catch {
        if (rule.sensitive || process.env.NODE_ENV === "production") {
          throw new ServiceUnavailableException("Request protection is temporarily unavailable");
        }
        return true;
      }

      const retryAfter = Math.max(1, Math.ceil(hit.ttlMs / 1_000));
      response.header("RateLimit-Limit", rule.limit);
      response.header("RateLimit-Remaining", Math.max(0, rule.limit - hit.count));
      response.header("RateLimit-Reset", retryAfter);
      if (hit.count > rule.limit) {
        response.header("Retry-After", retryAfter);
        throw new HttpException(
          { error: "Too many requests", statusCode: HttpStatus.TOO_MANY_REQUESTS, retryAfter },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }
    return true;
  }
}
