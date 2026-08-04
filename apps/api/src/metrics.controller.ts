import { Controller, Get, Headers, Res, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { timingSafeEqual } from "node:crypto";
import { register } from "prom-client";
import type { FastifyReply } from "fastify";
import { PublicRoute } from "./public-route.decorator.js";
import { SkipTenantDatabaseTransaction } from "./tenant-database.interceptor.js";

export function validMetricsAuthorization(authorization: string | undefined, token: string) {
  const supplied = Buffer.from(authorization ?? "", "utf8");
  const expected = Buffer.from(`Bearer ${token}`, "utf8");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

@PublicRoute()
@SkipTenantDatabaseTransaction()
@Controller()
export class MetricsController {
  @Get()
  async index(
    @Headers("authorization") authorization: string | undefined,
    @Res({ passthrough: true }) response: FastifyReply,
  ) {
    const token = process.env.METRICS_BEARER_TOKEN;
    if (!token) {
      if (process.env.NODE_ENV === "production") {
        throw new ServiceUnavailableException("Metrics endpoint is not configured");
      }
      response.header("Content-Type", register.contentType);
      return register.metrics();
    }
    if (!validMetricsAuthorization(authorization, token)) {
      throw new UnauthorizedException("Invalid metrics credentials");
    }
    response.header("Content-Type", register.contentType);
    return register.metrics();
  }
}
