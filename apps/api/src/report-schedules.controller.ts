import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { createReportSchedulesRepository } from "@calmboard/database";
import { RequirePermission } from "./permission.guard.js";
import { requiredString, tenantContext, tenantContextFromBody, type JsonObject } from "./request-validation.js";
import { parseExpectedReportScheduleVersion, parseReportScheduleInput } from "./report-schedule-validation.js";

@Controller("workspaces/report-schedules")
@RequirePermission("data.export")
export class ReportSchedulesController {
  @Get()
  list(
    @Query("organizationId") organizationId: string,
    @Query("workspaceId") workspaceId: string,
    @Query("actorId") actorId?: string,
  ) {
    return createReportSchedulesRepository(tenantContext(organizationId, workspaceId, actorId)).list();
  }

  @Post()
  create(@Body() body: JsonObject) {
    return createReportSchedulesRepository(tenantContextFromBody(body)).create(parseReportScheduleInput(body));
  }

  @Patch(":scheduleId")
  update(@Param("scheduleId") scheduleId: string, @Body() body: JsonObject) {
    return createReportSchedulesRepository(tenantContextFromBody(body)).update(
      requiredString(scheduleId, "scheduleId"),
      parseExpectedReportScheduleVersion(body.expectedVersion),
      parseReportScheduleInput(body),
    );
  }

  @Delete(":scheduleId")
  delete(@Param("scheduleId") scheduleId: string, @Body() body: JsonObject) {
    return createReportSchedulesRepository(tenantContextFromBody(body)).delete(
      requiredString(scheduleId, "scheduleId"),
    );
  }
}
