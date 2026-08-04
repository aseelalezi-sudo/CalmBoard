import "./instrumentation.js";
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "./app.module.js";
import { DatabaseExceptionFilter } from "./database-exception.filter.js";
import { RedisIoAdapter } from "./realtime-redis.adapter.js";
import { RealtimeGateway } from "./realtime.gateway.js";
import { Logger } from "nestjs-pino";
import * as Sentry from "@sentry/node";
import { nodeProfilingIntegration } from "@sentry/profiling-node";

const port = Number(process.env.API_PORT ?? 4000);
const host = process.env.API_HOST ?? "::";
const sentryTracesSampleRate = Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1);
const sentryProfilesSampleRate = Number(process.env.SENTRY_PROFILES_SAMPLE_RATE ?? 0.1);

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  integrations: [nodeProfilingIntegration()],
  tracesSampleRate: Number.isFinite(sentryTracesSampleRate) ? sentryTracesSampleRate : 0.1,
  profilesSampleRate: Number.isFinite(sentryProfilesSampleRate) ? sentryProfilesSampleRate : 0.1,
  enabled: process.env.NODE_ENV === "production" && Boolean(process.env.SENTRY_DSN),
});

const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS ?? 0);
const app = await NestFactory.create<NestFastifyApplication>(
  AppModule,
  new FastifyAdapter({ trustProxy: Number.isInteger(trustProxyHops) && trustProxyHops > 0 ? trustProxyHops : false }),
  {
    rawBody: true,
    bufferLogs: true,
  },
);
app.useLogger(app.get(Logger));

app.enableCors({
  origin: process.env.APP_URL ?? "http://localhost:3000",
  credentials: true,
  methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
});
app.useGlobalFilters(new DatabaseExceptionFilter());
const realtimeAdapter = new RedisIoAdapter(app);
await realtimeAdapter.connect();
app.useWebSocketAdapter(realtimeAdapter);

await app.listen({ port, host });
