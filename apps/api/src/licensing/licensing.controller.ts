import { Body, Controller, Get, HttpCode, Post } from "@nestjs/common";
import { PublicRoute } from "../public-route.decorator.js";
import { LicensingService } from "./licensing.service.js";

/**
 * Public endpoint so the web client can surface the instance license status
 * (and trigger a revalidation / runtime activation) without authenticating.
 */
@PublicRoute()
@Controller("licensing")
export class LicensingController {
  constructor(private readonly licensing: LicensingService) {}

  @Get("status")
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
