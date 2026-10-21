import { Body, Controller, Get, Optional, Patch, Post, Query, Req } from "@nestjs/common";
import { createAutomationsRepository } from "@calmboard/database";
import type { AuthenticatedRequest } from "./auth.guard.js";
import {
  parseCreateAutomationInput,
  parseUpdateAutomationInput,
  requiredString,
  tenantContext,
  type JsonObject,
} from "./request-validation.js";
import { RequirePermission, TenantMember } from "./permission.guard.js";

@Controller("automations")
export class AutomationsController {
  constructor(@Optional() private readonly repositoryFactory = createAutomationsRepository) {}

  @Get()
  @TenantMember()
  list(
    @Req() request: AuthenticatedRequest,
    @Query("organizationId") organizationId: string,
    @Query("workspaceId") workspaceId: string,
  ) {
    const actorId = request.auth?.userId;
    return this.repositoryFactory(tenantContext(organizationId, workspaceId, actorId)).list();
  }

  @Post()
  @RequirePermission("automations.manage")
  create(@Req() request: AuthenticatedRequest, @Body() body: JsonObject) {
    const actorId = request.auth?.userId;
    const organizationId = requiredString(body.organizationId, "organizationId");
    const workspaceId = requiredString(body.workspaceId, "workspaceId");
    return this.repositoryFactory(tenantContext(organizationId, workspaceId, actorId)).create(
      parseCreateAutomationInput(body),
    );
  }

  @Patch()
  @RequirePermission("automations.manage")
  update(@Req() request: AuthenticatedRequest, @Body() body: JsonObject) {
    const actorId = request.auth?.userId;
    const organizationId = requiredString(body.organizationId, "organizationId");
    const workspaceId = requiredString(body.workspaceId, "workspaceId");
    return this.repositoryFactory(tenantContext(organizationId, workspaceId, actorId)).update(
      requiredString(body.id, "id"),
      parseUpdateAutomationInput(body),
    );
  }
}
