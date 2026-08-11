import "reflect-metadata";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { UnauthorizedException, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { AuthService } from "../auth.service.js";
import { AuthGuard } from "../auth.guard.js";
import { PLATFORM_ADMIN_REQUIRED } from "../platform-admin.guard.js";
import { PUBLIC_ROUTE } from "../public-route.decorator.js";
import { LicensingController } from "./licensing.controller.js";
import { SKIP_LICENSE_CHECK } from "./licensing.guard.js";

function route(name: "status" | "refresh" | "activate" | "deactivate") {
  return Object.getOwnPropertyDescriptor(LicensingController.prototype, name)?.value as (...args: never[]) => unknown;
}

function executionContext(handler: (...args: never[]) => unknown): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => LicensingController,
    getType: () => "http",
    switchToHttp: () => ({ getRequest: () => ({ headers: {} }) }),
  } as unknown as ExecutionContext;
}

describe("LicensingController authorization", () => {
  it("keeps only the read-only status route public", () => {
    const reflector = new Reflector();
    assert.equal(reflector.getAllAndOverride(PUBLIC_ROUTE, [route("status"), LicensingController]), true);
    for (const name of ["refresh", "activate", "deactivate"] as const) {
      assert.notEqual(reflector.getAllAndOverride(PUBLIC_ROUTE, [route(name), LicensingController]), true);
    }
  });

  it("requires a platform administrator for every licensing mutation", () => {
    const reflector = new Reflector();
    for (const name of ["refresh", "activate", "deactivate"] as const) {
      assert.equal(reflector.getAllAndOverride(PLATFORM_ADMIN_REQUIRED, [route(name), LicensingController]), true);
      assert.equal(reflector.getAllAndOverride(SKIP_LICENSE_CHECK, [route(name), LicensingController]), true);
    }
  });

  it("rejects an unauthenticated direct caller before a mutation can run", async () => {
    const auth = {
      verifyAccessToken: async () => assert.fail("must not verify a missing token"),
    } as unknown as AuthService;
    const guard = new AuthGuard(new Reflector(), auth);
    for (const name of ["refresh", "activate", "deactivate"] as const) {
      await assert.rejects(() => guard.canActivate(executionContext(route(name))), UnauthorizedException);
    }
  });
});
