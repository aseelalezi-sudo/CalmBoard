import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import {
  createOrganizationWorkspacesRepository,
  createWorkspaceDirectoryRepository,
  type CreateWorkspaceInput,
} from "@calmboard/database";
import { RequirePermission, SelfService, TenantMember } from "./permission.guard.js";
import { parseCreateProjectRequest } from "./project-validation.js";
import { createProjectService } from "./project.service.js";
import { parseTaskStatus } from "./task-validation.js";

type JsonObject = Record<string, unknown>;

function requiredString(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim()) throw new BadRequestException(`${field} is required`);
  return value.trim();
}

function optionalString(value: unknown, field: string) {
  if (value === undefined || value === null || value === "") return undefined;
  return requiredString(value, field);
}

@Controller("workspaces")
export class WorkspacesController {
  @Get()
  @SelfService()
  list(@Query("actorId") actorId: string) {
    return createWorkspaceDirectoryRepository(requiredString(actorId, "actorId")).listAccessible();
  }

  @Post()
  @RequirePermission("workspace.manage")
  create(@Body() body: JsonObject) {
    const organizationId = requiredString(body.organizationId, "organizationId");
    const actorId = requiredString(body.actorId, "actorId");
    const input: CreateWorkspaceInput = { name: requiredString(body.name, "name") };
    if (body.slug !== undefined) input.slug = requiredString(body.slug, "slug").toLowerCase().replace(/\s+/g, "-");
    if (body.color !== undefined) input.color = requiredString(body.color, "color");
    if (body.icon !== undefined) input.icon = requiredString(body.icon, "icon");
    if (body.description !== undefined) {
      if (body.description !== null && typeof body.description !== "string") {
        throw new BadRequestException("description must be a string or null");
      }
      input.description = body.description;
    }
    return createOrganizationWorkspacesRepository({ organizationId, actorId }).create(input);
  }
}

@Controller("projects")
export class ProjectsController {
  @Get()
  @TenantMember()
  list(
    @Query("organizationId") organizationId: string,
    @Query("workspaceId") workspaceId: string,
    @Query("actorId") actorId?: string,
  ) {
    return createProjectService({
      organizationId: requiredString(organizationId, "organizationId"),
      workspaceId: requiredString(workspaceId, "workspaceId"),
      actorId,
    }).list();
  }

  @Post()
  @RequirePermission("projects.create")
  create(@Body() body: JsonObject) {
    const request = parseCreateProjectRequest(body);
    return createProjectService(request.context).create(request.input);
  }

  @Get(":id/wip-limits")
  @TenantMember()
  getWipLimits(
    @Param("id") id: string,
    @Query("organizationId") organizationId: string,
    @Query("workspaceId") workspaceId: string,
    @Query("actorId") actorId?: string,
  ) {
    return createProjectService({
      organizationId: requiredString(organizationId, "organizationId"),
      workspaceId: requiredString(workspaceId, "workspaceId"),
      actorId,
    }).listWipLimits(id);
  }

  @Patch(":id/wip-limits")
  @RequirePermission("projects.update")
  setWipLimit(@Param("id") id: string, @Body() body: JsonObject) {
    const limit =
      body.limit === null || body.limit === 0
        ? null
        : typeof body.limit === "number" && Number.isInteger(body.limit) && body.limit >= 1 && body.limit <= 100_000
          ? body.limit
          : undefined;
    if (limit === undefined) throw new BadRequestException("limit must be null or an integer between 1 and 100000");
    return createProjectService({
      organizationId: requiredString(body.organizationId, "organizationId"),
      workspaceId: requiredString(body.workspaceId, "workspaceId"),
      actorId: optionalString(body.actorId, "actorId"),
    }).setWipLimit(id, parseTaskStatus(body.status), limit);
  }
}
