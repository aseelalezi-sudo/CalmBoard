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
import { AuthorizationService } from "./authorization.service.js";
import type { AuthenticatedRequest } from "./auth.guard.js";
import { PUBLIC_ROUTE } from "./public-route.decorator.js";
import { explicitRequestScope, RequestScopeService } from "./request-scope.service.js";

type TenantRequest = AuthenticatedRequest & {
  body?: unknown;
  query?: unknown;
  params?: unknown;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
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
    @Inject(RequestScopeService) private readonly requestScope: RequestScopeService,
  ) {}

  async canActivate(context: ExecutionContext) {
    if (typeof context.getType === "function" && context.getType() !== "http") return true;
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [context.getHandler(), context.getClass()]))
      return true;
    const request = context.switchToHttp().getRequest<TenantRequest>();
    if (!request.auth) throw new ForbiddenException("Authenticated identity is missing");
    const body = record(request.body);
    const query = record(request.query);
    body.actorId = request.auth.userId;
    query.actorId = request.auth.userId;
    for (const field of ["userId", "authorId", "createdBy", "savedById"] as const) {
      if (field in body) body[field] = request.auth.userId;
    }
    if ("userId" in query) query.userId = request.auth.userId;

    const explicitScope = explicitRequestScope(request);
    const organizationId = explicitScope.organizationId;
    const workspaceId = explicitScope.workspaceId;
    if (workspaceId && !organizationId) throw new BadRequestException("organizationId is required with workspaceId");
    if (explicitScope.projectId && !workspaceId)
      throw new BadRequestException("workspaceId is required with projectId");
    if (!organizationId) return true;

    const trustedProjectId = await this.requestScope.trustedProjectId(
      { organizationId, ...(workspaceId ? { workspaceId } : {}), actorId: request.auth.userId },
      explicitScope.resources,
    );
    if (explicitScope.projectId && trustedProjectId && explicitScope.projectId !== trustedProjectId) {
      throw new ForbiddenException("Resource does not belong to the requested project");
    }
    const projectId = explicitScope.projectId ?? trustedProjectId;

    const scope = { organizationId, ...(workspaceId ? { workspaceId } : {}), ...(projectId ? { projectId } : {}) };
    const decision = await this.authorization.resolve(request.auth.userId, scope);
    if (!decision.member) throw new ForbiddenException("The authenticated user is not a member of this tenant");
    request.tenant = scope;
    request.authorization = decision;
    return true;
  }
}
