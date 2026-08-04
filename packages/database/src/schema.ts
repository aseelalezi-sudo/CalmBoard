import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  date,
  integer,
  bigint,
  boolean,
  jsonb,
  doublePrecision,
  pgEnum,
  index,
  uniqueIndex,
  check,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export type FormFieldType = "text" | "textarea" | "email" | "number" | "date" | "select" | "radio" | "checkbox";
export type FormConditionOperator = "equals" | "not_equals" | "contains" | "is_empty" | "not_empty";
export type FormFieldCondition = {
  fieldId: string;
  operator: FormConditionOperator;
  value?: string;
};
export type FormFieldDefinition = {
  id: string;
  type: FormFieldType;
  label: string;
  description?: string;
  placeholder?: string;
  required?: boolean;
  options?: string[];
  condition?: FormFieldCondition;
};
export type FormSettings = {
  schemaVersion: 1;
  createTask: boolean;
  status: "backlog" | "todo" | "in_progress" | "review";
  priority: "low" | "medium" | "high" | "urgent";
  captchaEnabled: boolean;
  submitLabel?: string;
  successMessage?: string;
  taskTitleFieldId?: string;
  taskDescriptionFieldId?: string;
};
export type FormTaskCreationPayload = {
  projectId: string;
  title: string;
  description: string;
  status: "backlog" | "todo" | "in_progress" | "review";
  priority: "low" | "medium" | "high" | "urgent";
};
export type FormTaskCreationStatus = "not_requested" | "pending" | "processing" | "completed" | "dead";
export type DashboardWidgetId =
  | "total_tasks"
  | "completed_tasks"
  | "in_progress_tasks"
  | "overdue_tasks"
  | "status_chart"
  | "project_completion"
  | "custom_chart"
  | "goals"
  | "team_distribution"
  | "time_logged"
  | "activity";
export type DashboardWidgetWidth = "small" | "medium" | "wide" | "full";
export type DashboardWidgetDefinition = {
  id: DashboardWidgetId;
  width: DashboardWidgetWidth;
  settings?: {
    chartType?: "bar" | "rank" | "donut";
    groupBy?: "assignee" | "priority" | "status" | "tag";
    metric?: "count" | "points" | "estimate" | "logged";
  };
};
export type WorkspaceExportFormat = "json" | "pdf" | "xlsx";
export type ScheduledReportFormat = "pdf" | "xlsx";
export type ReportScheduleCadence = "daily" | "weekly" | "monthly";
export type AIProposedTask = {
  title: string;
  description: string;
  priority: "low" | "medium" | "high" | "urgent";
  estimatedHours?: number;
};

export const userRoleEnum = pgEnum("user_role", ["owner", "admin", "manager", "member", "guest", "viewer"]);
export const projectStatusEnum = pgEnum("project_status", ["planning", "active", "on_hold", "completed", "archived"]);
export const taskStatusEnum = pgEnum("task_status", ["backlog", "todo", "in_progress", "review", "done", "canceled"]);
export const taskPriorityEnum = pgEnum("task_priority", ["low", "medium", "high", "urgent"]);
export const documentAccessLevelEnum = pgEnum("document_access_level", ["viewer", "editor", "manager"]);
export const documentWorkspaceAccessEnum = pgEnum("document_workspace_access", ["none", "viewer", "editor"]);
export const orgPlanEnum = pgEnum("org_plan", ["free", "starter", "team", "business", "enterprise"]);
export const subscriptionBillingIntervalEnum = pgEnum("subscription_billing_interval", ["monthly", "yearly"]);
export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "trialing",
  "active",
  "past_due",
  "grace_period",
  "paused",
  "canceled",
  "incomplete",
]);
export const integrationAuthTypeEnum = pgEnum("integration_auth_type", [
  "oauth2",
  "api_key",
  "bearer",
  "basic",
  "webhook_secret",
]);
export const integrationCredentialStatusEnum = pgEnum("integration_credential_status", [
  "active",
  "expired",
  "error",
  "revoked",
]);
export const idempotencyKeyStatusEnum = pgEnum("idempotency_key_status", ["processing", "completed", "failed"]);
export const notificationEmailStatusEnum = pgEnum("notification_email_status", [
  "pending",
  "processing",
  "sent",
  "skipped",
  "dead",
]);
export const exportJobStatusEnum = pgEnum("export_job_status", [
  "pending",
  "processing",
  "completed",
  "dead",
  "expired",
]);
export const authorizationScopeEnum = pgEnum("authorization_scope", ["organization", "workspace", "project"]);
export const permissionOverrideEffectEnum = pgEnum("permission_override_effect", ["allow", "deny"]);
export const projectMemberRoleEnum = pgEnum("project_member_role", ["manager", "member", "guest", "viewer"]);
export const taskDependencyTypeEnum = pgEnum("task_dependency_type", [
  "finish_to_start",
  "start_to_start",
  "finish_to_finish",
  "start_to_finish",
]);
export const taskRelationTypeEnum = pgEnum("task_relation_type", ["related", "duplicate_of", "caused_by"]);
export const taskReminderStatusEnum = pgEnum("task_reminder_status", ["scheduled", "sent", "failed"]);
export const taskRecurrenceFrequencyEnum = pgEnum("task_recurrence_frequency", [
  "daily",
  "weekly",
  "monthly",
  "yearly",
]);
export const taskRecurrenceStatusEnum = pgEnum("task_recurrence_status", ["active", "paused", "completed"]);
export const taskApprovalModeEnum = pgEnum("task_approval_mode", ["all", "any", "sequential"]);
export const taskApprovalStatusEnum = pgEnum("task_approval_status", ["pending", "approved", "rejected", "canceled"]);
export const taskApprovalReviewerStatusEnum = pgEnum("task_approval_reviewer_status", [
  "pending",
  "approved",
  "rejected",
  "skipped",
]);
export const workloadTimeOffKindEnum = pgEnum("workload_time_off_kind", [
  "vacation",
  "sick",
  "personal",
  "public_holiday",
]);
export const workloadTimeOffStatusEnum = pgEnum("workload_time_off_status", ["requested", "approved", "rejected"]);
export const authTokenPurposeEnum = pgEnum("auth_token_purpose", ["email_verification", "password_reset", "mfa_login"]);
export const mfaStatusEnum = pgEnum("mfa_status", ["pending", "enabled"]);
export const oauthProviderEnum = pgEnum("oauth_provider", ["google", "microsoft"]);
export const securityEventOutcomeEnum = pgEnum("security_event_outcome", [
  "success",
  "failure",
  "blocked",
  "challenge",
]);
export const securityEventTypeEnum = pgEnum("security_event_type", [
  "account_registered",
  "login_password",
  "login_oauth",
  "login_mfa",
  "logout",
  "email_verified",
  "password_reset_requested",
  "password_reset_completed",
  "mfa_enabled",
  "mfa_disabled",
  "session_revoked",
  "sessions_revoked",
  "authorization_role_changed",
  "authorization_binding_changed",
  "permission_override_changed",
]);
export const aiUsageStatusEnum = pgEnum("ai_usage_status", ["pending", "completed", "failed"]);
export const aiProposalStatusEnum = pgEnum("ai_proposal_status", ["pending", "executed", "rejected", "expired"]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: varchar("email", { length: 255 }).notNull().unique(),
    name: varchar("name", { length: 255 }).notNull(),
    avatarUrl: text("avatar_url"),
    passwordHash: varchar("password_hash", { length: 255 }),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    passwordChangedAt: timestamp("password_changed_at", { withTimezone: true }),
    failedLoginAttempts: integer("failed_login_attempts").default(0).notNull(),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    lastFailedLoginAt: timestamp("last_failed_login_at", { withTimezone: true }),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    locale: varchar("locale", { length: 10 }).default("ar"),
    theme: varchar("theme", { length: 20 }).default("system"),
    isPlatformAdmin: boolean("is_platform_admin").default(false).notNull(),
    skills: jsonb("skills").$type<string[]>().default([]).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("users_locked_until_idx").on(table.lockedUntil),
    check("users_failed_login_attempts_check", sql`${table.failedLoginAttempts} >= 0`),
    check("users_login_lock_state_check", sql`${table.failedLoginAttempts} < 5 or ${table.lockedUntil} is not null`),
  ],
);

export const authTokens = pgTable(
  "auth_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    purpose: authTokenPurposeEnum("purpose").notNull(),
    tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    invalidatedAt: timestamp("invalidated_at", { withTimezone: true }),
    requestedIp: varchar("requested_ip", { length: 64 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("auth_tokens_user_purpose_active_unique")
      .on(table.userId, table.purpose)
      .where(sql`${table.consumedAt} is null and ${table.invalidatedAt} is null`),
    index("auth_tokens_user_purpose_created_idx").on(table.userId, table.purpose, table.createdAt),
    check("auth_tokens_expiry_check", sql`${table.expiresAt} > ${table.createdAt}`),
    check(
      "auth_tokens_terminal_state_check",
      sql`not (${table.consumedAt} is not null and ${table.invalidatedAt} is not null)`,
    ),
  ],
);

export const authEmailOutbox = pgTable(
  "auth_email_outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    authTokenId: uuid("auth_token_id")
      .references(() => authTokens.id, { onDelete: "cascade" })
      .notNull(),
    purpose: authTokenPurposeEnum("purpose").notNull(),
    encryptedPayload: text("encrypted_payload").notNull(),
    initializationVector: varchar("initialization_vector", { length: 24 }).notNull(),
    authenticationTag: varchar("authentication_tag", { length: 24 }).notNull(),
    encryptionAlgorithm: varchar("encryption_algorithm", { length: 20 }).default("aes-256-gcm").notNull(),
    encryptionKeyVersion: integer("encryption_key_version").default(1).notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 256 }).notNull(),
    status: notificationEmailStatusEnum("status").default("pending").notNull(),
    attempts: integer("attempts").default(0).notNull(),
    maxAttempts: integer("max_attempts").default(8).notNull(),
    availableAt: timestamp("available_at", { withTimezone: true }).defaultNow().notNull(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    claimToken: uuid("claim_token"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    providerMessageId: varchar("provider_message_id", { length: 255 }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("auth_email_outbox_auth_token_unique").on(table.authTokenId),
    uniqueIndex("auth_email_outbox_idempotency_unique").on(table.idempotencyKey),
    index("auth_email_outbox_due_idx").on(table.status, table.availableAt, table.claimedAt),
    check("auth_email_outbox_purpose_check", sql`${table.purpose} <> 'mfa_login'`),
    check("auth_email_outbox_cipher_check", sql`${table.encryptionAlgorithm} = 'aes-256-gcm'`),
    check("auth_email_outbox_key_version_check", sql`${table.encryptionKeyVersion} > 0`),
    check("auth_email_outbox_attempts_check", sql`${table.attempts} >= 0 and ${table.maxAttempts} > 0`),
    check(
      "auth_email_outbox_terminal_state_check",
      sql`(${table.status} = 'sent' and ${table.sentAt} is not null) or (${table.status} <> 'sent' and ${table.sentAt} is null)`,
    ),
    check(
      "auth_email_outbox_claim_state_check",
      sql`(${table.status} = 'processing' and ${table.claimedAt} is not null and ${table.claimToken} is not null) or (${table.status} <> 'processing' and ${table.claimedAt} is null and ${table.claimToken} is null)`,
    ),
  ],
);

export const userMfaFactors = pgTable(
  "user_mfa_factors",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    status: mfaStatusEnum("status").default("pending").notNull(),
    encryptedTotpSecret: text("encrypted_totp_secret").notNull(),
    initializationVector: varchar("initialization_vector", { length: 24 }).notNull(),
    authenticationTag: varchar("authentication_tag", { length: 24 }).notNull(),
    encryptionAlgorithm: varchar("encryption_algorithm", { length: 20 }).default("aes-256-gcm").notNull(),
    encryptionKeyVersion: integer("encryption_key_version").default(1).notNull(),
    lastUsedStep: integer("last_used_step"),
    enabledAt: timestamp("enabled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("user_mfa_factors_status_idx").on(table.status),
    check("user_mfa_factors_cipher_check", sql`${table.encryptionAlgorithm} = 'aes-256-gcm'`),
    check("user_mfa_factors_key_version_check", sql`${table.encryptionKeyVersion} > 0`),
    check(
      "user_mfa_factors_state_check",
      sql`(${table.status} = 'pending' and ${table.enabledAt} is null) or (${table.status} = 'enabled' and ${table.enabledAt} is not null)`,
    ),
    check("user_mfa_factors_last_step_check", sql`${table.lastUsedStep} is null or ${table.lastUsedStep} >= 0`),
  ],
);

export const mfaRecoveryCodes = pgTable(
  "mfa_recovery_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    codeHash: varchar("code_hash", { length: 64 }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("mfa_recovery_codes_user_hash_unique").on(table.userId, table.codeHash),
    index("mfa_recovery_codes_user_unused_idx").on(table.userId, table.usedAt),
    check("mfa_recovery_codes_hash_check", sql`${table.codeHash} ~ '^[a-f0-9]{64}$'`),
  ],
);

