import { Body, Controller, Delete, Get, Param, Post, Put, Query } from "@nestjs/common";
import { createWorkloadRepository } from "@calmboard/database";
import { RequirePermission, TenantMember } from "./permission.guard.js";
import { tenantContext, tenantContextFromBody, type JsonObject } from "./request-validation.js";
import { parseWorkloadCapacityInput, parseWorkloadRange, parseWorkloadTimeOffInput } from "./workload-validation.js";

@Controller("workload")
export class WorkloadController {
  @Get()
  @TenantMember()
  list(
    @Query("organizationId") organizationId: string,
    @Query("workspaceId") workspaceId: string,
    @Query("rangeStart") rangeStart?: string,
    @Query("rangeEnd") rangeEnd?: string,
    @Query("actorId") actorId?: string,
  ) {
    const range = parseWorkloadRange(rangeStart, rangeEnd);
    return createWorkloadRepository(tenantContext(organizationId, workspaceId, actorId)).list(
      range.rangeStart,
      range.rangeEnd,
    );
  }

  @Put("capacities/:userId")
  @RequirePermission("members.manage")
  updateCapacity(@Param("userId") userId: string, @Body() body: JsonObject) {
    return createWorkloadRepository(tenantContextFromBody(body)).upsertCapacity(
      parseWorkloadCapacityInput(body, userId),
    );
  }

  @Post("time-off")
  @RequirePermission("members.manage")
  createTimeOff(@Body() body: JsonObject) {
    return createWorkloadRepository(tenantContextFromBody(body)).createTimeOff(parseWorkloadTimeOffInput(body));
  }

  @Delete("time-off/:id")
  @RequirePermission("members.manage")
  async deleteTimeOff(@Param("id") id: string, @Body() body: JsonObject) {
    await createWorkloadRepository(tenantContextFromBody(body)).deleteTimeOff(id);
    return { ok: true };
  }
}
