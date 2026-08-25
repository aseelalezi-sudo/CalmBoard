import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import { createIdempotencyRepository } from "@calmboard/database";
import { createTaskService } from "./task.service.js";
import { createTaskWatcherService } from "./task-watcher.service.js";
import { type AuthenticatedRequest } from "./auth.guard.js";
import {
  requiredIdempotencyKey,
  requiredString,
  tenantContext,
  tenantContextFromBody,
  type JsonObject,
} from "./request-validation.js";
import {
  parseCreateTaskInput,
  parseMoveTaskInput,
  parseTaskImportInput,
  parseTaskPriority,
  parseTaskStatus,
  parseUpdateTaskInput,
} from "./task-validation.js";
import {
  parseTaskApprovalDecision,
  parseTaskApprovalRequest,
  parseTaskChecklists,
} from "./task-workflow-validation.js";
import { RequirePermission, TenantMember } from "./permission.guard.js";

const taskSortFields = new Set([
  "order",
  "createdAt",
  "updatedAt",
  "dueDate",
  "priority",
  "title",
  "status",
  "assigneeId",
  "storyPoints",
  "estimatedHours",
  "loggedHours",
] as const);

export function parseQueryDate(value: string, field: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new BadRequestException(`${field} must be a valid date`);
  return date;
}

function parsePageLimit(value?: string) {
  if (!value || !/^\d+$/.test(value)) throw new BadRequestException("limit is required for cursor pagination");
  const limit = Number(value);
  if (limit < 1 || limit > 100) throw new BadRequestException("limit must be between 1 and 100");
  return limit;
}

function parseSortBy(
  value?: string,
):
  | "order"
  | "createdAt"
  | "updatedAt"
  | "dueDate"
  | "priority"
  | "title"
  | "status"
  | "assigneeId"
  | "storyPoints"
  | "estimatedHours"
  | "loggedHours"
  | undefined {
  if (value === undefined) return undefined;
  if (!taskSortFields.has(value as typeof taskSortFields extends Set<infer T> ? T : never)) {
    throw new BadRequestException("sortBy is invalid");
  }
  return value as
    | "order"
    | "createdAt"
    | "updatedAt"
    | "dueDate"
    | "priority"
    | "title"
    | "status"
    | "assigneeId"
    | "storyPoints"
    | "estimatedHours"
    | "loggedHours";
}

function parseSortDirection(value?: string): "asc" | "desc" | undefined {
  if (value === undefined) return undefined;
  if (value !== "asc" && value !== "desc") throw new BadRequestException("sortDirection is invalid");
  return value;
}

function watcherTenantContext(
  request: AuthenticatedRequest,
  body?: JsonObject,
  query?: { organizationId?: string; workspaceId?: string },
) {
  const userId = request.auth?.userId;
  if (!userId) throw new UnauthorizedException("Authentication is required");
  const organizationId = (typeof body?.organizationId === "string" && body.organizationId) || query?.organizationId;
  const workspaceId = (typeof body?.workspaceId === "string" && body.workspaceId) || query?.workspaceId;
  return tenantContext(organizationId, workspaceId, userId);
}

