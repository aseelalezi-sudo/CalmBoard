import "dotenv/config";

const serviceArgument = process.argv.find((argument) => argument.startsWith("--service="));
const service = serviceArgument?.slice("--service=".length) || "all";
if (!new Set(["all", "api", "worker"]).has(service)) {
  throw new Error("--service must be one of: all, api, worker");
}
const checksApi = service === "all" || service === "api";
const checksWorker = service === "all" || service === "worker";

const required =
  service === "api" ? ["DATABASE_APP_URL"] : service === "worker" ? ["DATABASE_MAINTENANCE_URL"] : ["DATABASE_URL"];
const commonProductionRequired = [
  "REDIS_URL",
  "S3_ENDPOINT",
  "S3_BUCKET",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "METRICS_BEARER_TOKEN",
];
const apiProductionRequired = [
  "APP_URL",
  "API_PUBLIC_URL",
  "AUTH_TOKEN_SECRET",
  "DATABASE_APP_URL",
  "WEBHOOK_SIGNING_SECRET",
  "S3_PUBLIC_ENDPOINT",
  "TRUST_PROXY_HOPS",
  "ATTACHMENT_SCAN_MODE",
  "ATTACHMENT_SCANNER_URL",
  "ATTACHMENT_SCANNER_TOKEN",
  "TURNSTILE_SITE_KEY",
  "TURNSTILE_SECRET_KEY",
];
const workerProductionRequired = ["DATABASE_MAINTENANCE_URL", "RESEND_API_KEY", "RESEND_FROM_EMAIL"];
const placeholderValues = new Set([
  "change-me",
  "change-me-in-production",
  "dev_postgres_password",
  "dev_minio_password",
  "whsec_simulated_secret_2026",
  "re_simulated_key",
  "notifications@example.com",
]);
const unsafeDevelopmentFragments = [
  "dev_postgres_password",
  "dev_minio_password",
  "development-auth-token-secret-change-in-production",
  "development-webhook-secret-change-in-production",
];

const isProduction = process.env.NODE_ENV === "production";
const missing = [];
const unsafe = [];

const oauthProviders = [
  {
    flag: "AUTH_GOOGLE_OAUTH_ENABLED",
    required: ["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET", "API_PUBLIC_URL"],
  },
  {
    flag: "AUTH_MICROSOFT_OAUTH_ENABLED",
    required: ["MICROSOFT_OAUTH_CLIENT_ID", "MICROSOFT_OAUTH_CLIENT_SECRET", "API_PUBLIC_URL"],
  },
  {
    flag: "INTEGRATION_GITHUB_OAUTH_ENABLED",
    required: ["INTEGRATION_GITHUB_CLIENT_ID", "INTEGRATION_GITHUB_CLIENT_SECRET", "API_PUBLIC_URL", "APP_URL"],
  },
  {
    flag: "INTEGRATION_SLACK_OAUTH_ENABLED",
    required: ["INTEGRATION_SLACK_CLIENT_ID", "INTEGRATION_SLACK_CLIENT_SECRET", "API_PUBLIC_URL", "APP_URL"],
  },
  {
    flag: "INTEGRATION_GOOGLE_OAUTH_ENABLED",
    required: ["INTEGRATION_GOOGLE_CLIENT_ID", "INTEGRATION_GOOGLE_CLIENT_SECRET", "API_PUBLIC_URL", "APP_URL"],
  },
  {
    flag: "INTEGRATION_MICROSOFT_OAUTH_ENABLED",
    required: ["INTEGRATION_MICROSOFT_CLIENT_ID", "INTEGRATION_MICROSOFT_CLIENT_SECRET", "API_PUBLIC_URL", "APP_URL"],
  },
];

for (const name of required) {
  if (!process.env[name]) missing.push(name);
}

