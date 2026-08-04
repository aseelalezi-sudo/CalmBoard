import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  GoneException,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import {
  createDocumentsRepository,
  createFormsRepository,
  createPublicFormsRepository,
  createPublicDocumentsRepository,
  type DocumentAccessLevel,
  type UpdateDocumentInput,
  type UpdateFormInput,
} from "@calmboard/database";
import {
  optionalString,
  requiredString,
  tenantContext,
  tenantContextFromBody,
  type JsonObject,
} from "./request-validation.js";
import { PublicRoute } from "./public-route.decorator.js";
import { SkipCsrf } from "./csrf.guard.js";
import { RequirePermission, SelfService, TenantMember } from "./permission.guard.js";
import type { AuthenticatedRequest } from "./auth.guard.js";
import { defaultFormFields, parseFormFields, parseFormSettings, parsePublicFormSubmission } from "./form-validation.js";
import { publicTurnstileConfiguration, verifyTurnstileToken } from "./turnstile.js";

function nullableString(value: unknown, field: string) {
  return value === null || value === "" ? null : requiredString(value, field);
}

function documentUpdate(body: JsonObject): UpdateDocumentInput {
  const input: UpdateDocumentInput = {};
  if (body.title !== undefined) input.title = requiredString(body.title, "title");
  if (body.content !== undefined) {
    if (body.content !== null && typeof body.content !== "string") {
      throw new BadRequestException("content must be a string or null");
    }
    input.content = body.content;
  }
  if (body.icon !== undefined) input.icon = nullableString(body.icon, "icon");
  if (body.projectId !== undefined) input.projectId = nullableString(body.projectId, "projectId");
  if (body.parentId !== undefined) input.parentId = nullableString(body.parentId, "parentId");
  if (body.isPublic !== undefined) {
    if (typeof body.isPublic !== "boolean") throw new BadRequestException("isPublic must be a boolean");
    input.isPublic = body.isPublic;
  }
  if (body.workspaceAccess !== undefined) {
    if (!["none", "viewer", "editor"].includes(String(body.workspaceAccess))) {
      throw new BadRequestException("workspaceAccess must be none, viewer, or editor");
    }
    input.workspaceAccess = body.workspaceAccess as "none" | "viewer" | "editor";
  }
  if (body.inheritPermissions !== undefined) {
    if (typeof body.inheritPermissions !== "boolean") {
      throw new BadRequestException("inheritPermissions must be a boolean");
    }
    input.inheritPermissions = body.inheritPermissions;
  }
  if (!Object.keys(input).length) throw new BadRequestException("at least one document field is required");
  return input;
}

function documentsRepository(request: AuthenticatedRequest, organizationId: string, workspaceId: string) {
  return createDocumentsRepository(tenantContext(organizationId, workspaceId, request.auth?.userId), {
    canManageWorkspaceDocuments: request.authorization?.permissions.includes("documents.manage") ?? false,
  });
}

function documentsRepositoryFromBody(request: AuthenticatedRequest, body: JsonObject) {
  return documentsRepository(
    request,
    requiredString(body.organizationId, "organizationId"),
    requiredString(body.workspaceId, "workspaceId"),
  );
}

function formUpdate(body: JsonObject): UpdateFormInput {
  const input: UpdateFormInput = {};
  if (body.name !== undefined) input.name = requiredString(body.name, "name");
  if (body.description !== undefined) {
    if (body.description !== null && typeof body.description !== "string") {
      throw new BadRequestException("description must be a string or null");
    }
    input.description = body.description;
  }
  if (body.projectId !== undefined) input.projectId = nullableString(body.projectId, "projectId");
  if (body.fields !== undefined) {
    input.fields = parseFormFields(body.fields);
  }
  if (body.settings !== undefined) {
    input.settings = parseFormSettings(body.settings);
  }
  if (body.isActive !== undefined) {
    if (typeof body.isActive !== "boolean") throw new BadRequestException("isActive must be a boolean");
    input.isActive = body.isActive;
  }
  if (!Object.keys(input).length) throw new BadRequestException("at least one form field is required");
  return input;
}

@Controller("docs")
export class DocumentsController {
  @Get(":id/public")
  @PublicRoute()
  publicDocument(@Param("id") id: string) {
    return createPublicDocumentsRepository().get(id);
  }

  @Get()
  @TenantMember()
  list(
    @Req() request: AuthenticatedRequest,
    @Query("organizationId") organizationId: string,
    @Query("workspaceId") workspaceId: string,
  ) {
    return documentsRepository(request, organizationId, workspaceId).list();
  }

  @Post()
  @RequirePermission("documents.manage")
  create(@Req() request: AuthenticatedRequest, @Body() body: JsonObject) {
    return documentsRepositoryFromBody(request, body).create({
      projectId: optionalString(body.projectId, "projectId") ?? null,
      parentId: optionalString(body.parentId, "parentId") ?? null,
      title: requiredString(body.title, "title"),
      content: typeof body.content === "string" ? body.content : "",
      icon: optionalString(body.icon, "icon") ?? "file-text",
      isPublic: body.isPublic === true,
      workspaceAccess: "viewer",
      inheritPermissions: true,
    });
  }

