import "reflect-metadata";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ForbiddenException, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { FastifyRequest } from "fastify";
import { CSRF_COOKIE, CSRF_HEADER, CsrfGuard, issueCsrfToken, SKIP_CSRF, validCsrfToken } from "./csrf.guard.js";

process.env.AUTH_TOKEN_SECRET ??= "unit-test-auth-secret-that-is-longer-than-thirty-two-bytes";

function executionContext(request: Partial<FastifyRequest>, handler = () => undefined): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => class ProtectedController {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe("CSRF guard", () => {
  it("accepts safe methods without a token", () => {
    const guard = new CsrfGuard(new Reflector());
    assert.equal(guard.canActivate(executionContext({ method: "GET", headers: {} })), true);
  });

  it("requires matching signed cookie and header tokens for mutations", () => {
    const guard = new CsrfGuard(new Reflector());
    const token = issueCsrfToken();
    assert.equal(validCsrfToken(token), true);
    assert.equal(
      guard.canActivate(
        executionContext({
          method: "POST",
          headers: { cookie: `${CSRF_COOKIE}=${encodeURIComponent(token)}`, [CSRF_HEADER]: token },
        }),
      ),
      true,
    );
    assert.throws(
      () =>
        guard.canActivate(
          executionContext({ method: "PATCH", headers: { cookie: `${CSRF_COOKIE}=${token}`, [CSRF_HEADER]: "other" } }),
        ),
      ForbiddenException,
    );
    const tamperedNonce = `${token.startsWith("a") ? "b" : "a"}${token.slice(1)}`;
    assert.equal(validCsrfToken(tamperedNonce), false);
  });

  it("allows explicitly exempt webhook-style mutations", () => {
    const handler = () => undefined;
    Reflect.defineMetadata(SKIP_CSRF, true, handler);
    const guard = new CsrfGuard(new Reflector());
    assert.equal(guard.canActivate(executionContext({ method: "POST", headers: {} }, handler)), true);
  });
});
