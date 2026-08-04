import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from "@nestjs/common";
import {
  createBranchesRepository,
  createDashboardLayoutsRepository,
  createGoalsRepository,
  createInvoicesRepository,
  createSavedViewsRepository,
  createTimeLogsRepository,
  type CreateGoalInput,
  type GoalMeasurementUnit,
  type GoalProgressMode,
  type UpdateGoalInput,
} from "@calmboard/database";
import {
  isJsonObject,
  optionalString,
  organizationContext,
  requiredString,
  tenantContext,
  tenantContextFromBody,
  type JsonObject,
} from "./request-validation.js";
import { RequirePermission, SelfService, TenantMember } from "./permission.guard.js";
import { parseCreateSavedViewInput, parseUpdateSavedViewInput } from "./saved-view-validation.js";
import type { AuthenticatedRequest } from "./auth.guard.js";
import { parseDashboardExpectedVersion, parseDashboardWidgets } from "./dashboard-layout-validation.js";

function finiteNumber(value: unknown, field: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new BadRequestException(`${field} must be a finite number`);
  }
  return value;
}

function optionalDate(value: unknown, field: string) {
  if (value === undefined || value === null || value === "") return value === undefined ? undefined : null;
  if (typeof value !== "string" && !(value instanceof Date)) throw new BadRequestException(`${field} must be a date`);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new BadRequestException(`${field} must be a valid date`);
  return date;
}

function goalProgress(value: unknown) {
  const progress = finiteNumber(value, "progress");
  if (progress < 0 || progress > 100) throw new BadRequestException("progress must be between 0 and 100");
  return progress;
}

function goalType(value: unknown) {
  const type = requiredString(value, "type");
  if (type !== "objective" && type !== "key_result") throw new BadRequestException("type is invalid");
  return type;
}

function goalProgressMode(value: unknown): GoalProgressMode {
  const mode = requiredString(value, "progressMode");
  if (!["manual", "measurement", "tasks", "children"].includes(mode)) {
    throw new BadRequestException("progressMode is invalid");
  }
  return mode as GoalProgressMode;
}

function goalMeasurementUnit(value: unknown): GoalMeasurementUnit {
  const unit = requiredString(value, "measurementUnit");
  if (!["percentage", "number", "currency", "boolean"].includes(unit)) {
    throw new BadRequestException("measurementUnit is invalid");
  }
  return unit as GoalMeasurementUnit;
}

function optionalFiniteNumber(value: unknown, field: string) {
  return value === undefined ? undefined : finiteNumber(value, field);
}

function createGoalInput(body: JsonObject): CreateGoalInput {
  const type = body.type === undefined ? "objective" : goalType(body.type);
  return {
    title: requiredString(body.title, "title"),
    description: typeof body.description === "string" ? body.description : "",
    type,
    parentId: optionalString(body.parentId, "parentId") ?? null,
    progressMode:
      type === "objective"
        ? "children"
        : body.progressMode === undefined
          ? "measurement"
          : goalProgressMode(body.progressMode),
    measurementUnit: body.measurementUnit === undefined ? "percentage" : goalMeasurementUnit(body.measurementUnit),
    startValue: optionalFiniteNumber(body.startValue, "startValue") ?? 0,
    currentValue: optionalFiniteNumber(body.currentValue, "currentValue") ?? 0,
    targetValue: optionalFiniteNumber(body.targetValue, "targetValue") ?? 100,
    weight: optionalFiniteNumber(body.weight, "weight") ?? 1,
    ownerId: optionalString(body.ownerId, "ownerId") ?? null,
    periodStart: optionalDate(body.periodStart, "periodStart") ?? new Date(),
    periodEnd: optionalDate(body.periodEnd, "periodEnd") ?? null,
  };
}