if (isProduction) {
  const productionRequired = [
    ...commonProductionRequired,
    ...(checksApi ? apiProductionRequired : []),
    ...(checksWorker ? workerProductionRequired : []),
  ];
  for (const name of productionRequired) {
    if (!process.env[name]) missing.push(name);
  }

  for (const [name, value] of Object.entries(process.env)) {
    if (value && placeholderValues.has(value)) unsafe.push(name);
    if (value && unsafeDevelopmentFragments.some((fragment) => value.includes(fragment))) unsafe.push(name);
  }

  if (process.env.STRIPE_SECRET_KEY && !process.env.STRIPE_WEBHOOK_SECRET) {
    missing.push("STRIPE_WEBHOOK_SECRET");
  }

  if (checksApi && !process.env.INTEGRATION_CREDENTIALS_KEY && !process.env.INTEGRATION_CREDENTIALS_KEYS) {
    missing.push("INTEGRATION_CREDENTIALS_KEY or INTEGRATION_CREDENTIALS_KEYS");
  }
  if (checksApi && !process.env.MFA_ENCRYPTION_KEY && !process.env.MFA_ENCRYPTION_KEYS) {
    missing.push("MFA_ENCRYPTION_KEY or MFA_ENCRYPTION_KEYS");
  }
  if (
    (checksApi || checksWorker) &&
    !process.env.AUTH_EMAIL_ENCRYPTION_KEY &&
    !process.env.AUTH_EMAIL_ENCRYPTION_KEYS
  ) {
    missing.push("AUTH_EMAIL_ENCRYPTION_KEY or AUTH_EMAIL_ENCRYPTION_KEYS");
  }

  if (process.env.AUTH_TOKEN_SECRET && Buffer.byteLength(process.env.AUTH_TOKEN_SECRET, "utf8") < 32) {
    unsafe.push("AUTH_TOKEN_SECRET (must contain at least 32 bytes)");
  }

  if (process.env.METRICS_BEARER_TOKEN && Buffer.byteLength(process.env.METRICS_BEARER_TOKEN, "utf8") < 32) {
    unsafe.push("METRICS_BEARER_TOKEN (must contain at least 32 bytes)");
  }

  if (process.env.ENABLE_OTEL === "true" && !process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
    missing.push("OTEL_EXPORTER_OTLP_ENDPOINT");
  }

  if (process.env.REDIS_URL) {
    try {
      const redisUrl = new URL(process.env.REDIS_URL);
      if (!/^rediss?:$/.test(redisUrl.protocol) || !redisUrl.hostname || redisUrl.hash) {
        unsafe.push("REDIS_URL (must be a valid redis:// or rediss:// URL)");
      }
    } catch {
      unsafe.push("REDIS_URL (must be a valid redis:// or rediss:// URL)");
    }
  }

  if (checksApi && process.env.DATABASE_APP_URL && process.env.DATABASE_APP_URL === process.env.DATABASE_URL) {
    unsafe.push("DATABASE_APP_URL (must use a separate NOBYPASSRLS runtime role)");
  }

  if (checksApi && (!/^\d+$/.test(process.env.TRUST_PROXY_HOPS ?? "") || Number(process.env.TRUST_PROXY_HOPS) > 10)) {
    unsafe.push("TRUST_PROXY_HOPS (must be an integer between 0 and 10)");
  }

  if (checksApi && process.env.ATTACHMENT_SCAN_MODE !== "webhook") {
    unsafe.push("ATTACHMENT_SCAN_MODE (must be webhook in production)");
  }

  if (checksApi && process.env.ATTACHMENT_SCANNER_URL) {
    try {
      const scannerUrl = new URL(process.env.ATTACHMENT_SCANNER_URL);
      if (!/^https?:$/.test(scannerUrl.protocol) || scannerUrl.username || scannerUrl.password) {
        unsafe.push("ATTACHMENT_SCANNER_URL (must be an HTTP(S) URL without embedded credentials)");
      }
    } catch {
      unsafe.push("ATTACHMENT_SCANNER_URL (must be an absolute URL)");
    }
  }

  const licenseEnforced = process.env.CALMBOARD_LICENSE_ENFORCED?.trim().toLowerCase();
  if (checksApi && licenseEnforced && licenseEnforced !== "true" && licenseEnforced !== "false") {
    unsafe.push("CALMBOARD_LICENSE_ENFORCED (must be true or false)");
  }
  if (checksApi && licenseEnforced === "true") {
    for (const name of [
      "CALMBOARD_LICENSE_SERVER_URL",
      "CALMBOARD_LICENSE_DEVICE_HASH_SECRET",
      "CALMBOARD_LICENSE_STORE_SECRET",
      "CALMBOARD_LICENSE_STORE_FILE",
    ]) {
      if (!process.env[name]) missing.push(name);
    }
    if (
      process.env.CALMBOARD_LICENSE_STORE_SECRET &&
      Buffer.byteLength(process.env.CALMBOARD_LICENSE_STORE_SECRET, "utf8") < 32
    ) {
      unsafe.push("CALMBOARD_LICENSE_STORE_SECRET (must contain at least 32 bytes)");
    }
  }
}