export const oauthLoginStates = pgTable(
  "oauth_login_states",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: oauthProviderEnum("provider").notNull(),
    stateHash: varchar("state_hash", { length: 64 }).notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    requestedIp: varchar("requested_ip", { length: 64 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("oauth_login_states_expiry_idx").on(table.expiresAt),
    check("oauth_login_states_hash_check", sql`${table.stateHash} ~ '^[a-f0-9]{64}$'`),
    check("oauth_login_states_expiry_check", sql`${table.expiresAt} > ${table.createdAt}`),
  ],
);

export const integrationOauthStates = pgTable(
  "integration_oauth_states",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: varchar("provider", { length: 50 }).notNull(),
    stateHash: varchar("state_hash", { length: 64 }).notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    requestedIp: varchar("requested_ip", { length: 64 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("integration_oauth_states_expiry_idx").on(table.expiresAt),
    check(
      "integration_oauth_states_provider_check",
      sql`${table.provider} in ('github', 'slack', 'gcal', 'microsoft')`,
    ),
    check("integration_oauth_states_hash_check", sql`${table.stateHash} ~ '^[a-f0-9]{64}$'`),
    check("integration_oauth_states_expiry_check", sql`${table.expiresAt} > ${table.createdAt}`),
  ],
);

export const oauthIdentities = pgTable(
  "oauth_identities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    provider: oauthProviderEnum("provider").notNull(),
    providerSubject: varchar("provider_subject", { length: 255 }).notNull(),
    email: varchar("email", { length: 255 }).notNull(),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("oauth_identities_provider_subject_unique").on(table.provider, table.providerSubject),
    uniqueIndex("oauth_identities_user_provider_unique").on(table.userId, table.provider),
    index("oauth_identities_email_idx").on(table.email),
  ],
);

export const securityEvents = pgTable(
  "security_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id"),
    eventType: securityEventTypeEnum("event_type").notNull(),
    outcome: securityEventOutcomeEnum("outcome").notNull(),
    emailHash: varchar("email_hash", { length: 64 }),
    sessionId: uuid("session_id"),
    provider: oauthProviderEnum("provider"),
    ip: varchar("ip", { length: 64 }),
    userAgent: varchar("user_agent", { length: 500 }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("security_events_user_created_idx").on(table.userId, table.createdAt),
    index("security_events_type_created_idx").on(table.eventType, table.createdAt),
    index("security_events_email_created_idx").on(table.emailHash, table.createdAt),
    check(
      "security_events_identity_check",
      sql`${table.userId} is not null or ${table.emailHash} is not null or ${table.sessionId} is not null or ${table.ip} is not null`,
    ),
    check("security_events_email_hash_check", sql`${table.emailHash} is null or ${table.emailHash} ~ '^[a-f0-9]{64}$'`),
  ],
);

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 255 }).notNull().unique(),
  ownerId: uuid("owner_id").references(() => users.id),
  plan: orgPlanEnum("plan").default("team").notNull(),
  seats: integer("seats").default(5).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  settings: jsonb("settings").$type<Record<string, any>>().default({}),
});

export const taskSerialSequences = pgTable(
  "task_serial_sequences",
  {
    organizationId: uuid("organization_id")
      .primaryKey()
      .references(() => organizations.id, { onDelete: "cascade" }),
    nextValue: integer("next_value").default(1041).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [check("task_serial_sequences_next_value_check", sql`${table.nextValue} >= 1041`)],
);

export const workspaces = pgTable(
  "workspaces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .references(() => organizations.id)
      .notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    slug: varchar("slug", { length: 255 }).notNull(),
    color: varchar("color", { length: 20 }).default("#7C3AED"),
    icon: varchar("icon", { length: 50 }).default("briefcase"),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("workspaces_organization_slug_unique").on(table.organizationId, table.slug),
    index("workspaces_organization_active_idx").on(table.organizationId, table.deletedAt),
  ],
);

export const teams = pgTable("teams", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .references(() => organizations.id)
    .notNull(),
  workspaceId: uuid("workspace_id")
    .references(() => workspaces.id)
    .notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  color: varchar("color", { length: 20 }).default("#0EA5E9"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .references(() => users.id)
      .notNull(),
    organizationId: uuid("organization_id")
      .references(() => organizations.id)
      .notNull(),
    workspaceId: uuid("workspace_id").references(() => workspaces.id),
    teamId: uuid("team_id").references(() => teams.id),
    role: userRoleEnum("role").default("member").notNull(),
    status: varchar("status", { length: 20 }).default("active"),
    joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("memberships_user_org_workspace_unique")
      .on(table.userId, table.organizationId, table.workspaceId)
      .where(sql`${table.workspaceId} is not null`),
    uniqueIndex("memberships_user_org_orgwide_unique")
      .on(table.userId, table.organizationId)
      .where(sql`${table.workspaceId} is null`),
    index("memberships_tenant_status_lookup").on(table.organizationId, table.workspaceId, table.status, table.userId),
  ],
);

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .references(() => organizations.id)
      .notNull(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id)
      .notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    color: varchar("color", { length: 20 }).default("#6366F1"),
    icon: varchar("icon", { length: 30 }).default("folder"),
    coverUrl: text("cover_url"),
    status: projectStatusEnum("status").default("active").notNull(),
    priority: taskPriorityEnum("priority").default("medium").notNull(),
    ownerId: uuid("owner_id").references(() => users.id),
    managerId: uuid("manager_id").references(() => users.id),
    startDate: timestamp("start_date", { withTimezone: true }),
    endDate: timestamp("end_date", { withTimezone: true }),
    privacy: varchar("privacy", { length: 30 }).default("workspace").notNull(),
    template: varchar("template", { length: 30 }).default("default").notNull(),
    progress: integer("progress").default(0).notNull(),
    budget: doublePrecision("budget"),
    estimatedHours: doublePrecision("estimated_hours"),
    loggedHours: doublePrecision("logged_hours").default(0).notNull(),
    version: integer("version").default(1).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("projects_tenant_active_created_idx").on(
      table.organizationId,
      table.workspaceId,
      table.deletedAt,
      table.createdAt,
    ),
    index("projects_tenant_manager_active_idx").on(
      table.organizationId,
      table.workspaceId,
      table.managerId,
      table.deletedAt,
    ),
    check("projects_progress_check", sql`${table.progress} between 0 and 100`),
    check("projects_budget_check", sql`${table.budget} is null or ${table.budget} >= 0`),
    check("projects_estimated_hours_check", sql`${table.estimatedHours} is null or ${table.estimatedHours} >= 0`),
    check("projects_logged_hours_check", sql`${table.loggedHours} >= 0`),
    check(
      "projects_date_range_check",
      sql`${table.startDate} is null or ${table.endDate} is null or ${table.endDate} >= ${table.startDate}`,
    ),
    check("projects_version_check", sql`${table.version} >= 1`),
    check(
      "projects_privacy_check",
      sql`${table.privacy} in ('workspace', 'private', 'private-members', 'guest-share', 'archived')`,
    ),
  ],
);

export const projectSections = pgTable("project_sections", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .references(() => organizations.id)
    .notNull(),
  workspaceId: uuid("workspace_id")
    .references(() => workspaces.id)
    .notNull(),
  projectId: uuid("project_id")
    .references(() => projects.id)
    .notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  order: doublePrecision("order").default(0).notNull(),
  color: varchar("color", { length: 20 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const projectWipLimits = pgTable(
  "project_wip_limits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    projectId: uuid("project_id")
      .references(() => projects.id, { onDelete: "cascade" })
      .notNull(),
    status: taskStatusEnum("status").notNull(),
    limit: integer("limit").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("project_wip_limits_project_status_unique").on(table.projectId, table.status),
    index("project_wip_limits_tenant_project_idx").on(table.organizationId, table.workspaceId, table.projectId),
    check("project_wip_limits_limit_check", sql`${table.limit} between 1 and 100000`),
  ],
);

export const projectBaselines = pgTable(
  "project_baselines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    projectId: uuid("project_id")
      .references(() => projects.id, { onDelete: "cascade" })
      .notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    taskCount: integer("task_count").notNull(),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("project_baselines_tenant_project_created_idx").on(
      table.organizationId,
      table.workspaceId,
      table.projectId,
      table.createdAt,
    ),
    check("project_baselines_task_count_check", sql`${table.taskCount} >= 0`),
  ],
);

export const projectBaselineTasks = pgTable(
  "project_baseline_tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    projectId: uuid("project_id")
      .references(() => projects.id, { onDelete: "cascade" })
      .notNull(),
    baselineId: uuid("baseline_id")
      .references(() => projectBaselines.id, { onDelete: "cascade" })
      .notNull(),
    sourceTaskId: uuid("source_task_id").notNull(),
    serial: varchar("serial", { length: 20 }).notNull(),
    title: varchar("title", { length: 500 }).notNull(),
    startDate: timestamp("start_date", { withTimezone: true }),
    dueDate: timestamp("due_date", { withTimezone: true }),
    isMilestone: boolean("is_milestone").default(false).notNull(),
    taskVersion: integer("task_version").notNull(),
  },
  (table) => [
    uniqueIndex("project_baseline_tasks_source_unique").on(table.baselineId, table.sourceTaskId),
    index("project_baseline_tasks_tenant_baseline_idx").on(table.organizationId, table.workspaceId, table.baselineId),
    check("project_baseline_tasks_version_check", sql`${table.taskVersion} >= 1`),
  ],
);

export const workloadCapacities = pgTable(
  "workload_capacities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    weeklyMinutes: integer("weekly_minutes").default(2400).notNull(),
    workdayMask: integer("workday_mask").default(62).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("workload_capacities_workspace_user_unique").on(table.organizationId, table.workspaceId, table.userId),
    index("workload_capacities_tenant_user_idx").on(table.organizationId, table.workspaceId, table.userId),
    check("workload_capacities_weekly_minutes_check", sql`${table.weeklyMinutes} between 0 and 10080`),
    check("workload_capacities_workday_mask_check", sql`${table.workdayMask} between 0 and 127`),
  ],
);

