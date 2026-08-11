import { Controller, Get, Param, Query } from "@nestjs/common";
import { tenantContext } from "./request-validation.js";
import { RequirePermission } from "./permission.guard.js";
import { createSprintAnalyticsService } from "./sprint-analytics.service.js";
import { parseLimit, parseTimezone } from "./sprint-analytics.validation.js";

@Controller("/api/projects/:projectId/sprint-analytics")
export class SprintAnalyticsOverviewController {
  @Get("overview")
  @RequirePermission("sprints.view")
  async getOverview(
    @Param("projectId") projectId: string,
    @Query("organizationId") organizationId: string,
    @Query("workspaceId") workspaceId: string,
    @Query("actorId") actorId?: string,
  ) {
    const context = tenantContext(organizationId, workspaceId, actorId);
    const service = createSprintAnalyticsService(context);
    const data = await service.getOverview(projectId);
    return { ok: true, data };
  }

  @Get("velocity")
  @RequirePermission("sprints.view")
  async getVelocity(
    @Param("projectId") projectId: string,
    @Query("limit") limitRaw: string,
    @Query("organizationId") organizationId: string,
    @Query("workspaceId") workspaceId: string,
    @Query("actorId") actorId?: string,
  ) {
    const context = tenantContext(organizationId, workspaceId, actorId);
    const limit = parseLimit(limitRaw);
    const service = createSprintAnalyticsService(context);
    const data = await service.getVelocity(projectId, limit);
    return { ok: true, data };
  }
}

@Controller("/api/projects/:projectId/sprints/:sprintId/analytics")
export class SprintAnalyticsController {
  @Get()
  @RequirePermission("sprints.view")
  async getAnalytics(
    @Param("projectId") projectId: string,
    @Param("sprintId") sprintId: string,
    @Query("organizationId") organizationId: string,
    @Query("workspaceId") workspaceId: string,
    @Query("actorId") actorId?: string,
  ) {
    const context = tenantContext(organizationId, workspaceId, actorId);
    const service = createSprintAnalyticsService(context);
    const data = await service.getSprintAnalytics(sprintId, projectId);
    return { ok: true, data };
  }

  @Get("timeline")
  @RequirePermission("sprints.view")
  async getTimeline(
    @Param("projectId") projectId: string,
    @Param("sprintId") sprintId: string,
    @Query("timezone") timezoneRaw: string,
    @Query("organizationId") organizationId: string,
    @Query("workspaceId") workspaceId: string,
    @Query("actorId") actorId?: string,
  ) {
    const context = tenantContext(organizationId, workspaceId, actorId);
    const timezone = parseTimezone(timezoneRaw);
    const service = createSprintAnalyticsService(context);
    const data = await service.getSprintTimeline(sprintId, projectId, timezone);
    return { ok: true, data };
  }
}
