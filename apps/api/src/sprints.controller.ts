import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { requiredString, tenantContext, tenantContextFromBody, type JsonObject } from "./request-validation.js";
import {
  parseCreateSprintInput,
  parseUpdateSprintInput,
  parseCompleteSprintInput,
  parseMoveTaskSprintInput,
} from "./sprint-validation.js";
import { RequirePermission } from "./permission.guard.js";
import { createSprintService } from "./sprint.service.js";

@Controller("/api/projects/:projectId/sprints")
export class SprintsController {
  @Post()
  @RequirePermission("sprints.manage")
  async createSprint(@Param("projectId") projectId: string, @Body() body: JsonObject) {
    const context = tenantContextFromBody(body);
    const input = parseCreateSprintInput(body);
    const service = createSprintService(context);
    const sprint = await service.createSprint({
      ...input,
      projectId,
      createdBy: context.actorId ?? undefined,
      status: "planned",
    });

    return { ok: true, sprint };
  }

  @Get()
  @RequirePermission("sprints.view")
  async listSprints(
    @Param("projectId") projectId: string,
    @Query("organizationId") organizationId: string,
    @Query("workspaceId") workspaceId: string,
    @Query("actorId") actorId?: string,
  ) {
    const context = tenantContext(organizationId, workspaceId, actorId);
    const service = createSprintService(context);
    const sprints = await service.listSprints(projectId);

    return { ok: true, sprints };
  }

  @Get(":sprintId")
  @RequirePermission("sprints.view")
  async getSprint(
    @Param("projectId") projectId: string,
    @Param("sprintId") sprintId: string,
    @Query("organizationId") organizationId: string,
    @Query("workspaceId") workspaceId: string,
    @Query("actorId") actorId?: string,
  ) {
    const context = tenantContext(organizationId, workspaceId, actorId);
    const service = createSprintService(context);
    const sprint = await service.getSprint(sprintId);

    if (!sprint || sprint.projectId !== projectId) {
      throw new BadRequestException("Sprint not found");
    }

    return { ok: true, sprint };
  }

  @Patch(":sprintId")
  @RequirePermission("sprints.manage")
  async updateSprint(
    @Param("projectId") projectId: string,
    @Param("sprintId") sprintId: string,
    @Body() body: JsonObject,
  ) {
    const context = tenantContextFromBody(body);
    const input = parseUpdateSprintInput(body);
    const service = createSprintService(context);

    const updated = await service.updateSprint(sprintId, input, projectId);
    return { ok: true, sprint: updated };
  }

  @Post(":sprintId/start")
  @RequirePermission("sprints.manage")
  async startSprint(
    @Param("projectId") projectId: string,
    @Param("sprintId") sprintId: string,
    @Body() body: JsonObject,
  ) {
    const context = tenantContextFromBody(body);
    const service = createSprintService(context);
    const sprint = await service.startSprint(sprintId, projectId);
    return { ok: true, sprint };
  }

  @Post(":sprintId/complete")
  @RequirePermission("sprints.manage")
  async completeSprint(
    @Param("projectId") projectId: string,
    @Param("sprintId") sprintId: string,
    @Body() body: JsonObject,
  ) {
    const context = tenantContextFromBody(body);
    const destination = parseCompleteSprintInput(body);
    const service = createSprintService(context);
    const sprint = await service.completeSprint(sprintId, projectId, destination);
    return { ok: true, sprint };
  }

  @Post(":sprintId/cancel")
  @RequirePermission("sprints.manage")
  async cancelSprint(
    @Param("projectId") projectId: string,
    @Param("sprintId") sprintId: string,
    @Body() body: JsonObject,
  ) {
    const context = tenantContextFromBody(body);
    const service = createSprintService(context);
    const sprint = await service.cancelSprint(sprintId, projectId);
    return { ok: true, sprint };
  }

  @Post(":sprintId/tasks")
  @RequirePermission("sprints.manage")
  async assignTaskToSprint(
    @Param("projectId") projectId: string,
    @Param("sprintId") sprintId: string,
    @Body() body: JsonObject,
  ) {
    const context = tenantContextFromBody(body);
    const taskId = requiredString(body.taskId, "taskId");
    const service = createSprintService(context);

    await service.assignTaskToSprint(taskId, sprintId);
    return { ok: true };
  }

  @Post(":sprintId/tasks/:taskId/move")
  @RequirePermission("sprints.manage")
  async moveTaskBetweenSprints(
    @Param("projectId") projectId: string,
    @Param("sprintId") sprintId: string, // actually we don't strictly use sprintId for move except maybe as context
    @Param("taskId") taskId: string,
    @Body() body: JsonObject,
  ) {
    const context = tenantContextFromBody(body);
    const { targetSprintId, expectedFromSprintId } = parseMoveTaskSprintInput(body);
    const service = createSprintService(context);

    await service.moveTaskBetweenSprints(taskId, targetSprintId, expectedFromSprintId);
    return { ok: true };
  }

  @Delete(":sprintId/tasks/:taskId")
  @RequirePermission("sprints.manage")
  async removeTaskFromSprint(
    @Param("projectId") projectId: string,
    @Param("sprintId") sprintId: string,
    @Param("taskId") taskId: string,
    @Query("organizationId") organizationId: string,
    @Query("workspaceId") workspaceId: string,
    @Query("actorId") actorId?: string,
  ) {
    const context = tenantContext(organizationId, workspaceId, actorId);
    const service = createSprintService(context);
    await service.removeTaskFromSprint(taskId);
    return { ok: true };
  }
}
