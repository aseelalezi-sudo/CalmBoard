import { Body, Controller, Get, HttpCode, Inject, Post } from "@nestjs/common";
import { PublicRoute } from "../public-route.decorator.js";
import { PlatformAdmin } from "../platform-admin.guard.js";
import { SkipLicenseCheck } from "./licensing.guard.js";
import { LicensingService } from "./licensing.service.js";

/**
 * License status is public so the web client can explain why an installation
 * is unavailable. Every mutation is restricted to an authenticated platform
 * administrator, while remaining reachable when the current license is not
 * usable so that an administrator can activate or repair the installation.
 */
@Controller("licensing")
export class LicensingController {
  constructor(@Inject(LicensingService) private readonly licensing: LicensingService) {}

  @Get("status")
  @PublicRoute()
  async status() {
    const check = await this.licensing.status();
    return {
      success: true,
      data: {
        enforced: this.licensing.enabledLicensing,
        status: check.status,
        reason: check.reason,
        valid: check.valid,
        grace: check.grace ?? false,
        features: check.claims.fea ?? [],
      },
    };
  }

  @Post("refresh")
  @HttpCode(200)
  @SkipLicenseCheck()
  @PlatformAdmin()
  async refresh() {
    const check = await this.licensing.refresh();
    return {
      success: true,
      data: {
        enforced: this.licensing.enabledLicensing,
        status: check.status,
        reason: check.reason,
        valid: check.valid,
        grace: check.grace ?? false,
      },
    };
  }

  @Post("activate")
  @HttpCode(200)
  @SkipLicenseCheck()
  @PlatformAdmin()
  async activate(@Body() body: { license_key?: string }) {
    const key = typeof body?.license_key === "string" ? body.license_key.trim() : "";
    if (!key) {
      return { success: false, error: { code: "invalid_request", message: "license_key is required." } };
    }
    try {
      const check = await this.licensing.activate(key);
      return {
        success: true,
        data: {
          enforced: this.licensing.enabledLicensing,
          status: check.status,
          reason: check.reason,
          valid: check.valid,
          grace: check.grace ?? false,
          features: check.claims.fea ?? [],
        },
      };
    } catch (error) {
      return {
        success: false,
        error: { code: "activation_failed", message: String(error instanceof Error ? error.message : error) },
      };
    }
  }

  @Post("deactivate")
  @HttpCode(200)
  @SkipLicenseCheck()
  @PlatformAdmin()
  async deactivate() {
    const check = await this.licensing.deactivate();
    return {
      success: true,
      data: {
        enforced: this.licensing.enabledLicensing,
        status: check.status,
        reason: check.reason,
        valid: check.valid,
      },
    };
  }
}