for (const provider of checksApi ? oauthProviders : []) {
  const flagValue = process.env[provider.flag]?.trim().toLowerCase();
  if (flagValue && flagValue !== "true" && flagValue !== "false") {
    unsafe.push(`${provider.flag} (must be true or false)`);
  }
  if (flagValue === "true") {
    for (const name of provider.required) {
      if (!process.env[name]) missing.push(name);
    }
  }
}

for (const provider of checksApi
  ? [
      { key: "OPENAI_API_KEY", model: "OPENAI_MODEL", provider: "openai" },
      { key: "ANTHROPIC_API_KEY", model: "ANTHROPIC_MODEL", provider: "anthropic" },
    ]
  : []) {
  if (process.env[provider.key] && !process.env[provider.model]?.trim()) {
    missing.push(provider.model);
  }
  if (process.env[provider.key] && !process.env.AI_MODEL_PRICING_JSON?.trim()) {
    missing.push("AI_MODEL_PRICING_JSON");
  }
  if (process.env[provider.key] && process.env[provider.model]?.trim() && process.env.AI_MODEL_PRICING_JSON?.trim()) {
    try {
      const pricing = JSON.parse(process.env.AI_MODEL_PRICING_JSON);
      const entry = pricing?.[`${provider.provider}:${process.env[provider.model].trim()}`];
      if (
        !entry ||
        typeof entry !== "object" ||
        !Number.isFinite(entry.inputUsdPerMillion) ||
        entry.inputUsdPerMillion < 0 ||
        !Number.isFinite(entry.outputUsdPerMillion) ||
        entry.outputUsdPerMillion < 0
      ) {
        unsafe.push(`AI_MODEL_PRICING_JSON (missing valid ${provider.provider}:${process.env[provider.model].trim()})`);
      }
    } catch {
      unsafe.push("AI_MODEL_PRICING_JSON (invalid JSON)");
    }
  }
}

if (process.env.API_PUBLIC_URL) {
  try {
    const apiUrl = new URL(process.env.API_PUBLIC_URL);
    if (!/^https?:$/.test(apiUrl.protocol) || apiUrl.username || apiUrl.password || apiUrl.search || apiUrl.hash) {
      unsafe.push("API_PUBLIC_URL (must be a clean HTTP(S) origin)");
    }
  } catch {
    unsafe.push("API_PUBLIC_URL (must be an absolute URL)");
  }
}

if (process.env.MICROSOFT_OAUTH_TENANT && !/^[A-Za-z0-9.-]{1,255}$/.test(process.env.MICROSOFT_OAUTH_TENANT)) {
  unsafe.push("MICROSOFT_OAUTH_TENANT");
}

if (
  process.env.INTEGRATION_MICROSOFT_TENANT &&
  !/^[A-Za-z0-9.-]{1,255}$/.test(process.env.INTEGRATION_MICROSOFT_TENANT)
) {
  unsafe.push("INTEGRATION_MICROSOFT_TENANT");
}

if (process.env.CALMBOARD_QUEUE_NAME && !/^[A-Za-z0-9_-]{1,100}$/.test(process.env.CALMBOARD_QUEUE_NAME)) {
  unsafe.push("CALMBOARD_QUEUE_NAME");
}

if (
  process.env.STRIPE_GRACE_PERIOD_DAYS &&
  (!/^\d+$/.test(process.env.STRIPE_GRACE_PERIOD_DAYS) ||
    Number(process.env.STRIPE_GRACE_PERIOD_DAYS) < 1 ||
    Number(process.env.STRIPE_GRACE_PERIOD_DAYS) > 30)
) {
  unsafe.push("STRIPE_GRACE_PERIOD_DAYS (must be an integer between 1 and 30)");
}

function isValidEncryptionKey(value) {
  if (/^[a-f0-9]{64}$/i.test(value)) return true;
  try {
    return Buffer.from(value, "base64").length === 32;
  } catch {
    return false;
  }
}

if (process.env.INTEGRATION_CREDENTIALS_KEY && !isValidEncryptionKey(process.env.INTEGRATION_CREDENTIALS_KEY)) {
  unsafe.push("INTEGRATION_CREDENTIALS_KEY (must encode exactly 32 bytes)");
}

if (process.env.MFA_ENCRYPTION_KEY && !isValidEncryptionKey(process.env.MFA_ENCRYPTION_KEY)) {
  unsafe.push("MFA_ENCRYPTION_KEY (must encode exactly 32 bytes)");
}

