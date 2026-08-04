import "reflect-metadata";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ForbiddenException, HttpException, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { LicensingGuard } from "./licensing.guard.js";
import { LicensingService, type AppLicenseCheck } from "./licensing.service.js";
import { PUBLIC_ROUTE } from "../public-route.decorator.js";

function executionContext(handler = () => undefined): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => class ProtectedController {},
    getType: () => "http",
    switchToHttp: () => ({ getRequest: () => ({ headers: {} }) }),
  } as unknown as ExecutionContext;
}

function fakeLicensing(check: AppLicenseCheck, enabled = true): LicensingService {
  return {
    enabledLicensing: enabled,
    status: async () => check,
  } as unknown as LicensingService;
}

describe("LicensingGuard", () => {
  it("passes everything when licensing is not enforced", async () => {
    const guard = new LicensingGuard(new Reflector(), fakeLicensing({ status: "disabled" } as AppLicenseCheck, false));
    assert.equal(await guard.canActivate(executionContext()), true);
  });

  it("passes explicitly public routes without checking the license", async () => {
    const handler = () => undefined;
    Reflect.defineMetadata(PUBLIC_ROUTE, true, handler);
    const licensing = fakeLicensing({ status: "not_activated" } as AppLicenseCheck);
    const guard = new LicensingGuard(new Reflector(), licensing);
    assert.equal(await guard.canActivate(executionContext(handler)), true);
  });

  it("passes a valid license", async () => {
    const check: AppLicenseCheck = {
      status: "valid",
      reason: "ok",
      claims: { fea: ["advanced-reports"] },
      token: "t",
      valid: true,
      grace: false,
    };
    const guard = new LicensingGuard(new Reflector(), fakeLicensing(check));
    assert.equal(await guard.canActivate(executionContext()), true);
  });

  it("passes a license inside its offline grace period", async () => {
    const check: AppLicenseCheck = {
      status: "grace_period",
      reason: "grace",
      claims: {},
      token: "t",
      valid: true,
      grace: true,
    };
    const guard = new LicensingGuard(new Reflector(), fakeLicensing(check));
    assert.equal(await guard.canActivate(executionContext()), true);
  });

  it("blocks a revoked license with 403", async () => {
    const check: AppLicenseCheck = {
      status: "revoked",
      reason: "revoked",
      claims: {},
      token: null,
      valid: false,
    };
    const guard = new LicensingGuard(new Reflector(), fakeLicensing(check));
    await assert.rejects(() => guard.canActivate(executionContext()), ForbiddenException);
  });

  it("blocks a missing license with 402", async () => {
    const check: AppLicenseCheck = {
      status: "not_activated",
      reason: "no key",
      claims: {},
      token: null,
      valid: false,
    };
    const guard = new LicensingGuard(new Reflector(), fakeLicensing(check));
    await assert.rejects(
      () => guard.canActivate(executionContext()),
      (error: HttpException) => error.getStatus() === 402,
    );
  });
});
