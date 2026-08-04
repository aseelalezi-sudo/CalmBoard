import { Body, Controller, Delete, Get, Post, Query } from "@nestjs/common";
import { createCustomFieldsRepository } from "@calmboard/database";
import {
  parseCreateCustomFieldInput,
  requiredString,
  tenantContext,
  tenantContextFromBody,
  type JsonObject,
} from "./request-validation.js";
import { RequirePermission, TenantMember } from "./permission.guard.js";

@Controller("custom-fields")
export class CustomFieldsController {
  @Get()
  @TenantMember()
  list(
    @Query("organizationId") organizationId: string,
    @Query("workspaceId") workspaceId: string,
    @Query("actorId") actorId?: string,
  ) {
    return createCustomFieldsRepository(tenantContext(organizationId, workspaceId, actorId)).list();
  }

  @Post()
  @RequirePermission("custom_fields.manage")
  create(@Body() body: JsonObject) {
    return createCustomFieldsRepository(tenantContextFromBody(body)).create(parseCreateCustomFieldInput(body));
  }

  @Delete()
  @RequirePermission("custom_fields.manage")
  async delete(
    @Query("organizationId") organizationId: string,
    @Query("workspaceId") workspaceId: string,
    @Query("id") id: string,
    @Query("actorId") actorId?: string,
  ) {
    await createCustomFieldsRepository(tenantContext(organizationId, workspaceId, actorId)).delete(
      requiredString(id, "id"),
    );
    return { ok: true };
  }
}