@Controller("tasks")
export class TasksController {
  @Get()
  @TenantMember()
  list(
    @Query("organizationId") organizationId: string,
    @Query("workspaceId") workspaceId: string,
    @Query("actorId") actorId?: string,
    @Query("projectId") projectId?: string,
    @Query("parentId") parentId?: string,
    @Query("search") search?: string,
    @Query("status") status?: string,
    @Query("priority") priority?: string,
    @Query("assigneeId") assigneeId?: string,
    @Query("sectionId") sectionId?: string,
    @Query("tag") tag?: string,
    @Query("dueFrom") dueFrom?: string,
    @Query("dueTo") dueTo?: string,
    @Query("calendarFrom") calendarFrom?: string,
    @Query("calendarTo") calendarTo?: string,
    @Query("sortBy") sortBy?: string,
    @Query("sortDirection") sortDirection?: string,
    @Query("includeSubtasks") includeSubtasks?: string,
    @Query("limit") limit?: string,
    @Query("cursor") cursor?: string,
  ) {
    const filters = {
      projectId,
      parentId,
      search,
      status: status ? parseTaskStatus(status) : undefined,
      priority: priority ? parseTaskPriority(priority) : undefined,
      assigneeId,
      sectionId,
      tag,
      dueFrom: dueFrom ? parseQueryDate(dueFrom, "dueFrom") : undefined,
      dueTo: dueTo ? parseQueryDate(dueTo, "dueTo") : undefined,
      calendarFrom: calendarFrom ? parseQueryDate(calendarFrom, "calendarFrom") : undefined,
      calendarTo: calendarTo ? parseQueryDate(calendarTo, "calendarTo") : undefined,
      sortBy: parseSortBy(sortBy),
      sortDirection: parseSortDirection(sortDirection),
      includeSubtasks: includeSubtasks === "true",
    };
    const service = createTaskService(tenantContext(organizationId, workspaceId, actorId));
    if (limit !== undefined || cursor !== undefined) {
      return service.listPage({ ...filters, limit: parsePageLimit(limit), cursor });
    }
    return service.list(filters);
  }

  @Get(":id")
  @TenantMember()
  details(
    @Param("id") id: string,
    @Query("organizationId") organizationId: string,
    @Query("workspaceId") workspaceId: string,
    @Query("actorId") actorId?: string,
  ) {
    return createTaskService(tenantContext(organizationId, workspaceId, actorId)).getDetails(id);
  }

  @Post()
  @RequirePermission("tasks.create")
  async create(@Body() body: JsonObject, @Headers("idempotency-key") idempotencyKeyHeader = "") {
    const context = tenantContextFromBody(body);
    const input = parseCreateTaskInput(body);
    const result = await createIdempotencyRepository(context).execute({
      key: requiredIdempotencyKey(idempotencyKeyHeader),
      scope: "tasks.create",
      request: input,
      operation: async () => ({ body: await createTaskService(context).create(input), statusCode: 201 }),
    });
    return result.body;
  }

  @Post("import")
  @RequirePermission("tasks.create")
  async importTasks(@Body() body: JsonObject, @Headers("idempotency-key") idempotencyKeyHeader = "") {
    const context = tenantContextFromBody(body);
    const inputs = parseTaskImportInput(body);
    const result = await createIdempotencyRepository(context).execute({
      key: requiredIdempotencyKey(idempotencyKeyHeader),
      scope: "tasks.import",
      request: inputs,
      operation: async () => {
        const items = await createTaskService(context).importTasks(inputs);
        return { body: { items, importedCount: items.length }, statusCode: 201 };
      },
    });
    return result.body;
  }

  @Patch()
  @RequirePermission("tasks.update")
  update(@Body() body: JsonObject) {
    return createTaskService(tenantContextFromBody(body)).update(
      requiredString(body.id, "id"),
      parseUpdateTaskInput(body),
    );
  }

  @Patch(":id")
  @RequirePermission("tasks.update")
  updateById(@Param("id") id: string, @Body() body: JsonObject) {
    return createTaskService(tenantContextFromBody(body)).update(id, parseUpdateTaskInput(body));
  }

  @Patch(":id/move")
  @RequirePermission("tasks.update")
  move(@Param("id") id: string, @Body() body: JsonObject) {
    return createTaskService(tenantContextFromBody(body)).move(id, parseMoveTaskInput(body));
  }

  @Patch(":id/checklists")
  @RequirePermission("tasks.update")
  replaceChecklists(@Param("id") id: string, @Body() body: JsonObject) {
    return createTaskService(tenantContextFromBody(body)).replaceChecklists(id, parseTaskChecklists(body.checklists));
  }