export const workloadTimeOff = pgTable(
  "workload_time_off",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    kind: workloadTimeOffKindEnum("kind").notNull(),
    status: workloadTimeOffStatusEnum("status").default("approved").notNull(),
    startsOn: date("starts_on").notNull(),
    endsOn: date("ends_on").notNull(),
    minutesPerDay: integer("minutes_per_day"),
    note: varchar("note", { length: 500 }),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("workload_time_off_tenant_range_idx").on(
      table.organizationId,
      table.workspaceId,
      table.startsOn,
      table.endsOn,
    ),
    index("workload_time_off_tenant_user_idx").on(table.organizationId, table.workspaceId, table.userId),
    check("workload_time_off_range_check", sql`${table.endsOn} >= ${table.startsOn}`),
    check(
      "workload_time_off_minutes_check",
      sql`${table.minutesPerDay} is null or ${table.minutesPerDay} between 1 and 1440`,
    ),
    check(
      "workload_time_off_target_check",
      sql`(${table.kind} = 'public_holiday' and ${table.userId} is null) or (${table.kind} <> 'public_holiday' and ${table.userId} is not null)`,
    ),
  ],
);

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .references(() => organizations.id)
      .notNull(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id)
      .notNull(),
    projectId: uuid("project_id")
      .references(() => projects.id)
      .notNull(),
    sectionId: uuid("section_id").references(() => projectSections.id),
    parentId: uuid("parent_id"),
    serial: varchar("serial", { length: 20 }).notNull(),
    title: varchar("title", { length: 500 }).notNull(),
    description: text("description"),
    status: taskStatusEnum("status").default("todo").notNull(),
    priority: taskPriorityEnum("priority").default("medium").notNull(),
    assigneeId: uuid("assignee_id").references(() => users.id),
    reporterId: uuid("reporter_id").references(() => users.id),
    dueDate: timestamp("due_date", { withTimezone: true }),
    startDate: timestamp("start_date", { withTimezone: true }),
    timezone: varchar("timezone", { length: 100 }).default("UTC").notNull(),
    estimatedHours: doublePrecision("estimated_hours"),
    loggedHours: doublePrecision("logged_hours").default(0).notNull(),
    progress: integer("progress").default(0).notNull(),
    order: doublePrecision("order").default(0).notNull(),
    tags: jsonb("tags").$type<string[]>().default([]),
    customFields: jsonb("custom_fields").$type<Record<string, any>>().default({}),
    isMilestone: boolean("is_milestone").default(false).notNull(),
    isRecurring: boolean("is_recurring").default(false),
    storyPoints: integer("story_points"),
    delayReason: text("delay_reason"),
    version: integer("version").default(1).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("tasks_organization_serial_unique").on(table.organizationId, table.serial),
    index("tasks_tenant_project_active_order_idx").on(
      table.organizationId,
      table.workspaceId,
      table.projectId,
      table.deletedAt,
      table.order,
    ),
    index("tasks_tenant_project_active_created_idx").on(
      table.organizationId,
      table.workspaceId,
      table.projectId,
      table.deletedAt,
      table.createdAt,
      table.id,
    ),
    index("tasks_tenant_project_active_title_idx").on(
      table.organizationId,
      table.workspaceId,
      table.projectId,
      table.deletedAt,
      table.title,
      table.id,
    ),
    index("tasks_tenant_project_status_active_order_idx").on(
      table.organizationId,
      table.workspaceId,
      table.projectId,
      table.status,
      table.deletedAt,
      table.order,
      table.id,
    ),
    index("tasks_tenant_active_updated_idx")
      .on(table.organizationId, table.workspaceId, table.updatedAt.desc().nullsLast(), table.id.desc())
      .where(sql`${table.deletedAt} is null and ${table.parentId} is null`),
    index("tasks_tenant_active_parent_idx")
      .on(table.organizationId, table.workspaceId, table.parentId)
      .where(sql`${table.deletedAt} is null and ${table.parentId} is not null`),
    index("tasks_tenant_assignee_status_idx").on(
      table.organizationId,
      table.workspaceId,
      table.assigneeId,
      table.status,
    ),
    check("tasks_progress_check", sql`${table.progress} between 0 and 100`),
    check("tasks_estimated_hours_check", sql`${table.estimatedHours} is null or ${table.estimatedHours} >= 0`),
    check("tasks_logged_hours_check", sql`${table.loggedHours} >= 0`),
    check("tasks_story_points_check", sql`${table.storyPoints} is null or ${table.storyPoints} >= 0`),
    check(
      "tasks_milestone_dates_check",
      sql`${table.isMilestone} = false or (${table.startDate} is not null and ${table.dueDate} = ${table.startDate})`,
    ),
    check(
      "tasks_date_range_check",
      sql`${table.startDate} is null or ${table.dueDate} is null or ${table.dueDate} >= ${table.startDate}`,
    ),
    check("tasks_version_check", sql`${table.version} >= 1`),
  ],
);

export const comments = pgTable(
  "comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .references(() => organizations.id)
      .notNull(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id)
      .notNull(),
    taskId: uuid("task_id")
      .references(() => tasks.id)
      .notNull(),
    userId: uuid("user_id")
      .references(() => users.id)
      .notNull(),
    content: text("content").notNull(),
    parentId: uuid("parent_id"),
    reactions: jsonb("reactions").$type<Record<string, string[]>>().default({}),
    isPinned: boolean("is_pinned").default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("comments_tenant_task_active_created_idx").on(
      table.organizationId,
      table.workspaceId,
      table.taskId,
      table.deletedAt,
      table.createdAt,
    ),
  ],
);

export const attachments = pgTable(
  "attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .references(() => organizations.id)
      .notNull(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id)
      .notNull(),
    taskId: uuid("task_id").references(() => tasks.id),
    projectId: uuid("project_id").references(() => projects.id),
    uploaderId: uuid("uploader_id")
      .references(() => users.id)
      .notNull(),
    fileName: varchar("file_name", { length: 255 }).notNull(),
    fileSize: integer("file_size").notNull(),
    mimeType: varchar("mime_type", { length: 100 }),
    url: text("url").notNull(),
    scanStatus: varchar("scan_status", { length: 20 }).default("pending").notNull(),
    scanEngine: varchar("scan_engine", { length: 100 }),
    scanSignature: varchar("scan_signature", { length: 255 }),
    scannedAt: timestamp("scanned_at", { withTimezone: true }),
    previewStatus: varchar("preview_status", { length: 20 }).default("pending").notNull(),
    previewReference: text("preview_reference"),
    previewMimeType: varchar("preview_mime_type", { length: 100 }),
    previewWidth: integer("preview_width"),
    previewHeight: integer("preview_height"),
    cleanupClaimedAt: timestamp("cleanup_claimed_at", { withTimezone: true }),
    cleanupAttempts: integer("cleanup_attempts").default(0).notNull(),
    cleanupError: text("cleanup_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("attachments_tenant_task_active_idx").on(
      table.organizationId,
      table.workspaceId,
      table.taskId,
      table.deletedAt,
    ),
    index("attachments_tenant_project_active_idx").on(
      table.organizationId,
      table.workspaceId,
      table.projectId,
      table.deletedAt,
    ),
    index("attachments_tenant_scan_status_idx").on(
      table.organizationId,
      table.workspaceId,
      table.scanStatus,
      table.createdAt,
    ),
    index("attachments_cleanup_candidates_idx").on(
      table.cleanupClaimedAt,
      table.cleanupAttempts,
      table.scanStatus,
      table.updatedAt,
    ),
    check("attachments_scan_status_check", sql`${table.scanStatus} in ('pending', 'clean', 'infected', 'failed')`),
    check(
      "attachments_preview_status_check",
      sql`${table.previewStatus} in ('pending', 'ready', 'source', 'unsupported', 'failed')`,
    ),
    check("attachments_cleanup_attempts_check", sql`${table.cleanupAttempts} >= 0`),
  ],
);

export const docs = pgTable(
  "docs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .references(() => organizations.id)
      .notNull(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id)
      .notNull(),
    projectId: uuid("project_id").references(() => projects.id),
    parentId: uuid("parent_id").references((): AnyPgColumn => docs.id, { onDelete: "restrict" }),
    title: varchar("title", { length: 500 }).notNull(),
    content: text("content"),
    authorId: uuid("author_id")
      .references(() => users.id)
      .notNull(),
    icon: varchar("icon", { length: 50 }).default("file-text"),
    isPublic: boolean("is_public").default(false).notNull(),
    workspaceAccess: documentWorkspaceAccessEnum("workspace_access").default("viewer").notNull(),
    inheritPermissions: boolean("inherit_permissions").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("docs_tenant_active_updated_idx").on(
      table.organizationId,
      table.workspaceId,
      table.deletedAt,
      table.updatedAt,
    ),
    index("docs_tenant_parent_active_idx").on(table.organizationId, table.workspaceId, table.parentId, table.deletedAt),
    check("docs_parent_not_self_check", sql`${table.parentId} is null or ${table.parentId} <> ${table.id}`),
  ],
);

export const goals = pgTable(
  "goals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .references(() => organizations.id)
      .notNull(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id)
      .notNull(),
    title: varchar("title", { length: 500 }).notNull(),
    description: text("description"),
    type: varchar("type", { length: 50 }).default("objective").notNull(),
    parentId: uuid("parent_id").references((): AnyPgColumn => goals.id, { onDelete: "restrict" }),
    progress: integer("progress").default(0).notNull(),
    status: varchar("status", { length: 20 }).default("off_track").notNull(),
    progressMode: varchar("progress_mode", { length: 20 }).default("manual").notNull(),
    measurementUnit: varchar("measurement_unit", { length: 20 }).default("percentage").notNull(),
    startValue: doublePrecision("start_value").default(0).notNull(),
    currentValue: doublePrecision("current_value").default(0).notNull(),
    targetValue: doublePrecision("target_value").default(100).notNull(),
    weight: doublePrecision("weight").default(1).notNull(),
    ownerId: uuid("owner_id").references(() => users.id),
    checkins: jsonb("checkins")
      .$type<Array<{ id: string; progress: number; note: string; date: string; author?: string }>>()
      .default([]),
    periodStart: timestamp("period_start", { withTimezone: true }),
    periodEnd: timestamp("period_end", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("goals_tenant_parent_active_idx").on(
      table.organizationId,
      table.workspaceId,
      table.parentId,
      table.deletedAt,
    ),
    index("goals_tenant_owner_period_idx").on(
      table.organizationId,
      table.workspaceId,
      table.ownerId,
      table.periodStart,
      table.periodEnd,
    ),
    check("goals_type_check", sql`${table.type} in ('objective', 'key_result')`),
    check("goals_progress_check", sql`${table.progress} between 0 and 100`),
    check("goals_status_check", sql`${table.status} in ('on_track', 'at_risk', 'off_track', 'achieved')`),
    check("goals_progress_mode_check", sql`${table.progressMode} in ('manual', 'measurement', 'tasks', 'children')`),
    check(
      "goals_measurement_unit_check",
      sql`${table.measurementUnit} in ('percentage', 'number', 'currency', 'boolean')`,
    ),
    check("goals_weight_check", sql`${table.weight} > 0 and ${table.weight} <= 100`),
    check("goals_parent_not_self_check", sql`${table.parentId} is null or ${table.parentId} <> ${table.id}`),
    check(
      "goals_period_check",
      sql`${table.periodStart} is null or ${table.periodEnd} is null or ${table.periodEnd} >= ${table.periodStart}`,
    ),
    check(
      "goals_measurement_range_check",
      sql`${table.progressMode} <> 'measurement' or ${table.targetValue} <> ${table.startValue}`,
    ),
  ],
);

export const goalTaskLinks = pgTable(
  "goal_task_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    goalId: uuid("goal_id")
      .references(() => goals.id, { onDelete: "cascade" })
      .notNull(),
    taskId: uuid("task_id")
      .references(() => tasks.id, { onDelete: "cascade" })
      .notNull(),
    weight: doublePrecision("weight").default(1).notNull(),
    createdById: uuid("created_by_id")
      .references(() => users.id)
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("goal_task_links_goal_task_unique").on(table.goalId, table.taskId),
    index("goal_task_links_tenant_task_idx").on(table.organizationId, table.workspaceId, table.taskId, table.goalId),
    check("goal_task_links_weight_check", sql`${table.weight} > 0 and ${table.weight} <= 100`),
  ],
);

export const goalCheckins = pgTable(
  "goal_checkins",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    goalId: uuid("goal_id")
      .references(() => goals.id, { onDelete: "cascade" })
      .notNull(),
    progress: integer("progress").notNull(),
    currentValue: doublePrecision("current_value"),
    status: varchar("status", { length: 20 }).notNull(),
    note: varchar("note", { length: 2000 }).notNull(),
    createdById: uuid("created_by_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("goal_checkins_tenant_goal_created_idx").on(
      table.organizationId,
      table.workspaceId,
      table.goalId,
      table.createdAt,
    ),
    check("goal_checkins_progress_check", sql`${table.progress} between 0 and 100`),
    check("goal_checkins_status_check", sql`${table.status} in ('on_track', 'at_risk', 'off_track', 'achieved')`),
  ],
);

export const timesheets = pgTable(
  "timesheets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .references(() => organizations.id)
      .notNull(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id)
      .notNull(),
    userId: uuid("user_id")
      .references(() => users.id)
      .notNull(),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    status: varchar("status", { length: 20 }).default("draft").notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    reviewedById: uuid("reviewed_by_id").references(() => users.id),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    rejectionReason: text("rejection_reason"),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    version: integer("version").default(1).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("timesheets_tenant_user_period_unique").on(
      table.organizationId,
      table.workspaceId,
      table.userId,
      table.periodStart,
      table.periodEnd,
    ),
    index("timesheets_tenant_review_queue_idx").on(
      table.organizationId,
      table.workspaceId,
      table.status,
      table.periodStart,
    ),
    check("timesheets_period_check", sql`${table.periodEnd} >= ${table.periodStart}`),
    check("timesheets_period_length_check", sql`${table.periodEnd} - ${table.periodStart} between 0 and 30`),
    check("timesheets_status_check", sql`${table.status} in ('draft', 'submitted', 'approved', 'rejected')`),
    check("timesheets_version_check", sql`${table.version} >= 1`),
    check("timesheets_submission_state_check", sql`${table.status} = 'draft' or ${table.submittedAt} is not null`),
    check(
      "timesheets_review_state_check",
      sql`${table.status} not in ('approved', 'rejected') or (${table.reviewedById} is not null and ${table.reviewedAt} is not null)`,
    ),
    check("timesheets_lock_state_check", sql`${table.status} = 'approved' or ${table.lockedAt} is null`),
    check("timesheets_approved_lock_check", sql`${table.status} <> 'approved' or ${table.lockedAt} is not null`),
  ],
);

