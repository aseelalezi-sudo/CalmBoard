import { BadRequestException, Body, Controller, Get, Patch, Query } from "@nestjs/common";
import { createNotificationsRepository } from "@calmboard/database";
import { requiredString, tenantContext, tenantContextFromBody, type JsonObject } from "./request-validation.js";
import { RequirePermission, TenantMember } from "./permission.guard.js";

@Controller("notifications")
export class NotificationsController {
  @Get()
  @TenantMember()
  list(
    @Query("organizationId") organizationId: string,
    @Query("workspaceId") workspaceId: string,
    @Query("userId") userId?: string,
    @Query("actorId") actorId?: string,
  ) {
    const targetUserId = actorId || requiredString(userId, "userId");
    return createNotificationsRepository(tenantContext(organizationId, workspaceId, actorId)).listForUser(targetUserId);
  }

  @Patch()
  @TenantMember()
  async markRead(@Body() body: JsonObject) {
    const actorId = requiredString(body.actorId, "actorId");
    const targetUserId = actorId;
    const repository = createNotificationsRepository(tenantContextFromBody(body));
    if (body.markAllRead === true) {
      await repository.markAllRead(targetUserId);
      return { ok: true };
    }
    if (body.id !== undefined) return repository.markRead(requiredString(body.id, "id"), targetUserId);
    throw new BadRequestException("markAllRead or notification id is required");
  }
}
