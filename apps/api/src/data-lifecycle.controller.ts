import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Post,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { createAccountDeletionRepository, createOrganizationDeletionRepository } from "@calmboard/database";
import type { AuthenticatedRequest } from "./auth.guard.js";
import { AuthService } from "./auth.service.js";
import { RequirePermission, SelfService } from "./permission.guard.js";
import type { JsonObject } from "./request-validation.js";

function identity(request: AuthenticatedRequest) {
  if (!request.auth) throw new UnauthorizedException("Authentication is required");
  return request.auth;
}

function optionalCredential(value: unknown, field: string, maximum: number) {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim() || value.length > maximum) {
    throw new BadRequestException(`${field} is invalid`);
  }
  return value;
}

export function deletionRuntimeConfig(env: NodeJS.ProcessEnv = process.env) {
  if (env.DATA_LIFECYCLE_ENABLED !== "true") {
    throw new ServiceUnavailableException("Data lifecycle operations are not enabled in this environment");
  }
  const graceHours = Number(env.DATA_DELETION_GRACE_HOURS);
  if (!Number.isInteger(graceHours) || graceHours < 1 || graceHours > 720) {
    throw new ServiceUnavailableException("DATA_DELETION_GRACE_HOURS must be explicitly configured between 1 and 720");
  }
  const policyVersion = env.DATA_LIFECYCLE_POLICY_VERSION?.trim();
  if (!policyVersion || policyVersion.length > 64 || !/^[A-Za-z0-9._-]+$/.test(policyVersion)) {
    throw new ServiceUnavailableException("DATA_LIFECYCLE_POLICY_VERSION must be explicitly configured");
  }
  return { graceHours, policyVersion };
}

function scheduledFor(reauthenticatedAt: Date, graceHours: number) {
  return new Date(reauthenticatedAt.getTime() + graceHours * 60 * 60 * 1_000);
}

function reauthenticationCredential(body: JsonObject) {
  const password = optionalCredential(body.password, "password", 1_024);
  const code = optionalCredential(body.code, "code", 64);
  if (!password && !code) throw new BadRequestException("password or MFA code is required");
  return { ...(password ? { password } : {}), ...(code ? { code } : {}) };
}

@Controller("profile/deletion")
@SelfService()
export class AccountDeletionController {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  @Get()
  get(@Req() request: AuthenticatedRequest) {
    return createAccountDeletionRepository(identity(request).userId).get();
  }

  @Post()
  async schedule(@Body() body: JsonObject, @Req() request: AuthenticatedRequest) {
    const runtime = deletionRuntimeConfig();
    const authenticated = identity(request);
    const reauthenticatedAt = await this.authService.verifyRecentAuthentication(
      authenticated.userId,
      reauthenticationCredential(body),
    );
    return createAccountDeletionRepository(authenticated.userId).schedule({
      reauthenticatedAt,
      scheduledFor: scheduledFor(reauthenticatedAt, runtime.graceHours),
      policyVersion: runtime.policyVersion,
    });
  }

  @Delete()
  cancel(@Req() request: AuthenticatedRequest) {
    deletionRuntimeConfig();
    return createAccountDeletionRepository(identity(request).userId).cancel();
  }
}

@Controller("organizations/:organizationId/deletion")
export class OrganizationDeletionController {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  @Get()
  @RequirePermission("organization.manage")
  get(@Param("organizationId") organizationId: string, @Req() request: AuthenticatedRequest) {
    return createOrganizationDeletionRepository(organizationId, identity(request).userId).get();
  }

  @Post()
  @RequirePermission("organization.manage")
  async schedule(
    @Param("organizationId") organizationId: string,
    @Body() body: JsonObject,
    @Req() request: AuthenticatedRequest,
  ) {
    const runtime = deletionRuntimeConfig();
    if (process.env.ORGANIZATION_PURGE_ENABLED !== "true") {
      throw new ServiceUnavailableException("Organization deletion is blocked until retention policy is approved");
    }
    const authenticated = identity(request);
    const confirmedName = optionalCredential(body.confirmedName, "confirmedName", 255);
    if (!confirmedName) throw new BadRequestException("confirmedName is required");
    const reauthenticatedAt = await this.authService.verifyRecentAuthentication(
      authenticated.userId,
      reauthenticationCredential(body),
    );
    return createOrganizationDeletionRepository(organizationId, authenticated.userId).schedule({
      reauthenticatedAt,
      scheduledFor: scheduledFor(reauthenticatedAt, runtime.graceHours),
      policyVersion: runtime.policyVersion,
      confirmationVersion: "organization-name-v1",
      confirmedName,
    });
  }

  @Delete()
  @RequirePermission("organization.manage")
  cancel(@Param("organizationId") organizationId: string, @Req() request: AuthenticatedRequest) {
    deletionRuntimeConfig();
    return createOrganizationDeletionRepository(organizationId, identity(request).userId).cancel();
  }
}
