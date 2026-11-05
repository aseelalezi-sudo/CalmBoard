import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Patch,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { COMMENT_REACTION_EMOJIS } from "@calmboard/types";
import { createCommentsRepository, createIdempotencyRepository, type UpdateCommentInput } from "@calmboard/database";
import {
  requiredIdempotencyKey,
  requiredString,
  tenantContext,
  tenantContextFromBody,
  type JsonObject,
} from "./request-validation.js";
import { RequirePermission, TenantMember } from "./permission.guard.js";
import type { AuthenticatedRequest } from "./auth.guard.js";

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
    if (body.reactions !== undefined || body.reactionUserIds !== undefined) {
      throw new BadRequestException("Use POST /comments/reactions to set your own reaction");
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

  @Post("reactions")
  @HttpCode(200)
  @RequirePermission("comments.manage")
  async setReaction(
    @Body() body: JsonObject,
    @Req() request: AuthenticatedRequest,
    @Headers("idempotency-key") idempotencyKeyHeader = "",
  ) {
    if (!request.auth) throw new ForbiddenException("Authenticated identity is missing");
    const id = requiredString(body.id, "id");
    const emoji = requiredString(body.emoji, "emoji");
    if (!(COMMENT_REACTION_EMOJIS as readonly string[]).includes(emoji) || typeof body.active !== "boolean") {
      throw new BadRequestException("A supported emoji and boolean active are required");
    }
    const active = body.active;
    const context = tenantContext(body.organizationId, body.workspaceId, request.auth.userId);
    const result = await createIdempotencyRepository(context).execute({
      key: requiredIdempotencyKey(idempotencyKeyHeader),
      scope: "comments.reactions",
      request: { id, emoji, active, actorId: context.actorId },
      operation: async () => ({ body: await createCommentsRepository(context).setReaction(id, emoji, active) }),
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
