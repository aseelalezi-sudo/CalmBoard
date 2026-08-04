import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import type { FastifyReply } from "fastify";
import {
  createUserProfileRepository,
  createUserSkillsRepository,
  createWorkspaceRepository,
  type NotificationPreferenceUpdate,
} from "@calmboard/database";
import { requiredString, tenantContext, tenantContextFromBody, type JsonObject } from "./request-validation.js";
import { parseUpdateWorkspaceInput } from "./workspace-validation.js";
import { AuthService } from "./auth.service.js";
import type { AuthenticatedRequest } from "./auth.guard.js";
import { RequirePermission, SelfService, TenantMember } from "./permission.guard.js";
import { secureCookieAttribute } from "./cookie-security.js";

function mfaCode(value: unknown) {
  const code = requiredString(value, "code").trim();
  if (!/^\d{6}$/.test(code) && !/^[A-Fa-f0-9]{8}(?:-[A-Fa-f0-9]{8}){3}$/.test(code)) {
    throw new BadRequestException("code must be a six-digit TOTP or a recovery code");
  }
  return code;
}

function authenticatedIdentity(request: AuthenticatedRequest) {
  if (!request.auth) throw new UnauthorizedException("Authentication is required");
  return request.auth;
}

function clearAuthenticationCookies(response: FastifyReply) {
  const expired = "; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT";
  const secure = secureCookieAttribute();
  response.header("Set-Cookie", [`calmboard_access=${expired}${secure}`, `calmboard_refresh=${expired}${secure}`]);
}

function parseSkills(value: unknown) {
  if (!Array.isArray(value)) throw new BadRequestException("skills must be an array");
  const skills = value.map((skill, index) => requiredString(skill, `skills.${index}`));
  if (skills.length > 50) throw new BadRequestException("skills must not contain more than 50 entries");
  if (skills.some((skill) => skill.length > 80))
    throw new BadRequestException("skill names must not exceed 80 characters");
  return [...new Set(skills)];
}

function parsePreferenceUpdate(body: JsonObject): NotificationPreferenceUpdate {
  const input: NotificationPreferenceUpdate = {};
  for (const field of ["emailEnabled", "pushEnabled", "inAppEnabled", "dndEnabled"] as const) {
    if (body[field] === undefined) continue;
    if (typeof body[field] !== "boolean") throw new BadRequestException(`${field} must be a boolean`);
    input[field] = body[field];
  }
  for (const field of ["dndStart", "dndEnd"] as const) {
    if (body[field] === undefined) continue;
    const time = requiredString(body[field], field);
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new BadRequestException(`${field} must use HH:mm format`);
    input[field] = time;
  }
  if (!Object.keys(input).length) throw new BadRequestException("at least one preference field is required");
  return input;
}

@Controller("workspaces")
export class WorkspaceResourceController {
  @Get(":id")
  @TenantMember()
  get(
    @Param("id") workspaceId: string,
    @Query("organizationId") organizationId: string,
    @Query("actorId") actorId?: string,
  ) {
    return createWorkspaceRepository(tenantContext(organizationId, workspaceId, actorId)).get();
  }

  @Patch(":id")
  @RequirePermission("workspace.manage")
  update(@Param("id") workspaceId: string, @Body() body: JsonObject) {
    return createWorkspaceRepository(tenantContext(body.organizationId, workspaceId, body.actorId)).update(
      parseUpdateWorkspaceInput(body),
    );
  }
}

@Controller("users/skills")
@SelfService()
export class UserSkillsController {
  @Post()
  update(@Body() body: JsonObject) {
    return createUserSkillsRepository(tenantContextFromBody(body)).update(
      requiredString(body.userId, "userId"),
      parseSkills(body.skills),
    );
  }
}

@Controller("profile/preferences")
@SelfService()
export class ProfilePreferencesController {
  @Get()
  get(@Req() request: AuthenticatedRequest) {
    return createUserProfileRepository(authenticatedIdentity(request).userId).getPreferences();
  }

  @Patch()
  update(@Body() body: JsonObject, @Req() request: AuthenticatedRequest) {
    return createUserProfileRepository(authenticatedIdentity(request).userId).updatePreferences(
      parsePreferenceUpdate(body),
    );
  }
}

@Controller("profile/sessions")
@SelfService()
export class ProfileSessionsController {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  @Get()
  list(@Req() request: AuthenticatedRequest) {
    const identity = authenticatedIdentity(request);
    return this.authService.listSessions(identity.userId, identity.sessionId);
  }

  @Delete()
  async delete(
    @Body() body: JsonObject,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: FastifyReply,
  ) {
    const identity = authenticatedIdentity(request);
    if (body.all === true) {
      const result = await this.authService.revokeAllSessions(identity.userId);
      clearAuthenticationCookies(response);
      return { ok: true, ...result, message: "All sessions have been revoked" };
    }
    if (body.allExceptCurrent === true) {
      const result = await this.authService.revokeOtherSessions(identity.userId, identity.sessionId);
      return { ok: true, ...result, message: "All other sessions have been revoked" };
    }
    if (body.id !== undefined) {
      const result = await this.authService.revokeSession(
        identity.userId,
        identity.sessionId,
        requiredString(body.id, "id"),
      );
      if (result.revokedCurrent) clearAuthenticationCookies(response);
      return { ok: true, ...result, message: "Session has been revoked" };
    }
    throw new BadRequestException("session id, all, or allExceptCurrent is required");
  }
}

@Controller("profile/mfa")
@SelfService()
export class ProfileMfaController {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  @Get()
  status(@Req() request: AuthenticatedRequest) {
    return this.authService.mfaStatus(authenticatedIdentity(request).userId);
  }

  @Post("setup")
  setup(@Req() request: AuthenticatedRequest) {
    return this.authService.beginMfaSetup(authenticatedIdentity(request).userId);
  }

  @Post("enable")
  enable(@Body() body: JsonObject, @Req() request: AuthenticatedRequest) {
    return this.authService.enableMfa(authenticatedIdentity(request).userId, mfaCode(body.code));
  }

  @Post("disable")
  disable(@Body() body: JsonObject, @Req() request: AuthenticatedRequest) {
    const identity = authenticatedIdentity(request);
    return this.authService.disableMfa(identity.userId, identity.sessionId, mfaCode(body.code));
  }
}