  @Patch()
  @SelfService()
  update(@Req() request: AuthenticatedRequest, @Body() body: JsonObject) {
    return documentsRepositoryFromBody(request, body).update(requiredString(body.id, "id"), documentUpdate(body));
  }

  @Get(":id/versions")
  @TenantMember()
  versions(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string,
    @Query("organizationId") organizationId: string,
    @Query("workspaceId") workspaceId: string,
  ) {
    return documentsRepository(request, organizationId, workspaceId).listVersions(id);
  }

  @Post(":id/versions")
  @SelfService()
  async mutateVersion(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: JsonObject) {
    const repository = documentsRepositoryFromBody(request, body);
    const action = requiredString(body.action, "action");
    if (action === "save_snapshot") {
      const version = await repository.saveSnapshot(id);
      return { ok: true, version };
    }
    if (action === "restore") {
      const document = await repository.restoreVersion(id, requiredString(body.versionId, "versionId"));
      return { ok: true, doc: document };
    }
    throw new BadRequestException("action is invalid");
  }

  @Get(":id/permissions")
  @TenantMember()
  permissions(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string,
    @Query("organizationId") organizationId: string,
    @Query("workspaceId") workspaceId: string,
  ) {
    return documentsRepository(request, organizationId, workspaceId).listPermissions(id);
  }

  @Post(":id/permissions")
  @SelfService()
  setPermission(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: JsonObject) {
    const accessLevel = requiredString(body.accessLevel, "accessLevel");
    if (!["viewer", "editor", "manager"].includes(accessLevel)) {
      throw new BadRequestException("accessLevel must be viewer, editor, or manager");
    }
    return documentsRepositoryFromBody(request, body).setPermission(
      id,
      requiredString(body.targetUserId, "targetUserId"),
      accessLevel as DocumentAccessLevel,
    );
  }

  @Delete(":id/permissions")
  @SelfService()
  removePermission(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string,
    @Query("organizationId") organizationId: string,
    @Query("workspaceId") workspaceId: string,
    @Query("targetUserId") targetUserId: string,
  ) {
    return documentsRepository(request, organizationId, workspaceId).removePermission(
      id,
      requiredString(targetUserId, "targetUserId"),
    );
  }
}

@Controller("forms")
export class FormsController {
  @Get()
  @TenantMember()
  list(
    @Query("organizationId") organizationId: string,
    @Query("workspaceId") workspaceId: string,
    @Query("actorId") actorId?: string,
  ) {
    return createFormsRepository(tenantContext(organizationId, workspaceId, actorId)).list();
  }

  @Post()
  @RequirePermission("forms.manage")
  create(@Body() body: JsonObject) {
    return createFormsRepository(tenantContextFromBody(body)).create({
      projectId: optionalString(body.projectId, "projectId") ?? null,
      name: requiredString(body.name, "name"),
      description: typeof body.description === "string" ? body.description : "",
      fields: parseFormFields(body.fields ?? defaultFormFields),
      settings: parseFormSettings(body.settings),
      isActive: true,
    });
  }

  @Patch()
  @RequirePermission("forms.manage")
  update(@Body() body: JsonObject) {
    return createFormsRepository(tenantContextFromBody(body)).update(requiredString(body.id, "id"), formUpdate(body));
  }

  @Get(":id")
  @PublicRoute()
  async publicForm(@Param("id") id: string) {
    const form = await createPublicFormsRepository().get(id);
    const settings = parseFormSettings(form.settings);
    return {
      form: {
        id: form.id,
        name: form.name,
        description: form.description,
        fields: parseFormFields(form.fields),
        isActive: form.isActive,
        submitLabel: settings.submitLabel,
        successMessage: settings.successMessage,
        captcha: publicTurnstileConfiguration(settings.captchaEnabled),
      },
    };
  }

  @Get(":id/responses")
  @RequirePermission("forms.manage")
  adminForm(
    @Param("id") id: string,
    @Query("organizationId") organizationId: string,
    @Query("workspaceId") workspaceId: string,
    @Query("actorId") actorId?: string,
  ) {
    return createFormsRepository(tenantContext(organizationId, workspaceId, actorId)).getWithResponses(id);
  }

  @Post(":id/submit")
  @PublicRoute()
  @SkipCsrf()
  async submit(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: JsonObject) {
    const repository = createPublicFormsRepository();
    const form = await repository.get(id);
    if (!form.isActive) throw new GoneException({ error: "هذا النموذج لم يعد يستقبل الردود", status: "inactive" });
    const fields = parseFormFields(form.fields);
    const settings = parseFormSettings(form.settings);
    const submission = parsePublicFormSubmission(body, fields);
    await verifyTurnstileToken(settings.captchaEnabled, submission.captchaToken, request.ip);
    return { ok: true, ...(await repository.submit(id, submission.values)) };
  }
}
