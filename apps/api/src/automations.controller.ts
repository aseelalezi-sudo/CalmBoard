import { Body, Controller, Get, Patch, Post, Query } from "@nestjs/common";
import { createAutomationsRepository } from "@calmboard/database";
import {
  parseCreateAutomationInput,
  parseUpdateAutomationInput,
  requiredString,
  tenantContext,
  tenantContextFromBody,
  type JsonObject,
} from "./request-validation.js";
import { RequirePermission, TenantMember } from "./permission.guard.js";

@Controller("automations")
export class AutomationsController {
  @Get()
  @TenantMember()
  list(
    @Query("organizationId") organizationId: string,
    @Query("workspaceId") workspaceId: string,
    @Query("actorId") actorId?: string,
  ) {
    return createAutomationsRepository(tenantContext(organizationId, workspaceId, actorId)).list();
  }

  @Post()
  @RequirePermission("automations.manage")
  create(@Body() body: JsonObject) {
    return createAutomationsRepository(tenantContextFromBody(body)).create(parseCreateAutomationInput(body));
  }

  @Patch()
  @RequirePermission("automations.manage")
  update(@Body() body: JsonObject) {
    return createAutomationsRepository(tenantContextFromBody(body)).update(
      requiredString(body.id, "id"),
      parseUpdateAutomationInput(body),
    );
  }
}