export const timeLogs = pgTable(
  "time_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .references(() => organizations.id)
      .notNull(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id)
      .notNull(),
    timesheetId: uuid("timesheet_id")
      .references(() => timesheets.id, { onDelete: "restrict" })
      .notNull(),
    taskId: uuid("task_id")
      .references(() => tasks.id)
      .notNull(),
    userId: uuid("user_id")
      .references(() => users.id)
      .notNull(),
    description: text("description"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }).notNull(),
    durationMinutes: integer("duration_minutes").notNull(),
    billable: boolean("billable").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("time_logs_tenant_user_started_idx").on(
      table.organizationId,
      table.workspaceId,
      table.userId,
      table.startedAt,
    ),
    index("time_logs_timesheet_active_idx").on(table.timesheetId, table.deletedAt, table.startedAt),
    check("time_logs_duration_check", sql`${table.durationMinutes} > 0 and ${table.durationMinutes} <= 1440`),
    check("time_logs_range_check", sql`${table.endedAt} >= ${table.startedAt}`),
  ],
);

export const automations = pgTable(
  "automations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .references(() => organizations.id)
      .notNull(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id)
      .notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    trigger: varchar("trigger", { length: 100 }).notNull(),
    conditions: jsonb("conditions").$type<any>().default({}),
    actions: jsonb("actions").$type<any>().default({}),
    enabled: boolean("enabled").default(true),
    runs: integer("runs").default(0),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("automations_tenant_active_trigger_idx").on(
      table.organizationId,
      table.workspaceId,
      table.deletedAt,
      table.enabled,
      table.trigger,
    ),
  ],
);

export const forms = pgTable(
  "forms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .references(() => organizations.id)
      .notNull(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id)
      .notNull(),
    projectId: uuid("project_id").references(() => projects.id),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    fields: jsonb("fields").$type<FormFieldDefinition[]>().default([]).notNull(),
    settings: jsonb("settings")
      .$type<FormSettings>()
      .default({
        schemaVersion: 1,
        createTask: true,
        status: "todo",
        priority: "medium",
        captchaEnabled: true,
      })
      .notNull(),
    responses: integer("responses").default(0).notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("forms_tenant_active_created_idx").on(
      table.organizationId,
      table.workspaceId,
      table.deletedAt,
      table.isActive,
      table.createdAt,
    ),
    check("forms_fields_array_check", sql`jsonb_typeof(${table.fields}) = 'array'`),
    check(
      "forms_settings_version_check",
      sql`jsonb_typeof(${table.settings}) = 'object' and ${table.settings}->>'schemaVersion' = '1'`,
    ),
    check("forms_responses_nonnegative_check", sql`${table.responses} >= 0`),
  ],
);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .references(() => organizations.id)
      .notNull(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id)
      .notNull(),
    userId: uuid("user_id")
      .references(() => users.id)
      .notNull(),
    type: varchar("type", { length: 100 }).notNull(),
    title: varchar("title", { length: 500 }).notNull(),
    body: text("body"),
    entityType: varchar("entity_type", { length: 50 }),
    entityId: uuid("entity_id"),
    isRead: boolean("is_read").default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("notifications_tenant_user_created_idx").on(
      table.organizationId,
      table.workspaceId,
      table.userId,
      table.createdAt,
    ),
  ],
);

export const notificationEmailOutbox = pgTable(
  "notification_email_outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    notificationId: uuid("notification_id").references(() => notifications.id, { onDelete: "set null" }),
    subject: varchar("subject", { length: 500 }).notNull(),
    body: text("body"),
    attachmentObjectKey: text("attachment_object_key"),
    attachmentFileName: varchar("attachment_file_name", { length: 255 }),
    attachmentContentType: varchar("attachment_content_type", { length: 100 }),
    idempotencyKey: varchar("idempotency_key", { length: 256 }).notNull(),
    status: notificationEmailStatusEnum("status").default("pending").notNull(),
    attempts: integer("attempts").default(0).notNull(),
    maxAttempts: integer("max_attempts").default(8).notNull(),
    availableAt: timestamp("available_at", { withTimezone: true }).defaultNow().notNull(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    claimToken: uuid("claim_token"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    providerMessageId: varchar("provider_message_id", { length: 255 }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("notification_email_outbox_idempotency_unique").on(table.idempotencyKey),
    index("notification_email_outbox_tenant_status_idx").on(
      table.organizationId,
      table.workspaceId,
      table.status,
      table.availableAt,
    ),
    index("notification_email_outbox_due_idx").on(table.status, table.availableAt, table.claimedAt),
    check("notification_email_outbox_attempts_check", sql`${table.attempts} >= 0 and ${table.maxAttempts} > 0`),
    check(
      "notification_email_outbox_attachment_check",
      sql`(${table.attachmentObjectKey} is null and ${table.attachmentFileName} is null and ${table.attachmentContentType} is null) or (${table.attachmentObjectKey} is not null and ${table.attachmentFileName} is not null and ${table.attachmentContentType} is not null)`,
    ),
    check(
      "notification_email_outbox_terminal_state_check",
      sql`(${table.status} = 'sent' and ${table.sentAt} is not null) or (${table.status} <> 'sent' and ${table.sentAt} is null)`,
    ),
    check(
      "notification_email_outbox_claim_state_check",
      sql`(${table.status} = 'processing' and ${table.claimedAt} is not null and ${table.claimToken} is not null) or (${table.status} <> 'processing' and ${table.claimedAt} is null and ${table.claimToken} is null)`,
    ),
  ],
);

export const reportSchedules = pgTable(
  "report_schedules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    createdBy: uuid("created_by")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    format: varchar("format", { length: 20 }).$type<ScheduledReportFormat>().notNull(),
    cadence: varchar("cadence", { length: 20 }).$type<ReportScheduleCadence>().notNull(),
    timezone: varchar("timezone", { length: 100 }).default("UTC").notNull(),
    minuteOfDay: integer("minute_of_day").default(480).notNull(),
    dayOfWeek: integer("day_of_week"),
    dayOfMonth: integer("day_of_month"),
    isEnabled: boolean("is_enabled").default(true).notNull(),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }).notNull(),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    version: integer("version").default(1).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("report_schedules_due_idx").on(table.isEnabled, table.nextRunAt),
    index("report_schedules_tenant_idx").on(table.organizationId, table.workspaceId, table.createdAt),
    check("report_schedules_format_check", sql`${table.format} in ('pdf', 'xlsx')`),
    check("report_schedules_cadence_check", sql`${table.cadence} in ('daily', 'weekly', 'monthly')`),
    check("report_schedules_minute_check", sql`${table.minuteOfDay} between 0 and 1439`),
    check("report_schedules_weekday_check", sql`${table.dayOfWeek} is null or ${table.dayOfWeek} between 0 and 6`),
    check("report_schedules_monthday_check", sql`${table.dayOfMonth} is null or ${table.dayOfMonth} between 1 and 28`),
    check(
      "report_schedules_cadence_fields_check",
      sql`(${table.cadence} = 'daily' and ${table.dayOfWeek} is null and ${table.dayOfMonth} is null) or (${table.cadence} = 'weekly' and ${table.dayOfWeek} is not null and ${table.dayOfMonth} is null) or (${table.cadence} = 'monthly' and ${table.dayOfWeek} is null and ${table.dayOfMonth} is not null)`,
    ),
    check("report_schedules_version_check", sql`${table.version} > 0`),
  ],
);

export const reportScheduleRecipients = pgTable(
  "report_schedule_recipients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    scheduleId: uuid("schedule_id")
      .references(() => reportSchedules.id, { onDelete: "cascade" })
      .notNull(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("report_schedule_recipients_schedule_user_unique").on(table.scheduleId, table.userId),
    index("report_schedule_recipients_tenant_user_idx").on(table.organizationId, table.workspaceId, table.userId),
  ],
);

export const automationRuns = pgTable(
  "automation_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .references(() => organizations.id)
      .notNull(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id)
      .notNull(),
    automationId: uuid("automation_id")
      .references(() => automations.id)
      .notNull(),
    eventId: uuid("event_id"),
    taskId: uuid("task_id"),
    status: varchar("status", { length: 20 }).notNull(),
    attempt: integer("attempt").default(1).notNull(),
    message: text("message"),
    durationMs: integer("duration_ms").default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("automation_runs_event_rule_unique").on(table.eventId, table.automationId),
    index("automation_runs_tenant_event_idx").on(table.organizationId, table.workspaceId, table.eventId),
    check("automation_runs_attempt_check", sql`${table.attempt} > 0`),
  ],
);

export const automationEvents = pgTable(
  "automation_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    taskId: uuid("task_id")
      .references(() => tasks.id, { onDelete: "cascade" })
      .notNull(),
    trigger: varchar("trigger", { length: 100 }).notNull(),
    taskVersion: integer("task_version").notNull(),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    previous: jsonb("previous").$type<Record<string, unknown> | null>(),
    current: jsonb("current").$type<Record<string, unknown>>().notNull(),
    depth: integer("depth").default(0).notNull(),
    parentEventId: uuid("parent_event_id"),
    deduplicationKey: varchar("deduplication_key", { length: 256 }).notNull(),
    status: notificationEmailStatusEnum("status").default("pending").notNull(),
    attempts: integer("attempts").default(0).notNull(),
    maxAttempts: integer("max_attempts").default(8).notNull(),
    availableAt: timestamp("available_at", { withTimezone: true }).defaultNow().notNull(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    claimToken: uuid("claim_token"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("automation_events_deduplication_unique").on(table.deduplicationKey),
    index("automation_events_tenant_status_idx").on(
      table.organizationId,
      table.workspaceId,
      table.status,
      table.availableAt,
    ),
    index("automation_events_due_idx").on(table.status, table.availableAt, table.claimedAt),
    check(
      "automation_events_trigger_check",
      sql`${table.trigger} in ('task_created', 'task_status_changed', 'task_assignee_changed', 'task_priority_changed', 'comment_added', 'schedule_daily')`,
    ),
    check("automation_events_depth_check", sql`${table.depth} between 0 and 5`),
    check("automation_events_attempts_check", sql`${table.attempts} >= 0 and ${table.maxAttempts} > 0`),
    check(
      "automation_events_terminal_state_check",
      sql`(${table.status} in ('sent', 'skipped') and ${table.completedAt} is not null) or (${table.status} not in ('sent', 'skipped') and ${table.completedAt} is null)`,
    ),
    check(
      "automation_events_claim_state_check",
      sql`(${table.status} = 'processing' and ${table.claimedAt} is not null and ${table.claimToken} is not null) or (${table.status} <> 'processing' and ${table.claimedAt} is null and ${table.claimToken} is null)`,
    ),
  ],
);

export const exportJobs = pgTable(
  "export_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    requestedBy: uuid("requested_by")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    reportScheduleId: uuid("report_schedule_id").references(() => reportSchedules.id, { onDelete: "set null" }),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
    format: varchar("format", { length: 20 }).$type<WorkspaceExportFormat>().default("json").notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 256 }).notNull(),
    status: exportJobStatusEnum("status").default("pending").notNull(),
    attempts: integer("attempts").default(0).notNull(),
    maxAttempts: integer("max_attempts").default(5).notNull(),
    availableAt: timestamp("available_at", { withTimezone: true }).defaultNow().notNull(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    claimToken: uuid("claim_token"),
    objectKey: text("object_key"),
    fileName: varchar("file_name", { length: 255 }),
    contentType: varchar("content_type", { length: 100 }),
    fileSize: bigint("file_size", { mode: "number" }),
    checksumSha256: varchar("checksum_sha256", { length: 64 }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("export_jobs_idempotency_unique").on(table.idempotencyKey),
    uniqueIndex("export_jobs_schedule_occurrence_unique")
      .on(table.reportScheduleId, table.scheduledFor)
      .where(sql`${table.reportScheduleId} is not null and ${table.scheduledFor} is not null`),
    index("export_jobs_tenant_requester_idx").on(
      table.organizationId,
      table.workspaceId,
      table.requestedBy,
      table.createdAt,
    ),
    index("export_jobs_due_idx").on(table.status, table.availableAt, table.claimedAt),
    check("export_jobs_format_check", sql`${table.format} in ('json', 'pdf', 'xlsx')`),
    check(
      "export_jobs_schedule_fields_check",
      sql`(${table.reportScheduleId} is null and ${table.scheduledFor} is null) or (${table.reportScheduleId} is not null and ${table.scheduledFor} is not null and ${table.format} in ('pdf', 'xlsx'))`,
    ),
    check("export_jobs_attempts_check", sql`${table.attempts} >= 0 and ${table.maxAttempts} > 0`),
    check(
      "export_jobs_claim_state_check",
      sql`(${table.status} = 'processing' and ${table.claimedAt} is not null and ${table.claimToken} is not null) or (${table.status} <> 'processing' and ${table.claimedAt} is null and ${table.claimToken} is null)`,
    ),
    check(
      "export_jobs_result_state_check",
      sql`(${table.status} in ('completed', 'expired') and ${table.objectKey} is not null and ${table.fileName} is not null and ${table.contentType} is not null and ${table.fileSize} is not null and ${table.checksumSha256} is not null and ${table.completedAt} is not null and ${table.expiresAt} is not null) or (${table.status} not in ('completed', 'expired') and ${table.objectKey} is null and ${table.fileName} is null and ${table.contentType} is null and ${table.fileSize} is null and ${table.checksumSha256} is null and ${table.completedAt} is null and ${table.expiresAt} is null)`,
    ),
  ],
);

