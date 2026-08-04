import { Body, Controller, Get, Patch, Post, Query } from "@nestjs/common";
import { createMembershipsRepository } from "@calmboard/database";
import {
  parseInviteMemberInput,
  parseMembershipRoleUpdate,
  tenantContext,
  tenantContextFromBody,
  type JsonObject,
} from "./request-validation.js";
import { RequirePermission, TenantMember } from "./permission.guard.js";

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
}
