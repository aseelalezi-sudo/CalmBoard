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
    @Query("userId") userId: string,
    @Query("actorId") actorId?: string,
  ) {
    return createNotificationsRepository(tenantContext(organizationId, workspaceId, actorId)).listForUser(
      requiredString(userId, "userId"),
    );
  }

  @Patch()
  @RequirePermission("notifications.manage")
  async markRead(@Body() body: JsonObject) {
    const userId = requiredString(body.userId, "userId");
    const repository = createNotificationsRepository(tenantContextFromBody(body));
    if (body.markAllRead === true) {
      await repository.markAllRead(userId);
      return { ok: true };
    }
    if (body.id !== undefined) return repository.markRead(requiredString(body.id, "id"), userId);
    throw new BadRequestException("markAllRead or notification id is required");
  }
}
