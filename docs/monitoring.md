# Monitoring and alerting

CalmBoard exposes protected Prometheus metrics at API and Worker `/metrics`.
Production requires a `METRICS_BEARER_TOKEN` of at least 32 bytes. Store the
same token in a mode-`0400` file for Prometheus and set
`METRICS_BEARER_TOKEN_FILE` to its absolute host path.

The optional observability composition adds Prometheus, an OpenTelemetry
Collector, and a local Tempo trace store:

```sh
docker compose --env-file /secure/calmboard/staging.env \
  -f docker-compose.yml \
  -f deploy/docker-compose.staging.yml \
  -f deploy/docker-compose.observability.yml \
  config --quiet

docker compose --env-file /secure/calmboard/staging.env \
  -f docker-compose.yml \
  -f deploy/docker-compose.staging.yml \
  -f deploy/docker-compose.observability.yml \
  up -d --no-build --wait
```

Prometheus is bound to loopback on port `19090`; Tempo's query API is bound to
loopback on `13200`. Put authentication and TLS in front of either endpoint
before allowing remote access. The bundled Tempo storage is suitable for a
staging drill, not durable production retention; production should send OTLP to
a managed or replicated backend.

`deploy/prometheus-alerts.yml` contains initial alerts for service availability,
API 5xx rate, API p95 latency, repeated worker failures, queue backlog, and
process memory. Route alerts through the platform Alertmanager/on-call system;
Prometheus alone evaluates rules but does not deliver notifications.

Application logs are structured JSON in production. API responses include
`x-correlation-id`; a valid incoming ID is preserved and an invalid/missing ID
is replaced. OpenTelemetry is started only when `ENABLE_OTEL=true`, preventing a
false "initialized" state when no collector is configured. Sentry is enabled
only when both production mode and `SENTRY_DSN` are present, with configurable
trace/profile sample rates.

The in-app telemetry demonstration remains disabled unless the web image is
built with `NEXT_PUBLIC_TELEMETRY_UI_ENABLED=true`. It must not be enabled in
staging/production until it reads authenticated, real monitoring data.