function updateGoalInput(body: JsonObject): UpdateGoalInput {
  const input: UpdateGoalInput = {};
  if (body.title !== undefined) input.title = requiredString(body.title, "title");
  if (body.description !== undefined) {
    if (body.description !== null && typeof body.description !== "string") {
      throw new BadRequestException("description must be a string or null");
    }
    input.description = body.description;
  }
  if (body.ownerId !== undefined) input.ownerId = optionalString(body.ownerId, "ownerId") ?? null;
  if (body.parentId !== undefined) input.parentId = optionalString(body.parentId, "parentId") ?? null;
  if (body.progressMode !== undefined) input.progressMode = goalProgressMode(body.progressMode);
  if (body.measurementUnit !== undefined) input.measurementUnit = goalMeasurementUnit(body.measurementUnit);
  if (body.startValue !== undefined) input.startValue = finiteNumber(body.startValue, "startValue");
  if (body.currentValue !== undefined) input.currentValue = finiteNumber(body.currentValue, "currentValue");
  if (body.targetValue !== undefined) input.targetValue = finiteNumber(body.targetValue, "targetValue");
  if (body.weight !== undefined) input.weight = finiteNumber(body.weight, "weight");
  if (body.periodStart !== undefined) input.periodStart = optionalDate(body.periodStart, "periodStart");
  if (body.periodEnd !== undefined) input.periodEnd = optionalDate(body.periodEnd, "periodEnd");
  if (!Object.keys(input).length) throw new BadRequestException("at least one goal field is required");
  return input;
}

@Controller("branches")
export class BranchesController {
  @Get()
  @TenantMember()
  list(@Query("organizationId") organizationId: string, @Query("actorId") actorId?: string) {
    return createBranchesRepository(organizationContext(organizationId, actorId)).list();
  }

  @Post()
  @RequirePermission("branches.manage")
  create(@Body() body: JsonObject) {
    return createBranchesRepository(organizationContext(body.organizationId, body.actorId)).create({
      name: requiredString(body.name, "name"),
      code: optionalString(body.code, "code") ?? `BR-${Math.floor(Math.random() * 900 + 100)}`,
      city: optionalString(body.city, "city") ?? "الرياض",
      address: typeof body.address === "string" ? body.address : "",
    });
  }
}

@Controller("invoices")
export class InvoicesController {
  @Get()
  @RequirePermission("billing.manage")
  list(@Query("organizationId") organizationId: string, @Query("actorId") actorId?: string) {
    return createInvoicesRepository(organizationContext(organizationId, actorId)).list();
  }
}

@Controller("goals")
export class GoalsController {
  @Get()
  @TenantMember()
  list(
    @Query("organizationId") organizationId: string,
    @Query("workspaceId") workspaceId: string,
    @Query("actorId") actorId?: string,
  ) {
    return createGoalsRepository(tenantContext(organizationId, workspaceId, actorId)).list();
  }

  @Post()
  @RequirePermission("goals.manage")
  create(@Body() body: JsonObject) {
    return createGoalsRepository(tenantContextFromBody(body)).create(createGoalInput(body));
  }

  @Patch()
  @RequirePermission("goals.manage")
  update(@Body() body: JsonObject) {
    return createGoalsRepository(tenantContextFromBody(body)).update(
      requiredString(body.id, "id"),
      updateGoalInput(body),
    );
  }

  @Post(":id/checkins")
  @RequirePermission("goals.manage")
  checkIn(@Param("id") id: string, @Body() body: JsonObject) {
    return createGoalsRepository(tenantContextFromBody(body)).checkIn(id, {
      note: requiredString(body.note, "note"),
      ...(body.progress === undefined ? {} : { progress: goalProgress(body.progress) }),
      ...(body.currentValue === undefined ? {} : { currentValue: finiteNumber(body.currentValue, "currentValue") }),
    });
  }

  @Post(":id/tasks")
  @RequirePermission("goals.manage")
  linkTask(@Param("id") id: string, @Body() body: JsonObject) {
    return createGoalsRepository(tenantContextFromBody(body)).linkTask(
      id,
      requiredString(body.taskId, "taskId"),
      optionalFiniteNumber(body.weight, "weight") ?? 1,
    );
  }

  @Delete(":id/tasks")
  @RequirePermission("goals.manage")
  unlinkTask(
    @Param("id") id: string,
    @Query("organizationId") organizationId: string,
    @Query("workspaceId") workspaceId: string,
    @Query("actorId") actorId: string,
    @Query("taskId") taskId: string,
  ) {
    return createGoalsRepository(tenantContext(organizationId, workspaceId, actorId)).unlinkTask(
      id,
      requiredString(taskId, "taskId"),
    );
  }
}

@Controller("saved-views")
export class SavedViewsController {
  @Get()
  @TenantMember()
  list(
    @Query("organizationId") organizationId: string,
    @Query("workspaceId") workspaceId: string,
    @Query("projectId") projectId?: string,
    @Query("actorId") actorId?: string,
  ) {
    return createSavedViewsRepository(tenantContext(organizationId, workspaceId, actorId)).list(
      optionalString(projectId, "projectId"),
    );
  }

