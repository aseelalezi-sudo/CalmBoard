import { Body, Controller, Delete, Get, Param, Post, Query } from "@nestjs/common";
import { createProjectBaselinesRepository } from "@calmboard/database";
import { RequirePermission, TenantMember } from "./permission.guard.js";
import { requiredString, tenantContext, tenantContextFromBody, type JsonObject } from "./request-validation.js";

@Controller("project-baselines")
export class ProjectBaselinesController {
  @Get()
  @TenantMember()
  list(
    @Query("organizationId") organizationId: string,
    @Query("workspaceId") workspaceId: string,
    @Query("projectId") projectId: string,
    @Query("actorId") actorId?: string,
  ) {
    return createProjectBaselinesRepository(tenantContext(organizationId, workspaceId, actorId)).list(projectId);
  }

  @Post()
  @RequirePermission("projects.update")
  create(@Body() body: JsonObject) {
    return createProjectBaselinesRepository(tenantContextFromBody(body)).create(
      requiredString(body.projectId, "projectId"),
      requiredString(body.name, "name"),
    );
  }

  @Delete(":id")
  @RequirePermission("projects.update")
  async delete(@Param("id") id: string, @Body() body: JsonObject) {
    await createProjectBaselinesRepository(tenantContextFromBody(body)).delete(
      id,
      requiredString(body.projectId, "projectId"),
    );
    return { ok: true };
  }
}
