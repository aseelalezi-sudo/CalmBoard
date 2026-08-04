import { createServer } from "node:http";
import { db, sql } from "@calmboard/database";
import { collectDefaultMetrics, Counter, Gauge, Histogram, register } from "prom-client";
import { validMetricsAuthorization } from "./metrics-auth.js";

collectDefaultMetrics();

export const workerHealth = {
  ok: true,
  service: "worker",
};

export const workerJobsTotal = new Counter({
  name: "calmboard_worker_jobs_total",
  help: "Total CalmBoard background jobs by result",
  labelNames: ["job_name", "result"] as const,
});

export const workerJobDurationSeconds = new Histogram({
  name: "calmboard_worker_job_duration_seconds",
  help: "CalmBoard background job duration in seconds",
  labelNames: ["job_name"] as const,
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 15, 30, 60, 300],
});

export const workerQueueJobs = new Gauge({
  name: "calmboard_worker_queue_jobs",
  help: "Current number of jobs in the CalmBoard queue",
  labelNames: ["state"] as const,
});

export function startHealthServer(port: number) {
  const server = createServer(async (req, res) => {
    if (req.method !== "GET") {
      res.writeHead(405);
      return res.end();
    }

    if (req.url === "/health" || req.url === "/health/liveness") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(
        JSON.stringify({
          ...workerHealth,
          status: "alive",
          timestamp: new Date().toISOString(),
        }),
      );
    }

    if (req.url === "/health/readiness") {
      try {
        await db.execute(sql`select 1`);
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(
          JSON.stringify({
            ...workerHealth,
            status: "ready",
            timestamp: new Date().toISOString(),
          }),
        );
      } catch (error) {
        res.writeHead(503, { "Content-Type": "application/json" });
        return res.end(
          JSON.stringify({
            ...workerHealth,
            status: "error",
            message: "Database health check failed",
            timestamp: new Date().toISOString(),
          }),
        );
      }
    }

    if (req.url === "/metrics") {
      const token = process.env.METRICS_BEARER_TOKEN;
      if (!token && process.env.NODE_ENV === "production") {
        res.writeHead(503, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: "Metrics endpoint is not configured" }));
      }
      if (token && !validMetricsAuthorization(req.headers.authorization, token)) {
        res.writeHead(401, { "Content-Type": "application/json", "WWW-Authenticate": "Bearer" });
        return res.end(JSON.stringify({ error: "Invalid metrics credentials" }));
      }
      res.writeHead(200, { "Content-Type": register.contentType });
      const metrics = await register.metrics();
      return res.end(metrics);
    }

    res.writeHead(404);
    res.end();
  });

  server.listen(port, "0.0.0.0", () => {
    console.log(`CalmBoard worker health server listening on port ${port}`);
  });

  return server;
}