export const savedViews = pgTable(
  "saved_views",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .references(() => organizations.id)
      .notNull(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id)
      .notNull(),
    projectId: uuid("project_id").references(() => projects.id),
    name: varchar("name", { length: 255 }).notNull(),
    viewType: varchar("view_type", { length: 30 }).default("board").notNull(),
    filters: jsonb("filters").$type<Record<string, unknown>>().default({}).notNull(),
    configuration: jsonb("configuration").$type<Record<string, unknown>>().default({ schemaVersion: 1 }).notNull(),
    isShared: boolean("is_shared").default(false).notNull(),
    isDefault: boolean("is_default").default(false).notNull(),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("saved_views_tenant_project_visible_idx").on(
      table.organizationId,
      table.workspaceId,
      table.projectId,
      table.isShared,
      table.createdBy,
    ),
    uniqueIndex("saved_views_creator_project_default_unique")
      .on(table.organizationId, table.workspaceId, table.projectId, table.createdBy)
      .where(
        sql`${table.isDefault} = true and ${table.deletedAt} is null and ${table.projectId} is not null and ${table.createdBy} is not null`,
      ),
    check(
      "saved_views_view_type_check",
      sql`${table.viewType} in ('board', 'list', 'table', 'calendar', 'timeline', 'workload')`,
    ),
    check("saved_views_filters_object_check", sql`jsonb_typeof(${table.filters}) = 'object'`),
    check(
      "saved_views_configuration_version_check",
      sql`jsonb_typeof(${table.configuration}) = 'object' and ${table.configuration}->>'schemaVersion' = '1'`,
    ),
    check(
      "saved_views_default_scope_check",
      sql`${table.isDefault} = false or (${table.projectId} is not null and ${table.createdBy} is not null)`,
    ),
  ],
);

export const dashboardLayouts = pgTable(
  "dashboard_layouts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    widgets: jsonb("widgets").$type<DashboardWidgetDefinition[]>().default([]).notNull(),
    version: integer("version").default(1).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("dashboard_layouts_user_workspace_unique").on(table.organizationId, table.workspaceId, table.userId),
    index("dashboard_layouts_tenant_updated_idx").on(table.organizationId, table.workspaceId, table.updatedAt),
    check("dashboard_layouts_widgets_array_check", sql`jsonb_typeof(${table.widgets}) = 'array'`),
    check("dashboard_layouts_version_positive_check", sql`${table.version} > 0`),
  ],
);

export const formResponses = pgTable(
  "form_responses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .references(() => organizations.id)
      .notNull(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id)
      .notNull(),
    formId: uuid("form_id")
      .references(() => forms.id)
      .notNull(),
    data: jsonb("data").$type<Record<string, string>>().default({}).notNull(),
    createdTaskId: uuid("created_task_id").references(() => tasks.id),
    taskCreationPayload: jsonb("task_creation_payload").$type<FormTaskCreationPayload>(),
    taskCreationStatus: varchar("task_creation_status", { length: 20 })
      .$type<FormTaskCreationStatus>()
      .default("not_requested")
      .notNull(),
    taskCreationAttempts: integer("task_creation_attempts").default(0).notNull(),
    taskCreationMaxAttempts: integer("task_creation_max_attempts").default(5).notNull(),
    taskCreationAvailableAt: timestamp("task_creation_available_at", { withTimezone: true }).defaultNow().notNull(),
    taskCreationClaimedAt: timestamp("task_creation_claimed_at", { withTimezone: true }),
    taskCreationClaimToken: uuid("task_creation_claim_token"),
    taskCreationLastError: text("task_creation_last_error"),
    taskCreationCompletedAt: timestamp("task_creation_completed_at", { withTimezone: true }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("form_responses_tenant_form_submitted_idx").on(
      table.organizationId,
      table.workspaceId,
      table.formId,
      table.submittedAt,
    ),
    index("form_responses_task_creation_due_idx").on(
      table.taskCreationStatus,
      table.taskCreationAvailableAt,
      table.taskCreationClaimedAt,
    ),
    check("form_responses_data_object_check", sql`jsonb_typeof(${table.data}) = 'object'`),
    check(
      "form_responses_task_creation_status_check",
      sql`${table.taskCreationStatus} in ('not_requested', 'pending', 'processing', 'completed', 'dead')`,
    ),
    check(
      "form_responses_task_creation_attempts_check",
      sql`${table.taskCreationAttempts} >= 0 and ${table.taskCreationMaxAttempts} > 0`,
    ),
    check(
      "form_responses_task_creation_request_check",
      sql`(${table.taskCreationStatus} = 'not_requested' and ${table.taskCreationPayload} is null) or (${table.taskCreationStatus} <> 'not_requested' and ${table.taskCreationPayload} is not null)`,
    ),
    check(
      "form_responses_task_creation_claim_check",
      sql`(${table.taskCreationStatus} = 'processing' and ${table.taskCreationClaimedAt} is not null and ${table.taskCreationClaimToken} is not null) or (${table.taskCreationStatus} <> 'processing' and ${table.taskCreationClaimedAt} is null and ${table.taskCreationClaimToken} is null)`,
    ),
    check(
      "form_responses_task_creation_result_check",
      sql`(${table.taskCreationStatus} = 'completed' and ${table.createdTaskId} is not null and ${table.taskCreationCompletedAt} is not null) or (${table.taskCreationStatus} <> 'completed' and ${table.createdTaskId} is null and ${table.taskCreationCompletedAt} is null)`,
    ),
  ],
);

export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .references(() => organizations.id)
      .notNull(),
    number: varchar("number", { length: 50 }).notNull(),
    amount: doublePrecision("amount").notNull(),
    currency: varchar("currency", { length: 10 }).default("USD"),
    status: varchar("status", { length: 20 }).default("paid"),
    periodStart: timestamp("period_start", { withTimezone: true }),
    periodEnd: timestamp("period_end", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("invoices_organization_number_unique").on(table.organizationId, table.number)],
);

export const invitations = pgTable(
  "invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .references(() => organizations.id)
      .notNull(),
    workspaceId: uuid("workspace_id").references(() => workspaces.id),
    email: varchar("email", { length: 255 }).notNull(),
    role: userRoleEnum("role").default("member").notNull(),
    status: varchar("status", { length: 20 }).default("pending").notNull(),
    invitedBy: uuid("invited_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("invitations_pending_org_workspace_email_unique")
      .on(table.organizationId, table.workspaceId, sql`lower(${table.email})`)
      .where(sql`${table.status} = 'pending' and ${table.workspaceId} is not null`),
    uniqueIndex("invitations_pending_orgwide_email_unique")
      .on(table.organizationId, sql`lower(${table.email})`)
      .where(sql`${table.status} = 'pending' and ${table.workspaceId} is null`),
  ],
);

