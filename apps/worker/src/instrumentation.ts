import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";

const sdk = new NodeSDK({
  instrumentations: [getNodeAutoInstrumentations()],
});

if (process.env.ENABLE_OTEL === "true") {
  sdk.start();
  console.log("OpenTelemetry initialized");
}

process.on("SIGTERM", () => {
  sdk
    .shutdown()
    .then(() => console.log("OpenTelemetry shut down"))
    .catch((error) => console.log("Error shutting down OpenTelemetry", error))
    .finally(() => process.exit(0));
});
