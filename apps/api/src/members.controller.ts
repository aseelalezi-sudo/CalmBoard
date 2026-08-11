import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from "@nestjs/common";
import {
  acceptInvitation,
  createMembershipsRepository,
  declineInvitation,
  inspectInvitation,
} from "@calmboard/database";
import {
  parseInviteMemberInput,
  parseMembershipRoleUpdate,
  requiredString,
  tenantContext,
  tenantContextFromBody,
  type JsonObject,
} from "./request-validation.js";
import type { AuthenticatedRequest } from "./auth.guard.js";
import { RequirePermission, SelfService, TenantMember } from "./permission.guard.js";
import { PublicRoute } from "./public-route.decorator.js";
import { SkipCsrf } from "./csrf.guard.js";
import { SkipTenantDatabaseTransaction } from "./tenant-database.interceptor.js";

@Controller("members")
export class MembersController {
  @Get()
  @TenantMember()
  list(
    @Query("organizationId") organizationId: string,
    @Query("workspaceId") workspaceId: string,
    @Query("actorId") actorId?: string,
  ) {
    return createMembershipsRepository(tenantContext(organizationId, workspaceId, actorId)).list();
  }

  @Post()
  @RequirePermission("members.invite")
  invite(@Body() body: JsonObject) {
    return createMembershipsRepository(tenantContextFromBody(body)).invite(parseInviteMemberInput(body));
  }

  @Patch()
  @RequirePermission("members.manage")
  updateRole(@Body() body: JsonObject) {
    const { membershipId, role } = parseMembershipRoleUpdate(body);
    return createMembershipsRepository(tenantContextFromBody(body)).updateRole(membershipId, role);
  }

  @Post(":id/resend")
  @RequirePermission("members.invite")
  resend(@Param("id") id: string, @Body() body: JsonObject) {
    return createMembershipsRepository(tenantContextFromBody(body)).resend(requiredString(id, "id"));
  }

  @Delete(":id")
  @RequirePermission("members.manage")
  revoke(@Param("id") id: string, @Body() body: JsonObject) {
    return createMembershipsRepository(tenantContextFromBody(body)).revoke(requiredString(id, "id"));
  }
}

@Controller("invitations")
export class InvitationsController {
  @Post("inspect")
  @PublicRoute()
  @SkipCsrf()
  @SkipTenantDatabaseTransaction()
  inspect(@Body() body: JsonObject) {
    return inspectInvitation(requiredString(body.token, "token"));
  }

  @Post("accept")
  @SelfService()
  @SkipTenantDatabaseTransaction()
  accept(@Body() body: JsonObject, @Req() request: AuthenticatedRequest) {
    return acceptInvitation(requiredString(body.token, "token"), request.auth!.userId);
  }

  @Post("decline")
  @SelfService()
  @SkipTenantDatabaseTransaction()
  decline(@Body() body: JsonObject, @Req() request: AuthenticatedRequest) {
    return declineInvitation(requiredString(body.token, "token"), request.auth!.userId);
  }
}
