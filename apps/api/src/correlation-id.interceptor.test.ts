import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CallHandler, ExecutionContext } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { of } from "rxjs";
import { correlationId, CorrelationIdInterceptor, responseCorrelationId } from "./correlation-id.interceptor.js";

function httpContext(request: Partial<FastifyRequest>) {
  const headers = new Map<string, string>();
  const response = { header: (name: string, value: string) => headers.set(name, value) } as unknown as FastifyReply;
  return {
    context: {
      getType: () => "http",
      switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
    } as unknown as ExecutionContext,
    headers,
  };
}

describe("correlation id interceptor", () => {
  it("accepts bounded safe request correlation ids", () => {
    assert.equal(correlationId("load-test:123"), "load-test:123");
    assert.match(correlationId("invalid value"), /^[0-9a-f-]{36}$/);
  });

  it("returns the logger request id on HTTP responses", () => {
    const fixture = httpContext({ id: "logger-request-id", headers: {} });
    new CorrelationIdInterceptor().intercept(fixture.context, { handle: () => of(null) } as CallHandler);
    assert.equal(fixture.headers.get("x-correlation-id"), "logger-request-id");
  });

  it("echoes a valid caller correlation id instead of the generated logger id", () => {
    const fixture = httpContext({
      id: "logger-request-id",
      headers: { "x-correlation-id": "load-test:123" },
    });
    new CorrelationIdInterceptor().intercept(fixture.context, { handle: () => of(null) } as CallHandler);
    assert.equal(fixture.headers.get("x-correlation-id"), "load-test:123");
  });

  it("falls back to the logger id when the caller id is unsafe", () => {
    assert.equal(responseCorrelationId("logger-request-id", "invalid value"), "logger-request-id");
  });
});