if (process.env.AUTH_EMAIL_ENCRYPTION_KEY && !isValidEncryptionKey(process.env.AUTH_EMAIL_ENCRYPTION_KEY)) {
  unsafe.push("AUTH_EMAIL_ENCRYPTION_KEY (must encode exactly 32 bytes)");
}

if (process.env.MFA_ENCRYPTION_KEYS) {
  try {
    const keys = JSON.parse(process.env.MFA_ENCRYPTION_KEYS);
    if (
      !keys ||
      typeof keys !== "object" ||
      Array.isArray(keys) ||
      !Object.keys(keys).length ||
      Object.entries(keys).some(
        ([version, key]) =>
          !/^\d+$/.test(version) || Number(version) <= 0 || typeof key !== "string" || !isValidEncryptionKey(key),
      )
    ) {
      unsafe.push("MFA_ENCRYPTION_KEYS (invalid keyring)");
    }
  } catch {
    unsafe.push("MFA_ENCRYPTION_KEYS (invalid JSON)");
  }
}

if (
  process.env.MFA_ENCRYPTION_ACTIVE_KEY_VERSION &&
  (!/^\d+$/.test(process.env.MFA_ENCRYPTION_ACTIVE_KEY_VERSION) ||
    Number(process.env.MFA_ENCRYPTION_ACTIVE_KEY_VERSION) <= 0)
) {
  unsafe.push("MFA_ENCRYPTION_ACTIVE_KEY_VERSION");
}

if (process.env.AUTH_EMAIL_ENCRYPTION_KEYS) {
  try {
    const keys = JSON.parse(process.env.AUTH_EMAIL_ENCRYPTION_KEYS);
    if (
      !keys ||
      typeof keys !== "object" ||
      Array.isArray(keys) ||
      !Object.keys(keys).length ||
      Object.entries(keys).some(
        ([version, key]) =>
          !/^\d+$/.test(version) || Number(version) <= 0 || typeof key !== "string" || !isValidEncryptionKey(key),
      )
    ) {
      unsafe.push("AUTH_EMAIL_ENCRYPTION_KEYS (invalid keyring)");
    }
  } catch {
    unsafe.push("AUTH_EMAIL_ENCRYPTION_KEYS (invalid JSON)");
  }
}

if (
  process.env.AUTH_EMAIL_ENCRYPTION_ACTIVE_KEY_VERSION &&
  (!/^\d+$/.test(process.env.AUTH_EMAIL_ENCRYPTION_ACTIVE_KEY_VERSION) ||
    Number(process.env.AUTH_EMAIL_ENCRYPTION_ACTIVE_KEY_VERSION) <= 0)
) {
  unsafe.push("AUTH_EMAIL_ENCRYPTION_ACTIVE_KEY_VERSION");
}

if (process.env.INTEGRATION_CREDENTIALS_KEYS) {
  try {
    const keys = JSON.parse(process.env.INTEGRATION_CREDENTIALS_KEYS);
    if (
      !keys ||
      typeof keys !== "object" ||
      Array.isArray(keys) ||
      !Object.keys(keys).length ||
      Object.entries(keys).some(
        ([version, key]) =>
          !/^\d+$/.test(version) || Number(version) <= 0 || typeof key !== "string" || !isValidEncryptionKey(key),
      )
    ) {
      unsafe.push("INTEGRATION_CREDENTIALS_KEYS (invalid keyring)");
    }
  } catch {
    unsafe.push("INTEGRATION_CREDENTIALS_KEYS (invalid JSON)");
  }
}

if (
  process.env.INTEGRATION_CREDENTIALS_ACTIVE_KEY_VERSION &&
  (!/^\d+$/.test(process.env.INTEGRATION_CREDENTIALS_ACTIVE_KEY_VERSION) ||
    Number(process.env.INTEGRATION_CREDENTIALS_ACTIVE_KEY_VERSION) <= 0)
) {
  unsafe.push("INTEGRATION_CREDENTIALS_ACTIVE_KEY_VERSION");
}

if (missing.length > 0 || unsafe.length > 0) {
  if (missing.length > 0) {
    console.error(`Missing environment variables: ${missing.join(", ")}`);
  }

  if (unsafe.length > 0) {
    console.error(`Unsafe placeholder values in production: ${unsafe.join(", ")}`);
  }

  process.exit(1);
}

console.log("Environment configuration looks valid.");
