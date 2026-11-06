import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const restoreScript = await readFile(new URL("../deploy/restore.sh", import.meta.url), "utf8");
const observabilityCompose = await readFile(
  new URL("../deploy/docker-compose.observability.yml", import.meta.url),
  "utf8",
);
const prometheusConfig = await readFile(new URL("../deploy/prometheus.yml", import.meta.url), "utf8");

test("restore drill stays isolated from the live Compose stack", () => {
  assert.match(
    restoreScript,
    /RESTORE_COMPOSE_FILE="\$\{RESTORE_COMPOSE_FILE:-\$SCRIPT_DIR\/docker-compose\.restore\.yml\}"/,
  );
  assert.match(restoreScript, /docker compose --project-name "\$RESTORE_PROJECT_NAME"/);
});

test("restore is portable across database role names", () => {
  assert.match(restoreScript, /pg_restore[\s\S]*--clean --if-exists --no-owner --no-privileges/);
});

test("observability requires a protected Alertmanager config", () => {
  assert.match(observabilityCompose, /ALERTMANAGER_CONFIG_FILE:\?ALERTMANAGER_CONFIG_FILE is required/);
  assert.match(observabilityCompose, /prom\/alertmanager:v0\.32\.1/);
  assert.match(observabilityCompose, /prom\/prometheus:v3\.13\.2/);
  assert.match(observabilityCompose, /condition: service_healthy/);
});

test("Prometheus forwards alerts to the Compose Alertmanager service", () => {
  assert.match(prometheusConfig, /alertmanagers:[\s\S]*targets: \["alertmanager:9093"\]/);
});

test("the production Migrator and CI retain the verified migration execution path", async () => {
  const dockerfile = await readFile(new URL("../apps/api/Dockerfile", import.meta.url), "utf8");
  const stage = dockerfile.split("FROM node:22-alpine AS migrator")[1]?.split("FROM node:22-alpine AS runner")[0];
  assert.ok(stage);
  assert.match(stage, /CMD \["node", "scripts\/database-command\.mjs", "migrate"\]/);
  assert.match(stage, /migration-runner\.mjs/);
  assert.match(stage, /migration-baseline\.mjs/);
  assert.match(stage, /USER migration_user/);
  assert.doesNotMatch(stage, /drizzle-kit/);
  const workflow = await readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
  assert.match(workflow, /run: pnpm test:migrations/);
  assert.match(workflow, /service: migrations[\s\S]*target: migrator/);
});
