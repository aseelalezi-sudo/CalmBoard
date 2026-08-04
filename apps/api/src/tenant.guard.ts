import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { AuthorizationDecision, AuthorizationScope } from "@calmboard/database";
import type { FastifyRequest } from "fastify";
import { AuthorizationService } from "./authorization.service.js";
import type { AuthenticatedRequest } from "./auth.guard.js";
import { PUBLIC_ROUTE } from "./public-route.decorator.js";

type TenantRequest = AuthenticatedRequest & {
  body?: unknown;
  query?: unknown;
  params?: unknown;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function scopedIdentifier(field: string, ...values: unknown[]) {
  const identifiers = values
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim());
  const unique = [...new Set(identifiers)];
  if (unique.length > 1) throw new BadRequestException(`Conflicting ${field} values`);
  return unique[0];
}

function workspacePathId(request: FastifyRequest, params: Record<string, unknown>) {
  return /^\/workspaces\/[^/?]+/.test(request.url) ? params.id : undefined;
}

declare module "./auth.guard.js" {
  interface AuthenticatedRequest {
    tenant?: AuthorizationScope;
    authorization?: AuthorizationDecision;
  }
}

@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AuthorizationService) private readonly authorization: AuthorizationService,
  ) {}

  async canActivate(context: ExecutionContext) {
    if (typeof context.getType === "function" && context.getType() !== "http") return true;
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [context.getHandler(), context.getClass()]))
      return true;
    const request = context.switchToHttp().getRequest<TenantRequest>();
    if (!request.auth) throw new ForbiddenException("Authenticated identity is missing");
    const body = record(request.body);
    const query = record(request.query);
    const params = record(request.params);
    body.actorId = request.auth.userId;
    query.actorId = request.auth.userId;
    for (const field of ["userId", "authorId", "createdBy", "savedById"] as const) {
      if (field in body) body[field] = request.auth.userId;
    }
    if ("userId" in query) query.userId = request.auth.userId;

    const organizationId = scopedIdentifier("organizationId", body.organizationId, query.organizationId);
    const workspaceId = scopedIdentifier(
      "workspaceId",
      body.workspaceId,
      query.workspaceId,
      workspacePathId(request, params),
    );
    const projectId = scopedIdentifier("projectId", body.projectId, query.projectId);
    if (workspaceId && !organizationId) throw new BadRequestException("organizationId is required with workspaceId");
    if (projectId && !workspaceId) throw new BadRequestException("workspaceId is required with projectId");
    if (!organizationId) return true;

    const scope = { organizationId, ...(workspaceId ? { workspaceId } : {}), ...(projectId ? { projectId } : {}) };
    const decision = await this.authorization.resolve(request.auth.userId, scope);
    if (!decision.member) throw new ForbiddenException("The authenticated user is not a member of this tenant");
    request.tenant = scope;
    request.authorization = decision;
    return true;
  }
}
