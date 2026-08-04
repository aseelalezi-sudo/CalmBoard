import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import {
  createAuthorizationRepository,
  createSecurityEventsRepository,
  type AuthorizationScope,
} from "@calmboard/database";
import type { AuthenticatedRequest } from "./auth.guard.js";
import { RequirePermission, SelfService } from "./permission.guard.js";
import { requiredString, type JsonObject } from "./request-validation.js";
import { PlatformAdministrationService } from "./platform-administration.service.js";

function identity(request: AuthenticatedRequest) {
  if (!request.auth) throw new BadRequestException("Authenticated identity is missing");
  return request.auth;
}

function permissionKeys(value: unknown) {
  if (!Array.isArray(value) || value.length > 100) throw new BadRequestException("permissionKeys must be an array");
  return [...new Set(value.map((key, index) => requiredString(key, `permissionKeys.${index}`)))];
}

function roleInput(body: JsonObject, requireKey: boolean) {
  const key = requireKey ? requiredString(body.key, "key").toLowerCase() : undefined;
  if (key && !/^[a-z][a-z0-9_-]{2,99}$/.test(key)) throw new BadRequestException("role key is invalid");
  const name = requiredString(body.name, "name");
  if (name.length > 255) throw new BadRequestException("role name is too long");
  const description =
    body.description === undefined || body.description === null
      ? null
      : requiredString(body.description, "description");
  if (description && description.length > 2_000) throw new BadRequestException("role description is too long");
  return { ...(key ? { key } : {}), name, description, permissionKeys: permissionKeys(body.permissionKeys) };
}

function assignmentScope(body: JsonObject): AuthorizationScope & {
  membershipId: string;
  roleId: string;
  scope: "organization" | "workspace" | "project";
} {
  const scope = requiredString(body.scope, "scope");
  if (scope !== "organization" && scope !== "workspace" && scope !== "project") {
    throw new BadRequestException("scope is invalid");
  }
  const organizationId = requiredString(body.organizationId, "organizationId");
  const workspaceId = scope === "organization" ? undefined : requiredString(body.workspaceId, "workspaceId");
  const projectId = scope === "project" ? requiredString(body.projectId, "projectId") : undefined;
  return {
    organizationId,
    ...(workspaceId ? { workspaceId } : {}),
    ...(projectId ? { projectId } : {}),
    membershipId: requiredString(body.membershipId, "membershipId"),
    roleId: requiredString(body.roleId, "roleId"),
    scope,
  };
}

@Controller("authorization")
@RequirePermission("organization.manage")
export class AuthorizationController {
  private readonly authorization = createAuthorizationRepository();
  private readonly audit = createSecurityEventsRepository();

  @Get("catalog")
  catalog(@Query("organizationId") organizationId: string, @Req() request: AuthenticatedRequest) {
    return this.authorization.listCatalog(identity(request).userId, requiredString(organizationId, "organizationId"));
  }

  @Post("roles")
  async createRole(@Body() body: JsonObject, @Req() request: AuthenticatedRequest) {
    const actor = identity(request);
    const organizationId = requiredString(body.organizationId, "organizationId");
    const role = await this.authorization.createCustomRole(
      actor.userId,
      organizationId,
      roleInput(body, true) as ReturnType<typeof roleInput> & { key: string },
    );
    await this.audit.record({
      userId: actor.userId,
      sessionId: actor.sessionId,
      eventType: "authorization_role_changed",
      outcome: "success",
      metadata: {
        action: "created",
        organizationId,
        roleId: role.id,
        roleKey: role.key,
        permissionKeys: role.permissionKeys,
      },
    });
    return role;
  }

  @Patch("roles/:id")
  async updateRole(@Param("id") roleId: string, @Body() body: JsonObject, @Req() request: AuthenticatedRequest) {
    const actor = identity(request);
    const organizationId = requiredString(body.organizationId, "organizationId");
    const role = await this.authorization.updateCustomRole(
      actor.userId,
      organizationId,
      roleId,
      roleInput(body, false),
    );
    if (!role) throw new NotFoundException("Custom role was not found");
    await this.audit.record({
      userId: actor.userId,
      sessionId: actor.sessionId,
      eventType: "authorization_role_changed",
      outcome: "success",
      metadata: { action: "updated", organizationId, roleId, permissionKeys: role.permissionKeys },
    });
    return role;
  }

  @Delete("roles/:id")
  async archiveRole(
    @Param("id") roleId: string,
    @Query("organizationId") organizationId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    const actor = identity(request);
    const archived = await this.authorization.archiveCustomRole(actor.userId, organizationId, roleId);
    if (!archived) throw new NotFoundException("Custom role was not found");
    await this.audit.record({
      userId: actor.userId,
      sessionId: actor.sessionId,
      eventType: "authorization_role_changed",
      outcome: "success",
      metadata: { action: "archived", organizationId, roleId },
    });
    return { ok: true };
  }

  @Post("bindings")
  async assignRole(@Body() body: JsonObject, @Req() request: AuthenticatedRequest) {
    const actor = identity(request);
    const input = assignmentScope(body);
    const binding = await this.authorization.assignRole(actor.userId, input);
    await this.audit.record({
      userId: actor.userId,
      sessionId: actor.sessionId,
      eventType: "authorization_binding_changed",
      outcome: "success",
      metadata: {
        action: "assigned",
        organizationId: input.organizationId,
        bindingId: binding.id,
        roleId: input.roleId,
        scope: input.scope,
      },
    });
    return binding;
  }

  @Delete("bindings/:id")
  async removeRole(
    @Param("id") bindingId: string,
    @Query("organizationId") organizationId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    const actor = identity(request);
    const removed = await this.authorization.removeRoleAssignment(actor.userId, organizationId, bindingId);
    if (!removed) throw new NotFoundException("Role assignment was not found or is primary");
    await this.audit.record({
      userId: actor.userId,
      sessionId: actor.sessionId,
      eventType: "authorization_binding_changed",
      outcome: "success",
      metadata: { action: "removed", organizationId, bindingId },
    });
    return { ok: true };
  }
}

@Controller("authorization/me")
@SelfService()
export class AuthorizationCapabilitiesController {
  constructor(
    @Inject(PlatformAdministrationService)
    private readonly platformAdministration: PlatformAdministrationService,
  ) {}

  @Get()
  async capabilities(@Req() request: AuthenticatedRequest) {
    const actor = identity(request);
    return {
      userId: actor.userId,
      isPlatformAdmin: await this.platformAdministration.isPlatformAdmin(actor.userId),
      tenant: request.tenant ?? null,
      member: request.authorization?.member ?? false,
      membershipId: request.authorization?.membershipId ?? null,
      roles: request.authorization?.roles ?? [],
      permissions: request.authorization?.permissions ?? [],
    };
  }
}
