import { randomUUID } from "node:crypto";
import { type CallHandler, type ExecutionContext, Injectable, type NestInterceptor } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Observable } from "rxjs";

const validCorrelationId = /^[A-Za-z0-9._:-]{1,128}$/;

export function correlationId(header: string | string[] | undefined) {
  const candidate = Array.isArray(header) ? header[0] : header;
  return candidate && validCorrelationId.test(candidate) ? candidate : randomUUID();
}

export function responseCorrelationId(requestId: string | undefined, header: string | string[] | undefined) {
  const candidate = Array.isArray(header) ? header[0] : header;
  if (candidate && validCorrelationId.test(candidate)) return candidate;
  return requestId && validCorrelationId.test(requestId) ? requestId : randomUUID();
}

@Injectable()
export class CorrelationIdInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== "http") return next.handle();

    const http = context.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const response = http.getResponse<FastifyReply>();
    const requestId = typeof request.id === "string" ? request.id : undefined;
    response.header("x-correlation-id", responseCorrelationId(requestId, request.headers["x-correlation-id"]));
    return next.handle();
  }
}
