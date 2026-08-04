import "reflect-metadata";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { UnauthorizedException, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AuthGuard, parseCookies, type AuthenticatedRequest } from "./auth.guard.js";
import type { AuthService } from "./auth.service.js";
import { PUBLIC_ROUTE } from "./public-route.decorator.js";

function executionContext(request: Partial<AuthenticatedRequest>, handler = () => undefined): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => class ProtectedController {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe("global authentication guard", () => {
  it("rejects protected requests without an access cookie", async () => {
    const auth = { verifyAccessToken: async () => ({ userId: "user-1", sessionId: "session-1" }) };
    const guard = new AuthGuard(new Reflector(), auth as unknown as AuthService);
    await assert.rejects(() => guard.canActivate(executionContext({ headers: {} })), UnauthorizedException);
  });

  it("validates a protected cookie and attaches the trusted identity", async () => {
    let receivedToken = "";
    const auth = {
      verifyAccessToken: async (token: string) => {
        receivedToken = token;
        return { userId: "user-1", sessionId: "session-1" };
      },
    };
    const request = { headers: { cookie: "other=value; calmboard_access=signed%20token" } } as AuthenticatedRequest;
    const guard = new AuthGuard(new Reflector(), auth as unknown as AuthService);

    assert.equal(await guard.canActivate(executionContext(request)), true);
    assert.equal(receivedToken, "signed token");
    assert.deepEqual(request.auth, { userId: "user-1", sessionId: "session-1" });
  });

  it("allows explicitly public routes and safely ignores malformed cookie encoding", async () => {
    const handler = () => undefined;
    Reflect.defineMetadata(PUBLIC_ROUTE, true, handler);
    const auth = { verifyAccessToken: async () => assert.fail("public route must not verify a token") };
    const guard = new AuthGuard(new Reflector(), auth as unknown as AuthService);

    assert.equal(await guard.canActivate(executionContext({ headers: {} }, handler)), true);
    assert.equal(parseCookies("calmboard_access=%E0%A4%A").calmboard_access, "");
  });
});
