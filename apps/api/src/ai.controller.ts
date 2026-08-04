import {
  Body,
  BadRequestException,
  ConflictException,
  Controller,
  HttpException,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import {
  AIProposalDigestMismatchError,
  AIProposalExpiredError,
  AIProposalNotAvailableError,
  AIUsageLimitExceededError,
  createAIProposalsRepository,
} from "@calmboard/database";
import type { FastifyRequest } from "fastify";
import { AIProviderUnavailableError } from "./ai-provider.js";
import { AIService } from "./ai.service.js";
import { parseAIRequest } from "./ai-validation.js";
import type { AuthenticatedRequest } from "./auth.guard.js";
import { RequirePermission, TenantMember } from "./permission.guard.js";
import { requiredString, tenantContext, type JsonObject } from "./request-validation.js";
import { createTaskService } from "./task.service.js";
import { SkipTenantDatabaseTransaction } from "./tenant-database.interceptor.js";

@Controller("ai")
export class AIController {
  constructor(@Inject(AIService) private readonly service: AIService) {}

  @Post()
  @TenantMember()
  @SkipTenantDatabaseTransaction()
  async run(@Body() body: JsonObject, @Req() request: FastifyRequest) {
    try {
      const actorId = (request as AuthenticatedRequest).auth?.userId;
      if (!actorId) throw new UnauthorizedException("Authentication is required");
      return await this.service.run(
        tenantContext(body.organizationId, body.workspaceId, actorId),
        parseAIRequest(body),
      );
    } catch (error) {
      if (error instanceof AIProviderUnavailableError) {
        throw new ServiceUnavailableException("AI provider is not configured or currently unavailable");
      }
      if (error instanceof AIUsageLimitExceededError) {
        throw new HttpException(
          {
            code: error.code,
            resource: error.resource,
            current: error.current,
            limit: error.limit,
            message: error.message,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      throw error;
    }
  }

  @Post("proposals/:id/approve")
  @RequirePermission("tasks.create")
  async approve(@Param("id") id: string, @Body() body: JsonObject, @Req() request: FastifyRequest) {
    const actorId = (request as AuthenticatedRequest).auth?.userId;
    if (!actorId) throw new UnauthorizedException("Authentication is required");
    const context = tenantContext(body.organizationId, body.workspaceId, actorId);
    const digest = requiredString(body.digest, "digest");
    const projectId = requiredString(body.projectId, "projectId");
    try {
      const items = await createAIProposalsRepository(context).execute(id, digest, projectId, ({ projectId, tasks }) =>
        createTaskService(context).importTasks(
          tasks.map((task) => ({
            projectId,
            title: task.title,
            description: task.description,
            status: "todo",
            priority: task.priority,
            estimatedHours: task.estimatedHours,
            reporterId: actorId,
          })),
        ),
      );
      return { proposalId: id, status: "executed", importedCount: items.length, items };
    } catch (error) {
      this.rethrowProposalError(error);
    }
  }

  @Post("proposals/:id/reject")
  @TenantMember()
  async reject(@Param("id") id: string, @Body() body: JsonObject, @Req() request: FastifyRequest) {
    const actorId = (request as AuthenticatedRequest).auth?.userId;
    if (!actorId) throw new UnauthorizedException("Authentication is required");
    const context = tenantContext(body.organizationId, body.workspaceId, actorId);
    const digest = requiredString(body.digest, "digest");
    const projectId = requiredString(body.projectId, "projectId");
    try {
      return await createAIProposalsRepository(context).reject(id, digest, projectId);
    } catch (error) {
      this.rethrowProposalError(error);
    }
  }

  private rethrowProposalError(error: unknown): never {
    if (error instanceof AIProposalDigestMismatchError) throw new BadRequestException(error.message);
    if (error instanceof AIProposalExpiredError) throw new ConflictException(error.message);
    if (error instanceof AIProposalNotAvailableError) throw new NotFoundException(error.message);
    throw error;
  }
}
