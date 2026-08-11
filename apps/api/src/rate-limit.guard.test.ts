import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HttpException, ServiceUnavailableException, type ExecutionContext } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { generalRateLimit, RateLimitGuard } from "./rate-limit.guard.js";
import type { RateLimitStore } from "./rate-limit.service.js";

function executionContext(input: { method: string; url: string; ip: string; body?: unknown; userId?: string }) {
  const headers: Record<string, number> = {};
  const response = { header: (name: string, value: number) => (headers[name] = value) } as unknown as FastifyReply;
  return {
    context: {
      switchToHttp: () => ({
        getRequest: () => ({ ...input, headers: {}, auth: input.userId ? { userId: input.userId } : undefined }),
        getResponse: () => response,
      }),
    } as unknown as ExecutionContext,
    headers,
  };
}

describe("distributed rate limit guard", () => {
  it("validates the configurable general API limit", () => {
    assert.equal(generalRateLimit({}), 300);
    assert.equal(generalRateLimit({ API_GENERAL_RATE_LIMIT: "25000" }), 25_000);
    assert.throws(() => generalRateLimit({ API_GENERAL_RATE_LIMIT: "0" }), /positive integer/);
    assert.throws(() => generalRateLimit({ API_GENERAL_RATE_LIMIT: "1000001" }), /must not exceed/);
  });

  it("limits login by IP and hashed account identity", async () => {
    const counts = new Map<string, number>();
    const keys: string[] = [];
    const store: RateLimitStore = {
      hit: async (key) => {
        keys.push(key);
        const count = (counts.get(key) ?? 0) + 1;
        counts.set(key, count);
        return { count, ttlMs: 900_000 };
      },
    };
    const guard = new RateLimitGuard(store);
    const request = executionContext({
      method: "POST",
      url: "/auth/login",
      ip: "203.0.113.10",
      body: { email: "Person@Example.test" },
    });

    for (let attempt = 0; attempt < 10; attempt += 1) assert.equal(await guard.canActivate(request.context), true);
    await assert.rejects(
      () => guard.canActivate(request.context),
      (error: unknown) => {
        assert.ok(error instanceof HttpException);
        assert.equal(error.getStatus(), 429);
        return true;
      },
    );
    assert.ok(keys.some((key) => key.includes("login-account")));
    assert.equal(
      keys.some((key) => key.includes("person@example.test")),
      false,
    );
    assert.equal(request.headers["Retry-After"], 900);
  });

  it("fails closed for authentication paths when Redis is unavailable", async () => {
    const store: RateLimitStore = { hit: async () => Promise.reject(new Error("offline")) };
    const guard = new RateLimitGuard(store);
    const sensitive = executionContext({ method: "POST", url: "/auth/password/forgot", ip: "203.0.113.20" });
    await assert.rejects(() => guard.canActivate(sensitive.context), ServiceUnavailableException);
    const oauthStart = executionContext({
      method: "GET",
      url: "/auth/oauth/google/start",
      ip: "203.0.113.21",
    });
    const oauthCallback = executionContext({
      method: "GET",
      url: "/auth/oauth/microsoft/callback?code=test&state=test",
      ip: "203.0.113.22",
    });
    await assert.rejects(() => guard.canActivate(oauthStart.context), ServiceUnavailableException);
    await assert.rejects(() => guard.canActivate(oauthCallback.context), ServiceUnavailableException);
    const invitationInspect = executionContext({
      method: "POST",
      url: "/invitations/inspect",
      ip: "203.0.113.23",
      body: { token: "redacted" },
    });
    const invitationAccept = executionContext({
      method: "POST",
      url: "/invitations/accept",
      ip: "203.0.113.24",
      userId: "user-1",
    });
    await assert.rejects(() => guard.canActivate(invitationInspect.context), ServiceUnavailableException);
    await assert.rejects(() => guard.canActivate(invitationAccept.context), ServiceUnavailableException);
    const accountDeletion = executionContext({
      method: "POST",
      url: "/profile/deletion",
      ip: "203.0.113.25",
      userId: "user-1",
    });
    const organizationDeletion = executionContext({
      method: "DELETE",
      url: "/organizations/organization-1/deletion",
      ip: "203.0.113.26",
      userId: "user-1",
    });
    await assert.rejects(() => guard.canActivate(accountDeletion.context), ServiceUnavailableException);
    await assert.rejects(() => guard.canActivate(organizationDeletion.context), ServiceUnavailableException);
    const workspaceExport = executionContext({
      method: "POST",
      url: "/workspaces/export",
      ip: "203.0.113.27",
      userId: "user-1",
    });
    const organizationExport = executionContext({
      method: "POST",
      url: "/organizations/organization-1/export",
      ip: "203.0.113.28",
      userId: "user-1",
    });
    await assert.rejects(() => guard.canActivate(workspaceExport.context), ServiceUnavailableException);
    await assert.rejects(() => guard.canActivate(organizationExport.context), ServiceUnavailableException);
  });

  it("keeps health probes independent from the rate-limit store", async () => {
    const store: RateLimitStore = { hit: async () => Promise.reject(new Error("offline")) };
    const guard = new RateLimitGuard(store);
    for (const url of ["/health", "/health/liveness", "/health/readiness", "/metrics"]) {
      assert.equal(await guard.canActivate(executionContext({ method: "GET", url, ip: "127.0.0.1" }).context), true);
    }
  });

  it("allows ordinary development traffic when Redis is unavailable", async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    const store: RateLimitStore = { hit: async () => Promise.reject(new Error("offline")) };
    const guard = new RateLimitGuard(store);
    try {
      const ordinary = executionContext({ method: "GET", url: "/projects", ip: "203.0.113.30", userId: "user-1" });
      assert.equal(await guard.canActivate(ordinary.context), true);
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
    }
  });
});
