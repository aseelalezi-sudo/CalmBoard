import { createHash } from "node:crypto";

export const purgeDomains = [
  "account_security",
  "account_profile",
  "account_memberships",
  "organization_relational",
  "attachments",
  "attachment_previews",
  "documents",
  "exports",
  "reports",
  "integration_oauth",
  "billing_provider",
  "final_verification",
] as const;

export const purgeLocatorKinds = ["sql_keyset", "object_key", "provider_resource"] as const;

export type PurgeDomain = (typeof purgeDomains)[number];
export type PurgeLocatorKind = (typeof purgeLocatorKinds)[number];

const sqlKeysetTables = new Set([
  "activities",
  "ai_action_proposals",
  "ai_usage_events",
  "ai_usage_periods",
  "attachments",
  "automation_events",
  "automation_runs",
  "automations",
  "branches",
  "comment_mentions",
  "comments",
  "custom_fields",
  "dashboard_layouts",
  "doc_versions",
  "docs",
  "document_permissions",
  "export_jobs",
  "form_responses",
  "forms",
  "goal_checkins",
  "goal_task_links",
  "goals",
  "idempotency_keys",
  "integration_credentials",
  "integration_webhook_endpoints",
  "integration_webhook_receipts",
  "invoices",
  "invitation_email_outbox",
  "invitations",
  "membership_permission_overrides",
  "membership_role_bindings",
  "memberships",
  "notification_email_outbox",
  "notifications",
  "project_baseline_tasks",
  "project_baselines",
  "project_members",
  "project_sections",
  "project_teams",
  "project_wip_limits",
  "projects",
  "report_schedule_recipients",
  "report_schedules",
  "roles",
  "saved_views",
  "sprint_analytics_events",
  "sprint_snapshots",
  "sprints",
  "subscriptions",
  "task_approval_requests",
  "task_approval_reviewers",
  "task_assignees",
  "task_checklist_items",
  "task_checklists",
  "task_dependencies",
  "task_followers",
  "task_recurrence_rules",
  "task_relations",
  "task_reminders",
  "task_serial_sequences",
  "task_sprint_assignments",
  "tasks",
  "teams",
  "time_logs",
  "timesheets",
  "usage_limits",
  "user_onboarding_progress",
  "workload_capacities",
  "workload_time_off",
  "workspaces",
]);

function exactKeys(locator: Record<string, unknown>, allowed: readonly string[]) {
  const actual = Object.keys(locator).sort();
  const expected = [...allowed].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError("Purge locator fields do not match the allow-listed contract");
  }
}

function safeIdentifier(value: unknown, field: string, nullable = false) {
  if (nullable && value === null) return;
  if (typeof value !== "string" || !value || value.length > 512 || /[?#[\]\r\n]/.test(value)) {
    throw new TypeError(`${field} is not a safe purge locator identifier`);
  }
}

/** Validates executable locators without permitting SQL, credentials, or signed URLs. */
export function validatePurgeLocator(
  domain: PurgeDomain,
  locatorKind: PurgeLocatorKind,
  locator: Record<string, unknown>,
) {
  canonicalJson(locator);
  for (const [key, value] of Object.entries(locator)) {
    if (/(password|secret|token|authorization|encrypted|signature|signed.?url)/i.test(key)) {
      throw new TypeError("Purge locators cannot contain credentials or signed URLs");
    }
    if (typeof value === "string" && /^https?:\/\//i.test(value)) {
      throw new TypeError("Purge locators cannot contain HTTP URLs");
    }
  }
  if (locatorKind === "sql_keyset") {
    exactKeys(locator, ["table", "cursor"]);
    if (typeof locator.table !== "string" || !sqlKeysetTables.has(locator.table)) {
      throw new TypeError("SQL keyset table is not allow-listed");
    }
    if (locator.cursor !== null) safeIdentifier(locator.cursor, "cursor");
    return;
  }
  if (locatorKind === "object_key") {
    if (domain === "attachments" || domain === "attachment_previews") {
      exactKeys(locator, ["attachmentId", "reference"]);
      safeIdentifier(locator.attachmentId, "attachmentId");
      safeIdentifier(locator.reference, "reference");
      if (!(locator.reference as string).startsWith("s3://")) {
        throw new TypeError("Attachment locator must use a private S3 reference");
      }
      return;
    }
    if (domain === "exports") {
      exactKeys(locator, ["exportJobId", "key"]);
      safeIdentifier(locator.exportJobId, "exportJobId");
      safeIdentifier(locator.key, "key");
      if ((locator.key as string).startsWith("s3://")) throw new TypeError("Export locator must contain an object key");
      return;
    }
    throw new TypeError("Object-key locator is not supported for this purge domain");
  }
  if (domain === "integration_oauth") {
    exactKeys(locator, ["credentialId", "provider", "externalAccountId"]);
    safeIdentifier(locator.credentialId, "credentialId");
    safeIdentifier(locator.provider, "provider");
    safeIdentifier(locator.externalAccountId, "externalAccountId", true);
    return;
  }
  if (domain === "billing_provider") {
    exactKeys(locator, ["subscriptionId", "provider", "providerSubscriptionId"]);
    safeIdentifier(locator.subscriptionId, "subscriptionId");
    safeIdentifier(locator.provider, "provider");
    safeIdentifier(locator.providerSubscriptionId, "providerSubscriptionId", true);
    return;
  }
  throw new TypeError("Provider-resource locator is not supported for this purge domain");
}

function serializeCanonicalJson(value: unknown, ancestors: Set<object>): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Canonical JSON does not support non-finite numbers");
    return Object.is(value, -0) ? "0" : JSON.stringify(value);
  }
  if (typeof value !== "object") throw new TypeError(`Canonical JSON does not support ${typeof value}`);
  if (ancestors.has(value)) throw new TypeError("Canonical JSON does not support cyclic values");

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.keys(value).some((key) => !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length)) {
        throw new TypeError("Canonical JSON arrays cannot have named properties");
      }
      return `[${Array.from({ length: value.length }, (_, index) => {
        if (!Object.hasOwn(value, index)) throw new TypeError("Canonical JSON arrays cannot be sparse");
        return serializeCanonicalJson(value[index], ancestors);
      }).join(",")}]`;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Canonical JSON accepts only plain objects");
    }
    const object = value as Record<string, unknown>;
    const keys = Object.keys(object).sort();
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${serializeCanonicalJson(object[key], ancestors)}`)
      .join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

/**
 * Canonicalizes JSON using ECMAScript's stable JSON string/number representation
 * and recursive UTF-16 code-unit ordering for object keys. Unicode strings are
 * preserved exactly; normalization is intentionally not inferred.
 */
export function canonicalJson(value: unknown): string {
  return serializeCanonicalJson(value, new Set());
}

export function purgeLocatorFingerprint(
  domain: PurgeDomain,
  locatorKind: PurgeLocatorKind,
  locator: Record<string, unknown>,
) {
  const canonicalLocator = canonicalJson(locator);
  return createHash("sha256").update(`${domain}\n${locatorKind}\n${canonicalLocator}`, "utf8").digest("hex");
}