export const activities = pgTable("activities", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .references(() => organizations.id)
    .notNull(),
  workspaceId: uuid("workspace_id")
    .references(() => workspaces.id)
    .notNull(),
  actorId: uuid("actor_id")
    .references(() => users.id)
    .notNull(),
  action: varchar("action", { length: 100 }).notNull(),
  entityType: varchar("entity_type", { length: 50 }).notNull(),
  entityId: uuid("entity_id").notNull(),
  oldValues: jsonb("old_values").$type<any>(),
  newValues: jsonb("new_values").$type<any>(),
  ip: varchar("ip", { length: 50 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const customFields = pgTable(
  "custom_fields",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .references(() => organizations.id)
      .notNull(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id)
      .notNull(),
    projectId: uuid("project_id").references(() => projects.id),
    name: varchar("name", { length: 160 }).notNull(),
    key: varchar("key", { length: 160 }).notNull(),
    type: varchar("type", { length: 50 }).notNull(),
    description: text("description"),
    options: jsonb("options").$type<Array<{ label: string; value: string; color?: string }>>().default([]),
    required: boolean("required").default(false).notNull(),
    sensitive: boolean("sensitive").default(false).notNull(),
    order: doublePrecision("order").default(0).notNull(),
    createdById: uuid("created_by_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("custom_fields_workspace_key_unique")
      .on(table.organizationId, table.workspaceId, table.key)
      .where(sql`${table.projectId} is null and ${table.deletedAt} is null`),
    uniqueIndex("custom_fields_project_key_unique")
      .on(table.organizationId, table.workspaceId, table.projectId, table.key)
      .where(sql`${table.projectId} is not null and ${table.deletedAt} is null`),
  ],
);

export const branches = pgTable(
  "branches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .references(() => organizations.id)
      .notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    code: varchar("code", { length: 50 }).notNull(),
    city: varchar("city", { length: 100 }),
    address: text("address"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [uniqueIndex("branches_organization_code_unique").on(table.organizationId, table.code)],
);

export const userSessions = pgTable(
  "user_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    device: varchar("device", { length: 255 }).notNull(),
    browser: varchar("browser", { length: 100 }),
    userAgent: text("user_agent"),
    ip: varchar("ip", { length: 50 }),
    location: varchar("location", { length: 100 }),
    isCurrent: boolean("is_current").default(false).notNull(),
    lastActive: timestamp("last_active", { withTimezone: true }).defaultNow().notNull(),
    lastRefreshAt: timestamp("last_refresh_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true })
      .default(sql`now() + interval '30 days'`)
      .notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokeReason: varchar("revoke_reason", { length: 100 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("user_sessions_user_active_idx").on(table.userId, table.revokedAt, table.expiresAt, table.lastActive),
    check("user_sessions_expiry_check", sql`${table.expiresAt} > ${table.createdAt}`),
    check(
      "user_sessions_revocation_check",
      sql`(${table.revokedAt} is null and ${table.revokeReason} is null) or (${table.revokedAt} is not null and ${table.revokeReason} is not null)`,
    ),
  ],
);

export const refreshTokens = pgTable(
  "refresh_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .references(() => userSessions.id, { onDelete: "cascade" })
      .notNull(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    familyId: uuid("family_id").notNull(),
    tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
    parentTokenId: uuid("parent_token_id").references((): AnyPgColumn => refreshTokens.id),
    replacedByTokenId: uuid("replaced_by_token_id").references((): AnyPgColumn => refreshTokens.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokeReason: varchar("revoke_reason", { length: 100 }),
    createdIp: varchar("created_ip", { length: 50 }),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("refresh_tokens_session_active_idx").on(table.sessionId, table.revokedAt, table.usedAt, table.expiresAt),
    index("refresh_tokens_family_active_idx").on(table.familyId, table.revokedAt, table.createdAt),
    index("refresh_tokens_user_created_idx").on(table.userId, table.createdAt),
    check("refresh_tokens_expiry_check", sql`${table.expiresAt} > ${table.createdAt}`),
    check(
      "refresh_tokens_parent_not_self_check",
      sql`${table.parentTokenId} is null or ${table.parentTokenId} <> ${table.id}`,
    ),
    check(
      "refresh_tokens_replacement_check",
      sql`(${table.replacedByTokenId} is null) or (${table.usedAt} is not null and ${table.replacedByTokenId} <> ${table.id})`,
    ),
    check(
      "refresh_tokens_revocation_check",
      sql`(${table.revokedAt} is null and ${table.revokeReason} is null) or (${table.revokedAt} is not null and ${table.revokeReason} is not null)`,
    ),
  ],
);

export const documentPermissions = pgTable(
  "document_permissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    docId: uuid("doc_id")
      .references(() => docs.id, { onDelete: "cascade" })
      .notNull(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    accessLevel: documentAccessLevelEnum("access_level").notNull(),
    grantedById: uuid("granted_by_id")
      .references(() => users.id)
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("document_permissions_doc_user_unique").on(table.docId, table.userId),
    index("document_permissions_tenant_user_idx").on(
      table.organizationId,
      table.workspaceId,
      table.userId,
      table.docId,
    ),
    check("document_permissions_no_self_grant_check", sql`${table.userId} <> ${table.grantedById}`),
  ],
);

export const docVersions = pgTable(
  "doc_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .references(() => organizations.id)
      .notNull(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id)
      .notNull(),
    docId: uuid("doc_id")
      .references(() => docs.id, { onDelete: "cascade" })
      .notNull(),
    title: varchar("title", { length: 500 }).notNull(),
    content: text("content"),
    versionNumber: integer("version_number").default(1).notNull(),
    savedById: uuid("saved_by_id")
      .references(() => users.id)
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("doc_versions_document_number_unique").on(table.docId, table.versionNumber),
    index("doc_versions_tenant_document_created_idx").on(
      table.organizationId,
      table.workspaceId,
      table.docId,
      table.createdAt,
    ),
    check("doc_versions_number_positive_check", sql`${table.versionNumber} > 0`),
  ],
);

export const notificationPreferences = pgTable(
  "notification_preferences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .references(() => users.id)
      .notNull(),
    emailEnabled: boolean("email_enabled").default(true),
    pushEnabled: boolean("push_enabled").default(true),
    inAppEnabled: boolean("in_app_enabled").default(true),
    dndStart: varchar("dnd_start", { length: 10 }).default("22:00"),
    dndEnd: varchar("dnd_end", { length: 10 }).default("07:00"),
    dndEnabled: boolean("dnd_enabled").default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("notification_preferences_user_unique").on(table.userId)],
);

export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id").references(() => users.id),
    key: varchar("key", { length: 255 }).notNull(),
    scope: varchar("scope", { length: 160 }).notNull(),
    requestHash: varchar("request_hash", { length: 64 }).notNull(),
    status: idempotencyKeyStatusEnum("status").default("processing").notNull(),
    lockToken: uuid("lock_token").notNull(),
    attempts: integer("attempts").default(1).notNull(),
    responseStatusCode: integer("response_status_code"),
    responseBody: jsonb("response_body").$type<unknown>(),
    lockedAt: timestamp("locked_at", { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("idempotency_keys_organization_scope_key_unique").on(table.organizationId, table.scope, table.key),
    index("idempotency_keys_expiry_idx").on(table.expiresAt),
    index("idempotency_keys_processing_idx").on(table.status, table.lockedAt),
    check("idempotency_keys_key_check", sql`length(${table.key}) between 8 and 255`),
    check("idempotency_keys_scope_check", sql`${table.scope} ~ '^[a-z0-9][a-z0-9_.:-]{1,159}$'`),
    check("idempotency_keys_request_hash_check", sql`${table.requestHash} ~ '^[a-f0-9]{64}$'`),
    check("idempotency_keys_attempts_check", sql`${table.attempts} > 0`),
    check("idempotency_keys_expiry_check", sql`${table.expiresAt} > ${table.createdAt}`),
    check(
      "idempotency_keys_response_status_check",
      sql`${table.responseStatusCode} is null or ${table.responseStatusCode} between 100 and 599`,
    ),
    check(
      "idempotency_keys_state_check",
      sql`(${table.status} = 'completed' and ${table.completedAt} is not null and ${table.responseStatusCode} is not null) or (${table.status} <> 'completed' and ${table.completedAt} is null and ${table.responseStatusCode} is null and ${table.responseBody} is null)`,
    ),
  ],
);

export const integrationCredentials = pgTable(
  "integration_credentials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    provider: varchar("provider", { length: 50 }).notNull(),
    credentialKey: varchar("credential_key", { length: 80 }).default("default").notNull(),
    displayName: varchar("display_name", { length: 160 }).notNull(),
    authType: integrationAuthTypeEnum("auth_type").notNull(),
    encryptedPayload: text("encrypted_payload").notNull(),
    initializationVector: varchar("initialization_vector", { length: 24 }).notNull(),
    authenticationTag: varchar("authentication_tag", { length: 24 }).notNull(),
    encryptionAlgorithm: varchar("encryption_algorithm", { length: 20 }).default("aes-256-gcm").notNull(),
    encryptionKeyVersion: integer("encryption_key_version").default(1).notNull(),
    secretFingerprint: varchar("secret_fingerprint", { length: 64 }).notNull(),
    externalAccountId: varchar("external_account_id", { length: 255 }),
    scopes: jsonb("scopes").$type<string[]>().default([]).notNull(),
    metadata: jsonb("metadata").$type<Record<string, string>>().default({}).notNull(),
    status: integrationCredentialStatusEnum("status").default("active").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    lastRotatedAt: timestamp("last_rotated_at", { withTimezone: true }).defaultNow().notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdBy: uuid("created_by")
      .references(() => users.id)
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("integration_credentials_tenant_provider_key_active_unique")
      .on(table.organizationId, table.workspaceId, table.provider, table.credentialKey)
      .where(sql`${table.revokedAt} is null`),
    index("integration_credentials_tenant_status_idx").on(
      table.organizationId,
      table.workspaceId,
      table.status,
      table.provider,
    ),
    index("integration_credentials_expiry_idx").on(table.status, table.expiresAt),
    check("integration_credentials_provider_check", sql`${table.provider} ~ '^[a-z0-9][a-z0-9_-]{1,49}$'`),
    check("integration_credentials_key_check", sql`${table.credentialKey} ~ '^[a-z0-9][a-z0-9_.-]{0,79}$'`),
    check("integration_credentials_cipher_check", sql`${table.encryptionAlgorithm} = 'aes-256-gcm'`),
    check("integration_credentials_key_version_check", sql`${table.encryptionKeyVersion} > 0`),
    check("integration_credentials_payload_check", sql`length(${table.encryptedPayload}) > 0`),
    check(
      "integration_credentials_revocation_check",
      sql`(${table.status} = 'revoked' and ${table.revokedAt} is not null) or (${table.status} <> 'revoked' and ${table.revokedAt} is null)`,
    ),
  ],
);

export const integrationWebhookEndpoints = pgTable(
  "integration_webhook_endpoints",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    provider: varchar("provider", { length: 20 }).notNull(),
    displayName: varchar("display_name", { length: 160 }).notNull(),
    endpointKeyHash: varchar("endpoint_key_hash", { length: 64 }).notNull().unique(),
    status: varchar("status", { length: 20 }).default("active").notNull(),
    createdBy: uuid("created_by")
      .references(() => users.id)
      .notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("integration_webhook_endpoints_tenant_status_idx").on(
      table.organizationId,
      table.workspaceId,
      table.status,
      table.provider,
    ),
    check("integration_webhook_endpoints_provider_check", sql`${table.provider} in ('github', 'slack', 'webhook')`),
    check("integration_webhook_endpoints_hash_check", sql`${table.endpointKeyHash} ~ '^[a-f0-9]{64}$'`),
    check("integration_webhook_endpoints_status_check", sql`${table.status} in ('active', 'revoked')`),
    check(
      "integration_webhook_endpoints_revocation_check",
      sql`(${table.status} = 'revoked' and ${table.revokedAt} is not null) or (${table.status} = 'active' and ${table.revokedAt} is null)`,
    ),
  ],
);

export const integrationWebhookReceipts = pgTable(
  "integration_webhook_receipts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    endpointId: uuid("endpoint_id")
      .references(() => integrationWebhookEndpoints.id, { onDelete: "cascade" })
      .notNull(),
    organizationId: uuid("organization_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    provider: varchar("provider", { length: 20 }).notNull(),
    deliveryId: varchar("delivery_id", { length: 255 }).notNull(),
    payloadSha256: varchar("payload_sha256", { length: 64 }).notNull(),
    eventType: varchar("event_type", { length: 100 }).notNull(),
    providerTimestamp: timestamp("provider_timestamp", { withTimezone: true }),
    status: varchar("status", { length: 20 }).default("processed").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("integration_webhook_receipts_endpoint_delivery_unique").on(table.endpointId, table.deliveryId),
    index("integration_webhook_receipts_tenant_received_idx").on(
      table.organizationId,
      table.workspaceId,
      table.receivedAt,
    ),
    check("integration_webhook_receipts_provider_check", sql`${table.provider} in ('github', 'slack', 'webhook')`),
    check("integration_webhook_receipts_delivery_check", sql`length(${table.deliveryId}) between 8 and 255`),
    check("integration_webhook_receipts_payload_hash_check", sql`${table.payloadSha256} ~ '^[a-f0-9]{64}$'`),
    check("integration_webhook_receipts_status_check", sql`${table.status} = 'processed'`),
    check("integration_webhook_receipts_time_check", sql`${table.processedAt} >= ${table.receivedAt}`),
  ],
);

export const subscriptionPlans = pgTable(
  "subscription_plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: orgPlanEnum("key").notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    description: text("description"),
    monthlyPriceCents: integer("monthly_price_cents").default(0).notNull(),
    yearlyPriceCents: integer("yearly_price_cents").default(0).notNull(),
    currency: varchar("currency", { length: 3 }).default("USD").notNull(),
    minSeats: integer("min_seats").default(1).notNull(),
    maxSeats: integer("max_seats").notNull(),
    maxProjects: integer("max_projects").notNull(),
    maxTasks: integer("max_tasks").notNull(),
    maxStorageMb: integer("max_storage_mb").notNull(),
    maxAiRequestsPerMonth: integer("max_ai_requests_per_month").notNull(),
    maxAiTokensPerMonth: bigint("max_ai_tokens_per_month", { mode: "number" }).notNull(),
    trialDays: integer("trial_days").default(0).notNull(),
    features: jsonb("features").$type<Record<string, boolean>>().default({}).notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    isPublic: boolean("is_public").default(true).notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("subscription_plans_key_unique").on(table.key),
    index("subscription_plans_catalog_idx").on(table.isActive, table.isPublic, table.sortOrder),
    check("subscription_plans_prices_check", sql`${table.monthlyPriceCents} >= 0 and ${table.yearlyPriceCents} >= 0`),
    check("subscription_plans_seats_check", sql`${table.minSeats} > 0 and ${table.maxSeats} >= ${table.minSeats}`),
    check(
      "subscription_plans_limits_check",
      sql`${table.maxProjects} >= 0 and ${table.maxTasks} >= 0 and ${table.maxStorageMb} >= 0 and ${table.maxAiRequestsPerMonth} >= 0 and ${table.maxAiTokensPerMonth} >= 0 and ${table.trialDays} >= 0`,
    ),
    check("subscription_plans_currency_check", sql`${table.currency} = upper(${table.currency})`),
  ],
);

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    planId: uuid("plan_id")
      .references(() => subscriptionPlans.id)
      .notNull(),
    status: subscriptionStatusEnum("status").default("active").notNull(),
    billingInterval: subscriptionBillingIntervalEnum("billing_interval").default("monthly").notNull(),
    seats: integer("seats").default(1).notNull(),
    unitPriceCents: integer("unit_price_cents").default(0).notNull(),
    currency: varchar("currency", { length: 3 }).default("USD").notNull(),
    provider: varchar("provider", { length: 50 }).default("internal").notNull(),
    providerCustomerId: varchar("provider_customer_id", { length: 255 }),
    providerSubscriptionId: varchar("provider_subscription_id", { length: 255 }),
    providerEventCreatedAt: timestamp("provider_event_created_at", { withTimezone: true }),
    currentPeriodStart: timestamp("current_period_start", { withTimezone: true }).defaultNow().notNull(),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }).notNull(),
    trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
    gracePeriodEndsAt: timestamp("grace_period_ends_at", { withTimezone: true }),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").default(false).notNull(),
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("subscriptions_organization_current_unique")
      .on(table.organizationId)
      .where(sql`${table.endedAt} is null`),
    uniqueIndex("subscriptions_provider_subscription_unique")
      .on(table.provider, table.providerSubscriptionId)
      .where(sql`${table.providerSubscriptionId} is not null`),
    index("subscriptions_organization_status_idx").on(table.organizationId, table.status, table.currentPeriodEnd),
    index("subscriptions_provider_customer_idx").on(table.provider, table.providerCustomerId),
    check("subscriptions_seats_check", sql`${table.seats} > 0`),
    check("subscriptions_price_check", sql`${table.unitPriceCents} >= 0`),
    check("subscriptions_currency_check", sql`${table.currency} = upper(${table.currency})`),
    check("subscriptions_period_check", sql`${table.currentPeriodEnd} > ${table.currentPeriodStart}`),
    check("subscriptions_trial_check", sql`${table.status} <> 'trialing' or ${table.trialEndsAt} is not null`),
    check(
      "subscriptions_grace_period_check",
      sql`${table.status} <> 'grace_period' or ${table.gracePeriodEndsAt} is not null`,
    ),
    check(
      "subscriptions_canceled_check",
      sql`${table.status} <> 'canceled' or (${table.canceledAt} is not null and ${table.endedAt} is not null)`,
    ),
  ],
);

