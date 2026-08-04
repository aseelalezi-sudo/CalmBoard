import { Controller, Get, Query } from "@nestjs/common";
import { createActivitiesRepository } from "@calmboard/database";
import { tenantContext } from "./request-validation.js";
import { RequirePermission } from "./permission.guard.js";

@Controller("activities")
export class ActivitiesController {
  @Get()
  @RequirePermission("audit.view")
  list(
    @Query("organizationId") organizationId: string,
    @Query("workspaceId") workspaceId: string,
    @Query("actorId") actorId?: string,
    @Query("limit") requestedLimit?: string,
  ) {
    const parsedLimit = Number(requestedLimit ?? 40);
    const limit = Number.isFinite(parsedLimit) ? parsedLimit : 40;
    return createActivitiesRepository(tenantContext(organizationId, workspaceId, actorId)).list(limit);
  }
}
