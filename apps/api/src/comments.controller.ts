import { BadRequestException, Body, Controller, Delete, Get, Headers, Patch, Post, Query } from "@nestjs/common";
import { createCommentsRepository, createIdempotencyRepository, type UpdateCommentInput } from "@calmboard/database";
import {
  isJsonObject,
  requiredIdempotencyKey,
  requiredString,
  tenantContext,
  tenantContextFromBody,
  type JsonObject,
} from "./request-validation.js";
import { RequirePermission, TenantMember } from "./permission.guard.js";

function isReactions(value: unknown): value is Record<string, string[]> {
  return (
    isJsonObject(value) &&
    Object.values(value).every(
      (reactionUsers) =>
        Array.isArray(reactionUsers) && reactionUsers.every((reactionUser) => typeof reactionUser === "string"),
    )
  );
}

function mentionedUserIds(value: unknown) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((id) => typeof id !== "string" || !id)) {
    throw new BadRequestException("mentionedUserIds must be an array of user identifiers");
  }
  if (value.length > 50) throw new BadRequestException("mentionedUserIds must contain at most 50 users");
  return [...new Set(value as string[])];
}

@Controller("comments")
export class CommentsController {
  @Get("mentions")
  @TenantMember()
  eligibleMentions(
    @Query("organizationId") organizationId: string,
    @Query("workspaceId") workspaceId: string,
    @Query("taskId") taskId: string,
    @Query("search") search = "",
    @Query("actorId") actorId?: string,
  ) {
    return createCommentsRepository(tenantContext(organizationId, workspaceId, actorId)).listEligibleMentionUsers(
      requiredString(taskId, "taskId"),
      search,
    );
  }

  @Get()
  @TenantMember()
  list(
    @Query("organizationId") organizationId: string,
    @Query("workspaceId") workspaceId: string,
    @Query("taskId") taskId?: string,
    @Query("actorId") actorId?: string,
  ) {
    if (!taskId) return [];
    return createCommentsRepository(tenantContext(organizationId, workspaceId, actorId)).listByTask(taskId);
  }

  @Post()
  @RequirePermission("comments.manage")
  async create(@Body() body: JsonObject, @Headers("idempotency-key") idempotencyKeyHeader = "") {
    const context = tenantContextFromBody(body);
    const input = {
      taskId: requiredString(body.taskId, "taskId"),
      userId: requiredString(body.userId, "userId"),
      content: requiredString(body.content, "content"),
      parentId: typeof body.parentId === "string" && body.parentId ? body.parentId : undefined,
      mentionedUserIds: mentionedUserIds(body.mentionedUserIds),
    };
    const result = await createIdempotencyRepository(context).execute({
      key: requiredIdempotencyKey(idempotencyKeyHeader),
      scope: "comments.create",
      request: input,
      operation: async () => ({ body: await createCommentsRepository(context).create(input), statusCode: 201 }),
    });
    return result.body;
  }

  @Patch()
  @RequirePermission("comments.manage")
  async update(@Body() body: JsonObject, @Headers("idempotency-key") idempotencyKeyHeader = "") {
    const updates: UpdateCommentInput = {};
    if (body.reactions !== undefined) {
      if (!isReactions(body.reactions)) throw new BadRequestException("reactions must map emoji to user names");
      updates.reactions = body.reactions;
    }
    if (body.content !== undefined) updates.content = requiredString(body.content, "content");
    if (body.isPinned !== undefined) {
      if (typeof body.isPinned !== "boolean") throw new BadRequestException("isPinned must be a boolean");
      updates.isPinned = body.isPinned;
    }
    if (body.mentionedUserIds !== undefined) updates.mentionedUserIds = mentionedUserIds(body.mentionedUserIds);
    if (!Object.keys(updates).length) throw new BadRequestException("at least one comment field is required");
    const context = tenantContextFromBody(body);
    const id = requiredString(body.id, "id");
    const result = await createIdempotencyRepository(context).execute({
      key: requiredIdempotencyKey(idempotencyKeyHeader),
      scope: "comments.update",
      request: { id, updates },
      operation: async () => ({ body: await createCommentsRepository(context).update(id, updates) }),
    });
    return result.body;
  }

  @Delete()
  @RequirePermission("comments.manage")
  async delete(
    @Query("organizationId") organizationId: string,
    @Query("workspaceId") workspaceId: string,
    @Query("id") id: string,
    @Query("actorId") actorId?: string,
  ) {
    await createCommentsRepository(tenantContext(organizationId, workspaceId, actorId)).delete(
      requiredString(id, "id"),
    );
    return { ok: true };
  }
}
