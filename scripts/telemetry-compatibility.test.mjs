import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

for (const service of ["api", "worker"]) {
  for (const enabled of [false, true]) {
    test(`${service} instrumentation and Sentry load with telemetry ${enabled ? "enabled" : "disabled"}`, () => {
      const env = { ...process.env };
      for (const key of Object.keys(env)) {
        if (key.startsWith("OTEL_") || key.startsWith("SENTRY_") || key === "NODE_OPTIONS") delete env[key];
      }
      Object.assign(env, {
        ENABLE_OTEL: String(enabled),
        NODE_ENV: "test",
        OTEL_SDK_DISABLED: "false",
        OTEL_SERVICE_NAME: "calmboard-compatibility-test",
        OTEL_NODE_RESOURCE_DETECTORS: "none",
        OTEL_TRACES_EXPORTER: "console",
        OTEL_METRICS_EXPORTER: "none",
        OTEL_LOGS_EXPORTER: "none",
      });
      const result = spawnSync(
        process.execPath,
        [
          "--import",
          "tsx",
          "--input-type=module",
          "-e",
          `
            import assert from "node:assert/strict";
            await import("./src/instrumentation.ts");
            const api = await import("@opentelemetry/api");
            const sentry = await import("@sentry/node");
            assert.equal(typeof sentry.init, "function");
            const span = api.trace.getTracer("compatibility-test").startSpan("startup-probe");
            assert.equal(api.isSpanContextValid(span.spanContext()), ${enabled});
            span.end();
            process.emit("SIGTERM");
          `,
        ],
        {
          cwd: fileURLToPath(new URL(`../apps/${service}/`, import.meta.url)),
          env,
          encoding: "utf8",
          timeout: 20_000,
          windowsHide: true,
        },
      );
      assert.ifError(result.error);
      assert.equal(result.signal, null);
      assert.equal(result.status, 0, `Instrumentation startup failed:\n${result.stderr}`);
    });
  }
}
