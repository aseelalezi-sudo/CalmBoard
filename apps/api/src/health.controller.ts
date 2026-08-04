import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import type { HealthResponse } from "@calmboard/types";
import { db, sql } from "@calmboard/database";
import { PublicRoute } from "./public-route.decorator.js";

@PublicRoute()
@Controller("health")
export class HealthController {
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
      await db.execute(sql`select 1`);
      return {
        ok: true,
        service: "api",
        status: "ready",
        timestamp: new Date().toISOString(),
      };
    } catch {
      throw new ServiceUnavailableException("Database not ready");
    }
  }
}
