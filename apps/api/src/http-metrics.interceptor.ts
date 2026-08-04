import { CallHandler, ExecutionContext, Injectable, type NestInterceptor } from "@nestjs/common";
import { Counter, Histogram } from "prom-client";
import { catchError, finalize, throwError, type Observable } from "rxjs";
import type { FastifyReply, FastifyRequest } from "fastify";

const requestDuration = new Histogram({
  name: "calmboard_http_request_duration_seconds",
  help: "Duration of CalmBoard API HTTP requests in seconds",
  labelNames: ["method", "route", "status_code"] as const,
  buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
});

const requestTotal = new Counter({
  name: "calmboard_http_requests_total",
  help: "Total CalmBoard API HTTP requests",
  labelNames: ["method", "route", "status_code"] as const,
});

type RequestWithRoute = FastifyRequest & {
  routeOptions?: { url?: string };
};

function exceptionStatus(error: unknown) {
  if (error && typeof error === "object" && "getStatus" in error && typeof error.getStatus === "function") {
    const status = error.getStatus();
    if (Number.isInteger(status)) return status as number;
  }
  return 500;
}

@Injectable()
export class HttpMetricsInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== "http") return next.handle();

    const http = context.switchToHttp();
    const request = http.getRequest<RequestWithRoute>();
    const response = http.getResponse<FastifyReply>();
    const route = request.routeOptions?.url ?? "unmatched";
    if (route === "/metrics") return next.handle();

    const startedAt = process.hrtime.bigint();
    let errorStatus: number | undefined;
    return next.handle().pipe(
      catchError((error: unknown) => {
        errorStatus = exceptionStatus(error);
        return throwError(() => error);
      }),
      finalize(() => {
        const statusCode = String(errorStatus ?? response.statusCode ?? 500);
        const labels = { method: request.method, route, status_code: statusCode };
        const seconds = Number(process.hrtime.bigint() - startedAt) / 1_000_000_000;
        requestTotal.inc(labels);
        requestDuration.observe(labels, seconds);
      }),
    );
  }
}