export const usageLimits = pgTable(
  "usage_limits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    maxSeats: integer("max_seats").default(25).notNull(),
    maxProjects: integer("max_projects").default(50).notNull(),
    maxTasks: integer("max_tasks").default(5000).notNull(),
    maxStorageMb: integer("max_storage_mb").default(10240).notNull(),
    maxAiRequestsPerMonth: integer("max_ai_requests_per_month").default(20).notNull(),
    maxAiTokensPerMonth: bigint("max_ai_tokens_per_month", { mode: "number" }).default(50_000).notNull(),
    currentSeats: bigint("current_seats", { mode: "number" }).default(0).notNull(),
    currentProjects: bigint("current_projects", { mode: "number" }).default(0).notNull(),
    currentTasks: bigint("current_tasks", { mode: "number" }).default(0).notNull(),
    currentStorageBytes: bigint("current_storage_bytes", { mode: "number" }).default(0).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("usage_limits_organization_unique").on(table.organizationId),
    check(
      "usage_limits_current_nonnegative_check",
      sql`${table.currentSeats} >= 0 and ${table.currentProjects} >= 0 and ${table.currentTasks} >= 0 and ${table.currentStorageBytes} >= 0`,
    ),
  ],
);

export const aiUsagePeriods = pgTable(
  "ai_usage_periods",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    periodStart: date("period_start").notNull(),
    requestCount: bigint("request_count", { mode: "number" }).default(0).notNull(),
    reservedTokens: bigint("reserved_tokens", { mode: "number" }).default(0).notNull(),
    inputTokens: bigint("input_tokens", { mode: "number" }).default(0).notNull(),
    outputTokens: bigint("output_tokens", { mode: "number" }).default(0).notNull(),
    estimatedCostMicrousd: bigint("estimated_cost_microusd", { mode: "number" }).default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("ai_usage_periods_organization_period_unique").on(table.organizationId, table.periodStart),
    index("ai_usage_periods_period_idx").on(table.periodStart, table.organizationId),
    check(
      "ai_usage_periods_nonnegative_check",
      sql`${table.requestCount} >= 0 and ${table.reservedTokens} >= 0 and ${table.inputTokens} >= 0 and ${table.outputTokens} >= 0 and ${table.estimatedCostMicrousd} >= 0`,
    ),
  ],
);

