import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import test from "node:test";
import { fileURLToPath } from "node:url";

const checker = fileURLToPath(new URL("./check-env.mjs", import.meta.url));
const encryptionKey = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const baseProductionEnvironment = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://maintenance:strong-password@postgres:5432/calmboard",
  REDIS_URL: "redis://redis:6379/0",
  S3_ENDPOINT: "http://minio:9000",
  S3_BUCKET: "calmboard-attachments",
  S3_ACCESS_KEY_ID: "production-access-key",
  S3_SECRET_ACCESS_KEY: "production-object-secret",
  METRICS_BEARER_TOKEN: "0123456789abcdef0123456789abcdef",
  AUTH_EMAIL_ENCRYPTION_KEY: encryptionKey,
};

const apiEnvironment = {
  ...baseProductionEnvironment,
  APP_URL: "https://calmboard.example",
  API_PUBLIC_URL: "https://api.calmboard.example",
  AUTH_TOKEN_SECRET: "0123456789abcdef0123456789abcdef",
  DATABASE_APP_URL: "postgresql://app:strong-password@postgres:5432/calmboard",
  WEBHOOK_SIGNING_SECRET: "production-webhook-signing-secret",
  S3_PUBLIC_ENDPOINT: "https://objects.calmboard.example",
  TRUST_PROXY_HOPS: "1",
  ATTACHMENT_SCAN_MODE: "webhook",
  ATTACHMENT_SCANNER_URL: "https://scanner.calmboard.example/scan",
  ATTACHMENT_SCANNER_TOKEN: "production-scanner-token",
  TURNSTILE_SITE_KEY: "production-site-key",
  TURNSTILE_SECRET_KEY: "production-turnstile-secret",
  INTEGRATION_CREDENTIALS_KEY: encryptionKey,
  MFA_ENCRYPTION_KEY: encryptionKey,
};
delete apiEnvironment.DATABASE_URL;

const workerEnvironment = {
  ...baseProductionEnvironment,
  DATABASE_MAINTENANCE_URL: "postgresql://worker:strong-password@postgres:5432/calmboard",
  RESEND_API_KEY: "production-email-provider-key",
  RESEND_FROM_EMAIL: "notifications@calmboard.example",
};

function check(service, environment) {
  return spawnSync(process.execPath, [checker, `--service=${service}`], {
    cwd: tmpdir(),
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      ...environment,
    },
  });
}

test("production API validation fails before startup when mandatory security configuration is missing", () => {
  const result = check("api", { ...apiEnvironment, AUTH_TOKEN_SECRET: "" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /AUTH_TOKEN_SECRET/);
});

test("production API requires only the NOBYPASSRLS runtime database role", () => {
  const valid = check("api", apiEnvironment);
  assert.equal(valid.status, 0, valid.stderr);
  const missingRuntimeRole = check("api", { ...apiEnvironment, DATABASE_APP_URL: "" });
  assert.notEqual(missingRuntimeRole.status, 0);
  assert.match(missingRuntimeRole.stderr, /DATABASE_APP_URL/);
});

test("production services reject malformed Redis configuration before startup", () => {
  const result = check("api", { ...apiEnvironment, REDIS_URL: "http://redis:6379/0" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /REDIS_URL/);
});

test("production API rejects unsafe proxy and attachment scanner modes before startup", () => {
  const unsafeProxy = check("api", { ...apiEnvironment, TRUST_PROXY_HOPS: "11" });
  assert.notEqual(unsafeProxy.status, 0);
  assert.match(unsafeProxy.stderr, /TRUST_PROXY_HOPS/);

  const disabledScanner = check("api", { ...apiEnvironment, ATTACHMENT_SCAN_MODE: "disabled" });
  assert.notEqual(disabledScanner.status, 0);
  assert.match(disabledScanner.stderr, /ATTACHMENT_SCAN_MODE/);
});

test("optional licensing configuration is required only when enforcement is enabled", () => {
  const disabled = check("api", { ...apiEnvironment, CALMBOARD_LICENSE_ENFORCED: "false" });
  assert.equal(disabled.status, 0, disabled.stderr);

  const enabledWithoutProtocol = check("api", { ...apiEnvironment, CALMBOARD_LICENSE_ENFORCED: "true" });
  assert.notEqual(enabledWithoutProtocol.status, 0);
  assert.match(enabledWithoutProtocol.stderr, /CALMBOARD_LICENSE_SERVER_URL/);
  assert.match(enabledWithoutProtocol.stderr, /CALMBOARD_LICENSE_STORE_SECRET/);
});

test("production worker validation fails before startup when its delivery configuration is missing", () => {
  const result = check("worker", { ...workerEnvironment, RESEND_API_KEY: "" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /RESEND_API_KEY/);
});

test("valid service-specific production environments pass without exposing secrets", () => {
  for (const [service, environment] of [
    ["api", apiEnvironment],
    ["worker", workerEnvironment],
  ]) {
    const result = check(service, environment);
    assert.equal(result.status, 0, `${service}: ${result.stderr}`);
    assert.match(result.stdout, /looks valid/);
    assert.doesNotMatch(`${result.stdout}${result.stderr}`, /production-scanner-token|production-object-secret/);
  }
});