  @Patch("checklist-items/:itemId")
  @RequirePermission("tasks.update")
  setChecklistItemCompletion(@Param("itemId") itemId: string, @Body() body: JsonObject) {
    if (typeof body.isCompleted !== "boolean") throw new BadRequestException("isCompleted must be a boolean");
    return createTaskService(tenantContextFromBody(body)).setChecklistItemCompletion(itemId, body.isCompleted);
  }

  @Post(":id/approvals")
  @RequirePermission("tasks.update")
  requestApproval(@Param("id") id: string, @Body() body: JsonObject) {
    return createTaskService(tenantContextFromBody(body)).requestApproval(parseTaskApprovalRequest(id, body));
  }

  @Post("approvals/:approvalRequestId/decision")
  @RequirePermission("tasks.update")
  decideApproval(@Param("approvalRequestId") approvalRequestId: string, @Body() body: JsonObject) {
    const input = parseTaskApprovalDecision(body);
    return createTaskService(tenantContextFromBody(body)).decideApproval(
      approvalRequestId,
      input.decision,
      input.comment,
    );
  }

  @Post("approvals/:approvalRequestId/cancel")
  @RequirePermission("tasks.update")
  cancelApproval(@Param("approvalRequestId") approvalRequestId: string, @Body() body: JsonObject) {
    return createTaskService(tenantContextFromBody(body)).cancelApproval(approvalRequestId);
  }

  @Post(":id/watch")
  @TenantMember()
  selfWatch(
    @Param("id") id: string,
    @Req() request: AuthenticatedRequest,
    @Body() body: JsonObject = {},
    @Query("organizationId") organizationId?: string,
    @Query("workspaceId") workspaceId?: string,
  ) {
    const context = watcherTenantContext(request, body, { organizationId, workspaceId });
    return createTaskWatcherService(context).selfWatch(id, request.auth!.userId);
  }

  @Delete(":id/watch")
  @TenantMember()
  selfUnwatch(
    @Param("id") id: string,
    @Req() request: AuthenticatedRequest,
    @Body() body: JsonObject = {},
    @Query("organizationId") organizationId?: string,
    @Query("workspaceId") workspaceId?: string,
  ) {
    const context = watcherTenantContext(request, body, { organizationId, workspaceId });
    return createTaskWatcherService(context).selfUnwatch(id, request.auth!.userId);
  }

  @Post(":id/watchers/:userId")
  @RequirePermission("tasks.update")
  addWatcher(
    @Param("id") id: string,
    @Param("userId") targetUserId: string,
    @Req() request: AuthenticatedRequest,
    @Body() body: JsonObject = {},
    @Query("organizationId") organizationId?: string,
    @Query("workspaceId") workspaceId?: string,
  ) {
    const context = watcherTenantContext(request, body, { organizationId, workspaceId });
    return createTaskWatcherService(context).addWatcher(id, targetUserId, request.auth!.userId);
  }

  @Delete(":id/watchers/:userId")
  @RequirePermission("tasks.update")
  removeWatcher(
    @Param("id") id: string,
    @Param("userId") targetUserId: string,
    @Req() request: AuthenticatedRequest,
    @Body() body: JsonObject = {},
    @Query("organizationId") organizationId?: string,
    @Query("workspaceId") workspaceId?: string,
  ) {
    const context = watcherTenantContext(request, body, { organizationId, workspaceId });
    return createTaskWatcherService(context).removeWatcher(id, targetUserId, request.auth!.userId);
  }

  @Delete(":id")
  @RequirePermission("tasks.delete")
  async delete(
    @Param("id") id: string,
    @Query("organizationId") organizationId: string,
    @Query("workspaceId") workspaceId: string,
    @Query("actorId") actorId?: string,
  ) {
    await createTaskService(tenantContext(organizationId, workspaceId, actorId)).delete(id);
    return { ok: true };
  }
}
