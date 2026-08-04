import { ArgumentsHost, Catch, HttpException, HttpStatus, Logger, type ExceptionFilter } from "@nestjs/common";
import {
  TenantConflictError,
  TenantPermissionDeniedError,
  TenantResourceNotFoundError,
  TenantUsageLimitExceededError,
  usageLimitErrorFromDatabase,
} from "@calmboard/database";
import type { FastifyReply } from "fastify";

type ErrorPayload = {
  statusCode: number;
  code: string;
  error: string;
  details?: unknown;
};

@Catch()
export class DatabaseExceptionFilter implements ExceptionFilter<unknown> {
  private readonly logger = new Logger(DatabaseExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<FastifyReply>();
    const payload = this.toPayload(exception);
    if (payload.statusCode >= 500) {
      const stack = exception instanceof Error ? exception.stack : undefined;
      const message = exception instanceof Error ? exception.message : "Unknown unhandled exception";
      this.logger.error(message, stack);
    }
    response.status(payload.statusCode).send(payload);
  }

  toPayload(exception: unknown): ErrorPayload {
    const usageLimitError =
      exception instanceof TenantUsageLimitExceededError ? exception : usageLimitErrorFromDatabase(exception);
    if (usageLimitError) {
      return {
        statusCode: 409,
        code: "usage_limit_exceeded",
        error: usageLimitError.message,
        details: {
          resource: usageLimitError.resource,
          current: usageLimitError.current,
          limit: usageLimitError.limit,
        },
      };
    }
    if (exception instanceof TenantResourceNotFoundError) {
      return { statusCode: 404, code: "resource_not_found", error: exception.message };
    }
    if (exception instanceof TenantPermissionDeniedError) {
      return { statusCode: 403, code: "permission_denied", error: exception.message };
    }
    if (exception instanceof TenantConflictError) {
      return { statusCode: 409, code: "conflict", error: exception.message };
    }
    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      const body = exception.getResponse();
      const details = typeof body === "object" && body !== null && "message" in body ? body.message : undefined;
      const message =
        typeof body === "string"
          ? body
          : typeof details === "string"
            ? details
            : exception.message || HttpStatus[statusCode] || "Request failed";
      return {
        statusCode,
        code: statusCode === 400 ? "bad_request" : statusCode === 401 ? "unauthorized" : `http_${statusCode}`,
        error: message,
        ...(Array.isArray(details) ? { details } : {}),
      };
    }
    return { statusCode: 500, code: "internal_error", error: "Internal server error" };
  }
}
