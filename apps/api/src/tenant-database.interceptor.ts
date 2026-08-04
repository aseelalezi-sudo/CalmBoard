import { CallHandler, ExecutionContext, Inject, Injectable, SetMetadata, type NestInterceptor } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { withDatabaseContext, type DatabaseRequestContext } from "@calmboard/database";
import { defer, from, lastValueFrom, type Observable } from "rxjs";
import type { AuthenticatedRequest } from "./auth.guard.js";
import { RealtimeService } from "./realtime.service.js";

type RequestWithTenantFields = AuthenticatedRequest & {
  body?: unknown;
  query?: unknown;
  params?: unknown;
};

export const SKIP_TENANT_DATABASE_TRANSACTION = Symbol("calmboard.skip-tenant-database-transaction");
export const SkipTenantDatabaseTransaction = () => SetMetadata(SKIP_TENANT_DATABASE_TRANSACTION, true);

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function optionalIdentifier(...values: unknown[]) {
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0)?.trim();
}

@Injectable()
export class TenantDatabaseInterceptor implements NestInterceptor {
  constructor(
    @Inject(RealtimeService) private readonly realtime: RealtimeService,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  intercept(executionContext: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (typeof executionContext.getType === "function" && executionContext.getType() !== "http") return next.handle();
    if (
      this.reflector.getAllAndOverride<boolean>(SKIP_TENANT_DATABASE_TRANSACTION, [
        executionContext.getHandler(),
        executionContext.getClass(),
      ])
    ) {
      return next.handle();
    }
    const request = executionContext.switchToHttp().getRequest<RequestWithTenantFields>();
    const body = asRecord(request.body);
    const query = asRecord(request.query);
    const context: DatabaseRequestContext = {
      organizationId: optionalIdentifier(request.tenant?.organizationId, body.organizationId, query.organizationId),
      workspaceId: optionalIdentifier(request.tenant?.workspaceId, body.workspaceId, query.workspaceId),
      actorId: request.auth?.userId ?? optionalIdentifier(body.actorId, query.actorId),
    };

    if (!context.organizationId && !context.actorId) return next.handle();

    return defer(() =>
      from(
        withDatabaseContext(context, () => lastValueFrom(next.handle())).then(async (result) => {
          await this.realtime.publishHttpMutation(request, context);
          return result;
        }),
      ),
    );
  }
}
