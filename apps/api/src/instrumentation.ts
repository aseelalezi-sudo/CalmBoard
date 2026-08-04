/**
 * OpenTelemetry initialisation — loaded before any other module in main.ts.
 *
 * Activation:  ENABLE_OTEL=true
 *
 * The NodeSDK reads exporter configuration from standard OTel environment
 * variables, so no direct exporter imports are needed here. Configure via:
 *
 *   OTEL_SERVICE_NAME              (default: calmboard-api)
 *   OTEL_SERVICE_VERSION           (default: GIT_SHA env var, or "dev")
 *   OTEL_DEPLOYMENT_ENVIRONMENT    (default: NODE_ENV)
 *   OTEL_EXPORTER_OTLP_ENDPOINT    e.g. http://otel-collector:4318
 *   OTEL_TRACES_EXPORTER           otlp | none   (auto-set when endpoint is present)
 *   OTEL_METRICS_EXPORTER          otlp | none   (auto-set when endpoint is present)
 *   OTEL_EXPORTER_OTLP_PROTOCOL    http/protobuf | grpc (default: http/protobuf)
 *
 * When OTEL_EXPORTER_OTLP_ENDPOINT is absent, exporters are set to "none" so
 * no connection is attempted and startup remains fast.
 */
import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";

const serviceName = process.env.OTEL_SERVICE_NAME ?? "calmboard-api";
const serviceVersion = process.env.OTEL_SERVICE_VERSION ?? process.env.GIT_SHA ?? "dev";
const deploymentEnvironment = process.env.OTEL_DEPLOYMENT_ENVIRONMENT ?? process.env.NODE_ENV ?? "development";
const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

// Propagate service identity via standard OTel env vars so NodeSDK's built-in
// env-based resource detector picks them up automatically.
if (!process.env.OTEL_SERVICE_NAME) process.env.OTEL_SERVICE_NAME = serviceName;
if (!process.env.OTEL_SERVICE_VERSION) process.env.OTEL_SERVICE_VERSION = serviceVersion;
if (!process.env.OTEL_DEPLOYMENT_ENVIRONMENT) process.env.OTEL_DEPLOYMENT_ENVIRONMENT = deploymentEnvironment;

if (!otlpEndpoint) {
  // No collector configured — disable all exporters to prevent startup noise.
  if (!process.env.OTEL_TRACES_EXPORTER) process.env.OTEL_TRACES_EXPORTER = "none";
  if (!process.env.OTEL_METRICS_EXPORTER) process.env.OTEL_METRICS_EXPORTER = "none";
  if (!process.env.OTEL_LOGS_EXPORTER) process.env.OTEL_LOGS_EXPORTER = "none";
} else {
  // Derive per-signal endpoints from the base collector URL when not overridden.
  if (!process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT) {
    process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT = `${otlpEndpoint}/v1/traces`;
  }
  if (!process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT) {
    process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT = `${otlpEndpoint}/v1/metrics`;
  }
  if (!process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT) {
    process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT = `${otlpEndpoint}/v1/logs`;
  }
}

const sdk = new NodeSDK({
  instrumentations: [
    getNodeAutoInstrumentations({
      // Suppress high-frequency fs spans that add noise without insight.
      "@opentelemetry/instrumentation-fs": { enabled: false },
    }),
  ],
});

if (process.env.ENABLE_OTEL === "true") {
  sdk.start();
  console.log(
    `OpenTelemetry initialised — service=${serviceName} version=${serviceVersion} env=${deploymentEnvironment}` +
      (otlpEndpoint ? ` exporter=${otlpEndpoint}` : " (no OTLP endpoint; spans collected in-process only)"),
  );
}

process.on("SIGTERM", () => {
  sdk
    .shutdown()
    .then(() => console.log("OpenTelemetry shut down"))
    .catch((error) => console.log("Error shutting down OpenTelemetry", error))
    .finally(() => process.exit(0));
});
