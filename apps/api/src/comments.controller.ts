import { BadRequestException, Body, Controller, Delete, Get, Patch, Post, Query } from "@nestjs/common";
import { createCommentsRepository, type UpdateCommentInput } from "@calmboard/database";
import {
  isJsonObject,
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

@Controller("comments")
export class CommentsController {
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
  create(@Body() body: JsonObject) {
    return createCommentsRepository(tenantContextFromBody(body)).create({
      taskId: requiredString(body.taskId, "taskId"),
      userId: requiredString(body.userId, "userId"),
      content: requiredString(body.content, "content"),
      parentId: typeof body.parentId === "string" && body.parentId ? body.parentId : undefined,
    });
  }

  @Patch()
  @RequirePermission("comments.manage")
  update(@Body() body: JsonObject) {
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
    if (!Object.keys(updates).length) throw new BadRequestException("at least one comment field is required");
    return createCommentsRepository(tenantContextFromBody(body)).update(requiredString(body.id, "id"), updates);
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