export const aiUsageEvents = pgTable(
  "ai_usage_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    actorId: uuid("actor_id")
      .references(() => users.id, { onDelete: "restrict" })
      .notNull(),
    periodStart: date("period_start").notNull(),
    action: varchar("action", { length: 32 }).notNull(),
    status: aiUsageStatusEnum("status").default("pending").notNull(),
    provider: varchar("provider", { length: 50 }),
    model: varchar("model", { length: 160 }),
    reservedTokens: bigint("reserved_tokens", { mode: "number" }).notNull(),
    inputTokens: bigint("input_tokens", { mode: "number" }).default(0).notNull(),
    outputTokens: bigint("output_tokens", { mode: "number" }).default(0).notNull(),
    estimatedCostMicrousd: bigint("estimated_cost_microusd", { mode: "number" }).default(0).notNull(),
    failureCode: varchar("failure_code", { length: 80 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("ai_usage_events_organization_created_idx").on(table.organizationId, table.createdAt),
    index("ai_usage_events_period_status_idx").on(table.organizationId, table.periodStart, table.status),
    check("ai_usage_events_reserved_tokens_check", sql`${table.reservedTokens} > 0`),
    check(
      "ai_usage_events_totals_check",
      sql`${table.inputTokens} >= 0 and ${table.outputTokens} >= 0 and ${table.estimatedCostMicrousd} >= 0`,
    ),
    check(
      "ai_usage_events_terminal_state_check",
      sql`(${table.status} = 'pending' and ${table.completedAt} is null) or (${table.status} <> 'pending' and ${table.completedAt} is not null)`,
    ),
    check(
      "ai_usage_events_failure_check",
      sql`(${table.status} = 'failed' and ${table.failureCode} is not null) or (${table.status} <> 'failed' and ${table.failureCode} is null)`,
    ),
  ],
);

export const aiActionProposals = pgTable(
  "ai_action_proposals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    projectId: uuid("project_id")
      .references(() => projects.id, { onDelete: "cascade" })
      .notNull(),
    actorId: uuid("actor_id")
      .references(() => users.id, { onDelete: "restrict" })
      .notNull(),
    action: varchar("action", { length: 32 }).notNull(),
    kind: varchar("kind", { length: 32 }).default("create_tasks").notNull(),
    payload: jsonb("payload").$type<AIProposedTask[]>().notNull(),
    payloadDigest: varchar("payload_digest", { length: 64 }).notNull(),
    status: aiProposalStatusEnum("status").default("pending").notNull(),
    provider: varchar("provider", { length: 50 }).notNull(),
    model: varchar("model", { length: 160 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    rejectedAt: timestamp("rejected_at", { withTimezone: true }),
    expiredAt: timestamp("expired_at", { withTimezone: true }),
    executedAt: timestamp("executed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("ai_action_proposals_tenant_status_expiry_idx").on(
      table.organizationId,
      table.workspaceId,
      table.status,
      table.expiresAt,
    ),
    index("ai_action_proposals_actor_status_idx").on(table.actorId, table.status, table.createdAt),
    check("ai_action_proposals_action_check", sql`${table.action} ~ '^[a-z_]{2,32}$'`),
    check("ai_action_proposals_kind_check", sql`${table.kind} = 'create_tasks'`),
    check("ai_action_proposals_digest_check", sql`${table.payloadDigest} ~ '^[0-9a-f]{64}$'`),
    check(
      "ai_action_proposals_payload_check",
      sql`jsonb_typeof(${table.payload}) = 'array' and jsonb_array_length(${table.payload}) between 1 and 50`,
    ),
    check("ai_action_proposals_expiry_check", sql`${table.expiresAt} > ${table.createdAt}`),
    check(
      "ai_action_proposals_state_check",
      sql`(${table.status} = 'pending' and ${table.approvedAt} is null and ${table.rejectedAt} is null and ${table.expiredAt} is null and ${table.executedAt} is null)
        or (${table.status} = 'executed' and ${table.approvedAt} is not null and ${table.executedAt} is not null and ${table.rejectedAt} is null and ${table.expiredAt} is null)
        or (${table.status} = 'rejected' and ${table.rejectedAt} is not null and ${table.approvedAt} is null and ${table.expiredAt} is null and ${table.executedAt} is null)
        or (${table.status} = 'expired' and ${table.expiredAt} is not null and ${table.approvedAt} is null and ${table.rejectedAt} is null and ${table.executedAt} is null)`,
    ),
  ],
);

export const permissions = pgTable("permissions", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: varchar("key", { length: 160 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  category: varchar("category", { length: 80 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const roles = pgTable(
  "roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
    key: varchar("key", { length: 100 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    isSystem: boolean("is_system").default(false).notNull(),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    check(
      "roles_ownership_check",
      sql`(${table.isSystem} and ${table.organizationId} is null) or (not ${table.isSystem} and ${table.organizationId} is not null)`,
    ),
    uniqueIndex("roles_system_key_unique")
      .on(table.key)
      .where(sql`${table.organizationId} is null and ${table.deletedAt} is null`),
    uniqueIndex("roles_organization_key_unique")
      .on(table.organizationId, table.key)
      .where(sql`${table.organizationId} is not null and ${table.deletedAt} is null`),
    index("roles_organization_active_idx").on(table.organizationId, table.deletedAt),
  ],
);

export const rolePermissions = pgTable(
  "role_permissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roleId: uuid("role_id")
      .references(() => roles.id, { onDelete: "cascade" })
      .notNull(),
    permissionId: uuid("permission_id")
      .references(() => permissions.id, { onDelete: "cascade" })
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("role_permissions_role_permission_unique").on(table.roleId, table.permissionId)],
);

export const membershipRoleBindings = pgTable(
  "membership_role_bindings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    membershipId: uuid("membership_id")
      .references(() => memberships.id, { onDelete: "cascade" })
      .notNull(),
    roleId: uuid("role_id")
      .references(() => roles.id, { onDelete: "cascade" })
      .notNull(),
    scope: authorizationScopeEnum("scope").notNull(),
    isPrimary: boolean("is_primary").default(false).notNull(),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check(
      "membership_role_bindings_scope_check",
      sql`(${table.scope} = 'organization' and ${table.workspaceId} is null and ${table.projectId} is null)
        or (${table.scope} = 'workspace' and ${table.workspaceId} is not null and ${table.projectId} is null)
        or (${table.scope} = 'project' and ${table.workspaceId} is not null and ${table.projectId} is not null)`,
    ),
    uniqueIndex("membership_role_bindings_primary_unique")
      .on(table.membershipId)
      .where(sql`${table.isPrimary}`),
    uniqueIndex("membership_role_bindings_organization_unique")
      .on(table.membershipId, table.roleId)
      .where(sql`${table.scope} = 'organization'`),
    uniqueIndex("membership_role_bindings_workspace_unique")
      .on(table.membershipId, table.workspaceId, table.roleId)
      .where(sql`${table.scope} = 'workspace'`),
    uniqueIndex("membership_role_bindings_project_unique")
      .on(table.membershipId, table.projectId, table.roleId)
      .where(sql`${table.scope} = 'project'`),
    index("membership_role_bindings_tenant_scope_idx").on(
      table.organizationId,
      table.workspaceId,
      table.projectId,
      table.membershipId,
    ),
  ],
);

export const membershipPermissionOverrides = pgTable(
  "membership_permission_overrides",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    membershipId: uuid("membership_id")
      .references(() => memberships.id, { onDelete: "cascade" })
      .notNull(),
    permissionId: uuid("permission_id")
      .references(() => permissions.id, { onDelete: "cascade" })
      .notNull(),
    scope: authorizationScopeEnum("scope").notNull(),
    effect: permissionOverrideEffectEnum("effect").notNull(),
    reason: text("reason"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check(
      "membership_permission_overrides_scope_check",
      sql`(${table.scope} = 'organization' and ${table.workspaceId} is null and ${table.projectId} is null)
        or (${table.scope} = 'workspace' and ${table.workspaceId} is not null and ${table.projectId} is null)
        or (${table.scope} = 'project' and ${table.workspaceId} is not null and ${table.projectId} is not null)`,
    ),
    uniqueIndex("membership_permission_overrides_organization_unique")
      .on(table.membershipId, table.permissionId)
      .where(sql`${table.scope} = 'organization'`),
    uniqueIndex("membership_permission_overrides_workspace_unique")
      .on(table.membershipId, table.workspaceId, table.permissionId)
      .where(sql`${table.scope} = 'workspace'`),
    uniqueIndex("membership_permission_overrides_project_unique")
      .on(table.membershipId, table.projectId, table.permissionId)
      .where(sql`${table.scope} = 'project'`),
    index("membership_permission_overrides_tenant_scope_idx").on(
      table.organizationId,
      table.workspaceId,
      table.projectId,
      table.membershipId,
    ),
  ],
);

export const projectMembers = pgTable(
  "project_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    projectId: uuid("project_id")
      .references(() => projects.id, { onDelete: "cascade" })
      .notNull(),
    userId: uuid("user_id")
      .references(() => users.id)
      .notNull(),
    role: projectMemberRoleEnum("role").default("member").notNull(),
    isOwner: boolean("is_owner").default(false).notNull(),
    addedBy: uuid("added_by").references(() => users.id),
    joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("project_members_project_user_active_unique")
      .on(table.projectId, table.userId)
      .where(sql`${table.deletedAt} is null`),
    uniqueIndex("project_members_project_owner_active_unique")
      .on(table.projectId)
      .where(sql`${table.isOwner} and ${table.deletedAt} is null`),
    index("project_members_tenant_project_active_idx").on(
      table.organizationId,
      table.workspaceId,
      table.projectId,
      table.deletedAt,
      table.userId,
    ),
  ],
);

export const projectTeams = pgTable(
  "project_teams",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    projectId: uuid("project_id")
      .references(() => projects.id, { onDelete: "cascade" })
      .notNull(),
    teamId: uuid("team_id")
      .references(() => teams.id, { onDelete: "cascade" })
      .notNull(),
    addedBy: uuid("added_by").references(() => users.id),
    addedAt: timestamp("added_at", { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("project_teams_project_team_active_unique")
      .on(table.projectId, table.teamId)
      .where(sql`${table.deletedAt} is null`),
    index("project_teams_tenant_project_active_idx").on(
      table.organizationId,
      table.workspaceId,
      table.projectId,
      table.deletedAt,
      table.teamId,
    ),
  ],
);

export const taskAssignees = pgTable(
  "task_assignees",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    projectId: uuid("project_id")
      .references(() => projects.id, { onDelete: "cascade" })
      .notNull(),
    taskId: uuid("task_id")
      .references(() => tasks.id, { onDelete: "cascade" })
      .notNull(),
    userId: uuid("user_id")
      .references(() => users.id)
      .notNull(),
    isPrimary: boolean("is_primary").default(false).notNull(),
    assignedBy: uuid("assigned_by").references(() => users.id),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).defaultNow().notNull(),
    unassignedAt: timestamp("unassigned_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("task_assignees_task_user_active_unique")
      .on(table.taskId, table.userId)
      .where(sql`${table.unassignedAt} is null`),
    uniqueIndex("task_assignees_task_primary_active_unique")
      .on(table.taskId)
      .where(sql`${table.isPrimary} and ${table.unassignedAt} is null`),
    index("task_assignees_tenant_user_active_idx").on(
      table.organizationId,
      table.workspaceId,
      table.userId,
      table.unassignedAt,
      table.taskId,
    ),
  ],
);

export const taskFollowers = pgTable(
  "task_followers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    projectId: uuid("project_id")
      .references(() => projects.id, { onDelete: "cascade" })
      .notNull(),
    taskId: uuid("task_id")
      .references(() => tasks.id, { onDelete: "cascade" })
      .notNull(),
    userId: uuid("user_id")
      .references(() => users.id)
      .notNull(),
    followedAt: timestamp("followed_at", { withTimezone: true }).defaultNow().notNull(),
    unfollowedAt: timestamp("unfollowed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("task_followers_task_user_active_unique")
      .on(table.taskId, table.userId)
      .where(sql`${table.unfollowedAt} is null`),
    index("task_followers_tenant_user_active_idx").on(
      table.organizationId,
      table.workspaceId,
      table.userId,
      table.unfollowedAt,
      table.taskId,
    ),
  ],
);

export const taskDependencies = pgTable(
  "task_dependencies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    blockingTaskId: uuid("blocking_task_id")
      .references(() => tasks.id, { onDelete: "cascade" })
      .notNull(),
    dependentTaskId: uuid("dependent_task_id")
      .references(() => tasks.id, { onDelete: "cascade" })
      .notNull(),
    type: taskDependencyTypeEnum("type").default("finish_to_start").notNull(),
    lagMinutes: integer("lag_minutes").default(0).notNull(),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    check("task_dependencies_not_self_check", sql`${table.blockingTaskId} <> ${table.dependentTaskId}`),
    uniqueIndex("task_dependencies_active_unique")
      .on(table.blockingTaskId, table.dependentTaskId, table.type)
      .where(sql`${table.deletedAt} is null`),
    index("task_dependencies_tenant_dependent_active_idx").on(
      table.organizationId,
      table.workspaceId,
      table.dependentTaskId,
      table.deletedAt,
    ),
    index("task_dependencies_tenant_blocking_active_idx").on(
      table.organizationId,
      table.workspaceId,
      table.blockingTaskId,
      table.deletedAt,
    ),
  ],
);

export const taskRelations = pgTable(
  "task_relations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    sourceTaskId: uuid("source_task_id")
      .references(() => tasks.id, { onDelete: "cascade" })
      .notNull(),
    targetTaskId: uuid("target_task_id")
      .references(() => tasks.id, { onDelete: "cascade" })
      .notNull(),
    type: taskRelationTypeEnum("type").default("related").notNull(),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    check("task_relations_not_self_check", sql`${table.sourceTaskId} <> ${table.targetTaskId}`),
    uniqueIndex("task_relations_active_unique")
      .on(table.sourceTaskId, table.targetTaskId, table.type)
      .where(sql`${table.deletedAt} is null`),
    index("task_relations_tenant_source_active_idx").on(
      table.organizationId,
      table.workspaceId,
      table.sourceTaskId,
      table.deletedAt,
    ),
    index("task_relations_tenant_target_active_idx").on(
      table.organizationId,
      table.workspaceId,
      table.targetTaskId,
      table.deletedAt,
    ),
  ],
);

export const taskReminders = pgTable(
  "task_reminders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    projectId: uuid("project_id")
      .references(() => projects.id, { onDelete: "cascade" })
      .notNull(),
    taskId: uuid("task_id")
      .references(() => tasks.id, { onDelete: "cascade" })
      .notNull(),
    externalId: varchar("external_id", { length: 128 }).notNull(),
    remindAt: timestamp("remind_at", { withTimezone: true }).notNull(),
    label: varchar("label", { length: 255 }).notNull(),
    status: taskReminderStatusEnum("status").default("scheduled").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    failureReason: text("failure_reason"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("task_reminders_task_external_active_unique")
      .on(table.taskId, table.externalId)
      .where(sql`${table.deletedAt} is null`),
    index("task_reminders_tenant_due_idx").on(
      table.organizationId,
      table.workspaceId,
      table.status,
      table.remindAt,
      table.deletedAt,
    ),
    index("task_reminders_tenant_task_active_idx").on(
      table.organizationId,
      table.workspaceId,
      table.taskId,
      table.deletedAt,
    ),
  ],
);

export const taskRecurrenceRules = pgTable(
  "task_recurrence_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    projectId: uuid("project_id")
      .references(() => projects.id, { onDelete: "cascade" })
      .notNull(),
    taskId: uuid("task_id")
      .references(() => tasks.id, { onDelete: "cascade" })
      .notNull(),
    frequency: taskRecurrenceFrequencyEnum("frequency").default("weekly").notNull(),
    interval: integer("interval").default(1).notNull(),
    timezone: varchar("timezone", { length: 100 }).default("UTC").notNull(),
    weekdays: integer("weekdays")
      .array()
      .default(sql`ARRAY[]::integer[]`)
      .notNull(),
    monthDay: integer("month_day"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    maxOccurrences: integer("max_occurrences"),
    occurrencesCreated: integer("occurrences_created").default(0).notNull(),
    nextOccurrenceAt: timestamp("next_occurrence_at", { withTimezone: true }).notNull(),
    lastOccurrenceAt: timestamp("last_occurrence_at", { withTimezone: true }),
    status: taskRecurrenceStatusEnum("status").default("active").notNull(),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("task_recurrence_rules_task_active_unique")
      .on(table.taskId)
      .where(sql`${table.deletedAt} is null`),
    index("task_recurrence_rules_tenant_due_idx").on(
      table.organizationId,
      table.workspaceId,
      table.status,
      table.nextOccurrenceAt,
      table.deletedAt,
    ),
    check("task_recurrence_rules_interval_check", sql`${table.interval} > 0`),
    check("task_recurrence_rules_weekdays_check", sql`${table.weekdays} <@ ARRAY[0, 1, 2, 3, 4, 5, 6]::integer[]`),
    check(
      "task_recurrence_rules_month_day_check",
      sql`${table.monthDay} is null or ${table.monthDay} between 1 and 31`,
    ),
    check(
      "task_recurrence_rules_max_occurrences_check",
      sql`${table.maxOccurrences} is null or ${table.maxOccurrences} > 0`,
    ),
    check("task_recurrence_rules_occurrences_created_check", sql`${table.occurrencesCreated} >= 0`),
    check("task_recurrence_rules_end_check", sql`${table.endsAt} is null or ${table.endsAt} > ${table.startsAt}`),
  ],
);

export const taskChecklists = pgTable(
  "task_checklists",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    projectId: uuid("project_id")
      .references(() => projects.id, { onDelete: "cascade" })
      .notNull(),
    taskId: uuid("task_id")
      .references(() => tasks.id, { onDelete: "cascade" })
      .notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    order: doublePrecision("order").default(0).notNull(),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("task_checklists_tenant_task_order_idx").on(
      table.organizationId,
      table.workspaceId,
      table.taskId,
      table.deletedAt,
      table.order,
    ),
  ],
);

export const taskChecklistItems = pgTable(
  "task_checklist_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    projectId: uuid("project_id")
      .references(() => projects.id, { onDelete: "cascade" })
      .notNull(),
    taskId: uuid("task_id")
      .references(() => tasks.id, { onDelete: "cascade" })
      .notNull(),
    checklistId: uuid("checklist_id")
      .references(() => taskChecklists.id, { onDelete: "cascade" })
      .notNull(),
    title: varchar("title", { length: 500 }).notNull(),
    order: doublePrecision("order").default(0).notNull(),
    isCompleted: boolean("is_completed").default(false).notNull(),
    completedBy: uuid("completed_by").references(() => users.id),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("task_checklist_items_tenant_checklist_order_idx").on(
      table.organizationId,
      table.workspaceId,
      table.checklistId,
      table.deletedAt,
      table.order,
    ),
    check(
      "task_checklist_items_completion_check",
      sql`(${table.isCompleted} = false and ${table.completedAt} is null and ${table.completedBy} is null) or (${table.isCompleted} = true and ${table.completedAt} is not null)`,
    ),
  ],
);

export const taskApprovalRequests = pgTable(
  "task_approval_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    projectId: uuid("project_id")
      .references(() => projects.id, { onDelete: "cascade" })
      .notNull(),
    taskId: uuid("task_id")
      .references(() => tasks.id, { onDelete: "cascade" })
      .notNull(),
    requestedBy: uuid("requested_by")
      .references(() => users.id)
      .notNull(),
    mode: taskApprovalModeEnum("mode").default("all").notNull(),
    status: taskApprovalStatusEnum("status").default("pending").notNull(),
    message: text("message"),
    dueAt: timestamp("due_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("task_approval_requests_task_pending_unique")
      .on(table.taskId)
      .where(sql`${table.status} = 'pending' and ${table.deletedAt} is null`),
    index("task_approval_requests_tenant_task_status_idx").on(
      table.organizationId,
      table.workspaceId,
      table.taskId,
      table.status,
      table.deletedAt,
    ),
    check(
      "task_approval_requests_resolution_check",
      sql`(${table.status} = 'pending' and ${table.resolvedAt} is null) or (${table.status} <> 'pending' and ${table.resolvedAt} is not null)`,
    ),
  ],
);

export const taskApprovalReviewers = pgTable(
  "task_approval_reviewers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    workspaceId: uuid("workspace_id")
      .references(() => workspaces.id, { onDelete: "cascade" })
      .notNull(),
    projectId: uuid("project_id")
      .references(() => projects.id, { onDelete: "cascade" })
      .notNull(),
    taskId: uuid("task_id")
      .references(() => tasks.id, { onDelete: "cascade" })
      .notNull(),
    approvalRequestId: uuid("approval_request_id")
      .references(() => taskApprovalRequests.id, { onDelete: "cascade" })
      .notNull(),
    reviewerId: uuid("reviewer_id")
      .references(() => users.id)
      .notNull(),
    sequence: integer("sequence").default(0).notNull(),
    status: taskApprovalReviewerStatusEnum("status").default("pending").notNull(),
    comment: text("comment"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("task_approval_reviewers_request_user_active_unique")
      .on(table.approvalRequestId, table.reviewerId)
      .where(sql`${table.deletedAt} is null`),
    uniqueIndex("task_approval_reviewers_request_sequence_active_unique")
      .on(table.approvalRequestId, table.sequence)
      .where(sql`${table.deletedAt} is null`),
    index("task_approval_reviewers_tenant_reviewer_status_idx").on(
      table.organizationId,
      table.workspaceId,
      table.reviewerId,
      table.status,
      table.deletedAt,
    ),
    check("task_approval_reviewers_sequence_check", sql`${table.sequence} >= 0`),
    check(
      "task_approval_reviewers_decision_check",
      sql`(${table.status} = 'pending' and ${table.decidedAt} is null) or (${table.status} <> 'pending' and ${table.decidedAt} is not null)`,
    ),
  ],
);
