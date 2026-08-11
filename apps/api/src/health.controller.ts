import { Controller, Get, Inject, ServiceUnavailableException } from "@nestjs/common";
import type { HealthResponse } from "@calmboard/types";
import { db, sql } from "@calmboard/database";
import { PublicRoute } from "./public-route.decorator.js";
import { RedisRateLimitStore } from "./rate-limit.service.js";

const HEALTH_CHECK_TIMEOUT_MS = 2_000;

function withHealthCheckTimeout<T>(check: Promise<T>) {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    check,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Health check timed out")), HEALTH_CHECK_TIMEOUT_MS);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

@PublicRoute()
@Controller("health")
export class HealthController {
  constructor(@Inject(RedisRateLimitStore) private readonly redis: RedisRateLimitStore) {}

  @Get()
  async getHealth(): Promise<HealthResponse> {
    try {
      await db.execute(sql`select 1`);
      return {
        ok: true,
        service: "api",
        timestamp: new Date().toISOString(),
      };
    } catch {
      throw new ServiceUnavailableException("Database health check failed");
    }
  }

  @Get("liveness")
  getLiveness() {
    return {
      ok: true,
      service: "api",
      status: "alive",
      timestamp: new Date().toISOString(),
    };
  }

  @Get("readiness")
  async getReadiness() {
    try {
      await Promise.all([withHealthCheckTimeout(db.execute(sql`select 1`)), withHealthCheckTimeout(this.redis.ping())]);
      return {
        ok: true,
        service: "api",
        status: "ready",
        timestamp: new Date().toISOString(),
      };
    } catch {
      throw new ServiceUnavailableException("Required dependency not ready");
    }
  }
}