  @Post()
  @RequirePermission("saved_views.manage")
  create(@Body() body: JsonObject) {
    return createSavedViewsRepository(tenantContextFromBody(body)).create(parseCreateSavedViewInput(body));
  }

  @Patch()
  @RequirePermission("saved_views.manage")
  async update(@Body() body: JsonObject) {
    const repository = createSavedViewsRepository(tenantContextFromBody(body));
    const id = requiredString(body.id, "id");
    const viewType = requiredString(body.viewType, "viewType") as import("@calmboard/database").SavedViewType;
    return repository.update(id, viewType, parseUpdateSavedViewInput(body, viewType));
  }

  @Delete()
  @RequirePermission("saved_views.manage")
  async delete(
    @Query("organizationId") organizationId: string,
    @Query("workspaceId") workspaceId: string,
    @Query("id") id: string,
    @Query("actorId") actorId?: string,
  ) {
    await createSavedViewsRepository(tenantContext(organizationId, workspaceId, actorId)).delete(
      requiredString(id, "id"),
    );
    return { ok: true };
  }
}

@Controller("time-logs")
export class TimeLogsController {
  @Get()
  @TenantMember()
  list(
    @Query("organizationId") organizationId: string,
    @Query("workspaceId") workspaceId: string,
    @Query("actorId") actorId?: string,
    @Req() request?: AuthenticatedRequest,
  ) {
    return createTimeLogsRepository(tenantContext(organizationId, workspaceId, actorId)).list({
      includeReviewQueue: request?.authorization?.permissions.includes("timesheets.review") ?? false,
    });
  }

  @Post()
  @RequirePermission("time_logs.manage")
  create(@Body() body: JsonObject) {
    const duration = finiteNumber(body.durationMinutes, "durationMinutes");
    if (duration <= 0) throw new BadRequestException("durationMinutes must be greater than zero");
    const durationMinutes = Math.max(1, Math.round(duration));
    return createTimeLogsRepository(tenantContextFromBody(body)).create({
      taskId: requiredString(body.taskId, "taskId"),
      durationMinutes,
      description: typeof body.description === "string" ? body.description : "",
      billable: body.billable === undefined ? true : body.billable === true,
      startedAt: optionalDate(body.startedAt, "startedAt") ?? undefined,
    });
  }
}

@Controller("timesheets")
export class TimesheetsController {
  @Post(":id/submit")
  @RequirePermission("time_logs.manage")
  submit(@Param("id") id: string, @Body() body: JsonObject) {
    const expectedVersion = finiteNumber(body.expectedVersion, "expectedVersion");
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
      throw new BadRequestException("expectedVersion must be a positive integer");
    }
    return createTimeLogsRepository(tenantContextFromBody(body)).submit(requiredString(id, "id"), expectedVersion);
  }

  @Post(":id/review")
  @RequirePermission("timesheets.review")
  review(@Param("id") id: string, @Body() body: JsonObject) {
    const decision = requiredString(body.decision, "decision");
    if (decision !== "approved" && decision !== "rejected") {
      throw new BadRequestException("decision must be approved or rejected");
    }
    const expectedVersion = finiteNumber(body.expectedVersion, "expectedVersion");
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
      throw new BadRequestException("expectedVersion must be a positive integer");
    }
    return createTimeLogsRepository(tenantContextFromBody(body)).review(requiredString(id, "id"), {
      decision,
      expectedVersion,
      reason: optionalString(body.reason, "reason") ?? undefined,
    });
  }
}

@Controller("dashboard-layout")
export class DashboardLayoutController {
  @Get()
  @TenantMember()
  get(
    @Req() request: AuthenticatedRequest,
    @Query("organizationId") organizationId: string,
    @Query("workspaceId") workspaceId: string,
  ) {
    return createDashboardLayoutsRepository(tenantContext(organizationId, workspaceId, request.auth?.userId)).get();
  }

  @Patch()
  @SelfService()
  update(@Req() request: AuthenticatedRequest, @Body() body: JsonObject) {
    return createDashboardLayoutsRepository(
      tenantContext(body.organizationId, body.workspaceId, request.auth?.userId),
    ).update(parseDashboardWidgets(body.widgets), parseDashboardExpectedVersion(body.expectedVersion));
  }
}
