import { Body, Controller, Delete, Get, Post, Query } from "@nestjs/common";
import { createAttachmentService } from "./attachment.service.js";
import { parseAttachmentTarget, parseAttachmentUploadInput } from "./attachment-validation.js";
import { requiredString, tenantContext, tenantContextFromBody, type JsonObject } from "./request-validation.js";
import { RequirePermission, TenantMember } from "./permission.guard.js";

@Controller("attachments")
export class AttachmentsController {
  @Get()
  @TenantMember()
  list(
    @Query("organizationId") organizationId: string,
    @Query("workspaceId") workspaceId: string,
    @Query("taskId") taskId?: string,
    @Query("projectId") projectId?: string,
    @Query("actorId") actorId?: string,
  ) {
    const target = parseAttachmentTarget({ taskId, projectId });
    return createAttachmentService(tenantContext(organizationId, workspaceId, actorId)).list(target);
  }

  @Post()
  @RequirePermission("attachments.manage")
  create(@Body() body: JsonObject) {
    return createAttachmentService(tenantContextFromBody(body)).createUpload(parseAttachmentUploadInput(body));
  }

  @Post("complete")
  @RequirePermission("attachments.manage")
  complete(@Body() body: JsonObject) {
    return createAttachmentService(tenantContextFromBody(body)).completeUpload(requiredString(body.id, "id"));
  }

  @Delete()
  @RequirePermission("attachments.manage")
  async delete(
    @Query("organizationId") organizationId: string,
    @Query("workspaceId") workspaceId: string,
    @Query("id") id: string,
    @Query("actorId") actorId?: string,
  ) {
    await createAttachmentService(tenantContext(organizationId, workspaceId, actorId)).delete(requiredString(id, "id"));
    return { ok: true };
  }
}
