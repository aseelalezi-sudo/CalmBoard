import { createHash } from "node:crypto";
import JSZip from "jszip";
import type { PoolClient } from "pg";

export type PortabilityExportStorage = {
  getReference(reference: string): Promise<Uint8Array>;
};

type ExportJobScope = { id: string; organizationId: string; workspaceId: string };

const sensitiveKey =
  /(password|secret|credential|token|authorization|cookie|session|encrypted|encryption.?key|authentication.?tag|initialization.?vector|fingerprint|endpoint.?key.?hash|claim.?token|mfa|oauth|signed.?url|source.?url|worker.?payload|outbox.?payload)/i;

export function sanitizeNested(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeNested);
  if (!value || typeof value !== "object") {
    if (typeof value === "string" && /^https?:\/\//i.test(value)) {
      try {
        const url = new URL(value);
        url.search = "";
        url.hash = "";
        return url.toString();
      } catch {
        return value;
      }
    }
    return value;
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !sensitiveKey.test(key))
      .map(([key, entry]) => [key, sanitizeNested(entry)]),
  );
}

export function assertPortabilitySecretExclusion(value: unknown) {
  const visit = (entry: unknown, path: string) => {
    if (Array.isArray(entry)) return entry.forEach((item, index) => visit(item, `${path}[${index}]`));
    if (!entry || typeof entry !== "object") return;
    for (const [key, child] of Object.entries(entry as Record<string, unknown>)) {
      if (sensitiveKey.test(key)) throw new Error(`PORTABILITY_SECRET_FIELD:${path}.${key}`);
      visit(child, `${path}.${key}`);
    }
  };
  visit(value, "$export");
}

export type InventoryEntry = {
  file: string;
  table: string;
  columns: readonly string[];
  scope: "workspace" | "organization" | "organization-workspace-optional" | "role-permission";
};

// This is the authoritative, closed projection inventory. No SELECT * is allowed.
export const workspacePortabilityInventory: readonly InventoryEntry[] = [
  {
    file: "teams/teams.json",
    table: "teams",
    scope: "workspace",
    columns: ["id", "name", "description", "color", "created_at", "updated_at", "deleted_at"],
  },
  {
    file: "memberships/memberships.json",
    table: "memberships",
    scope: "organization-workspace-optional",
    columns: ["id", "user_id", "workspace_id", "team_id", "role", "status", "joined_at"],
  },
  {
    file: "memberships/roles.json",
    table: "roles",
    scope: "organization",
    columns: ["id", "key", "name", "description", "is_system", "created_by", "created_at", "updated_at", "deleted_at"],
  },
  {
    file: "memberships/role-permissions.json",
    table: "role_permissions",
    scope: "role-permission",
    columns: ["id", "role_id", "permission_id", "created_at"],
  },
  {
    file: "memberships/role-bindings.json",
    table: "membership_role_bindings",
    scope: "workspace",
    columns: [
      "id",
      "project_id",
      "membership_id",
      "role_id",
      "scope",
      "is_primary",
      "created_by",
      "created_at",
      "updated_at",
    ],
  },
  {
    file: "memberships/permission-overrides.json",
    table: "membership_permission_overrides",
    scope: "workspace",
    columns: [
      "id",
      "project_id",
      "membership_id",
      "permission_id",
      "scope",
      "effect",
      "reason",
      "created_by",
      "created_at",
      "updated_at",
    ],
  },
  {
    file: "projects/projects.json",
    table: "projects",
    scope: "workspace",
    columns: [
      "id",
      "name",
      "description",
      "color",
      "icon",
      "status",
      "priority",
      "owner_id",
      "manager_id",
      "start_date",
      "end_date",
      "privacy",
      "progress",
      "budget",
      "estimated_hours",
      "logged_hours",
      "cover_url",
      "template",
      "version",
      "created_at",
      "updated_at",
      "deleted_at",
    ],
  },
  {
    file: "projects/sections.json",
    table: "project_sections",
    scope: "workspace",
    columns: ["id", "project_id", "name", "order", "color", "created_at", "updated_at", "deleted_at"],
  },
  {
    file: "projects/members.json",
    table: "project_members",
    scope: "workspace",
    columns: ["id", "project_id", "user_id", "role", "is_owner", "added_by", "joined_at", "updated_at", "deleted_at"],
  },
  {
    file: "projects/teams.json",
    table: "project_teams",
    scope: "workspace",
    columns: ["id", "project_id", "team_id", "added_by", "added_at", "deleted_at"],
  },
  {
    file: "projects/custom-fields.json",
    table: "custom_fields",
    scope: "workspace",
    columns: [
      "id",
      "project_id",
      "name",
      "key",
      "type",
      "description",
      "options",
      "required",
      "sensitive",
      "order",
      "created_by_id",
      "created_at",
      "updated_at",
      "deleted_at",
    ],
  },
  {
    file: "tasks/tasks.json",
    table: "tasks",
    scope: "workspace",
    columns: [
      "id",
      "project_id",
      "section_id",
      "parent_id",
      "serial",
      "title",
      "description",
      "status",
      "priority",
      "assignee_id",
      "reporter_id",
      "due_date",
      "start_date",
      "estimated_hours",
      "logged_hours",
      "progress",
      "order",
      "tags",
      "custom_fields",
      "is_recurring",
      "story_points",
      "timezone",
      "delay_reason",
      "version",
      "is_milestone",
      "sprint_id",
      "created_at",
      "updated_at",
      "deleted_at",
    ],
  },
  {
    file: "tasks/assignees.json",
    table: "task_assignees",
    scope: "workspace",
    columns: ["id", "project_id", "task_id", "user_id", "is_primary", "assigned_by", "assigned_at", "unassigned_at"],
  },
  {
    file: "tasks/followers.json",
    table: "task_followers",
    scope: "workspace",
    columns: ["id", "project_id", "task_id", "user_id", "followed_at", "unfollowed_at"],
  },
  {
    file: "tasks/dependencies.json",
    table: "task_dependencies",
    scope: "workspace",
    columns: [
      "id",
      "blocking_task_id",
      "dependent_task_id",
      "type",
      "lag_minutes",
      "created_by",
      "created_at",
      "deleted_at",
    ],
  },
  {
    file: "tasks/relations.json",
    table: "task_relations",
    scope: "workspace",
    columns: ["id", "source_task_id", "target_task_id", "type", "created_by", "created_at", "deleted_at"],
  },
  {
    file: "tasks/recurrence.json",
    table: "task_recurrence_rules",
    scope: "workspace",
    columns: [
      "id",
      "project_id",
      "task_id",
      "frequency",
      "interval",
      "timezone",
      "weekdays",
      "month_day",
      "starts_at",
      "ends_at",
      "max_occurrences",
      "occurrences_created",
      "next_occurrence_at",
      "last_occurrence_at",
      "status",
      "created_by",
      "created_at",
      "updated_at",
      "deleted_at",
    ],
  },
  {
    file: "tasks/reminders.json",
    table: "task_reminders",
    scope: "workspace",
    columns: [
      "id",
      "project_id",
      "task_id",
      "external_id",
      "remind_at",
      "label",
      "status",
      "sent_at",
      "failure_reason",
      "created_by",
      "created_at",
      "updated_at",
      "deleted_at",
    ],
  },
  {
    file: "tasks/checklists.json",
    table: "task_checklists",
    scope: "workspace",
    columns: ["id", "project_id", "task_id", "title", "order", "created_by", "created_at", "updated_at", "deleted_at"],
  },
  {
    file: "tasks/checklist-items.json",
    table: "task_checklist_items",
    scope: "workspace",
    columns: [
      "id",
      "project_id",
      "task_id",
      "checklist_id",
      "title",
      "order",
      "is_completed",
      "completed_by",
      "completed_at",
      "created_by",
      "created_at",
      "updated_at",
      "deleted_at",
    ],
  },
  {
    file: "tasks/approval-requests.json",
    table: "task_approval_requests",
    scope: "workspace",
    columns: [
      "id",
      "project_id",
      "task_id",
      "requested_by",
      "mode",
      "status",
      "message",
      "due_at",
      "resolved_at",
      "created_at",
      "updated_at",
      "deleted_at",
    ],
  },
  {
    file: "tasks/approval-reviewers.json",
    table: "task_approval_reviewers",
    scope: "workspace",
    columns: [
      "id",
      "project_id",
      "task_id",
      "approval_request_id",
      "reviewer_id",
      "sequence",
      "status",
      "comment",
      "decided_at",
      "created_at",
      "updated_at",
      "deleted_at",
    ],
  },
  {
    file: "comments/comments.json",
    table: "comments",
    scope: "workspace",
    columns: [
      "id",
      "task_id",
      "user_id",
      "content",
      "parent_id",
      "reactions",
      "is_pinned",
      "created_at",
      "updated_at",
      "deleted_at",
    ],
  },
  {
    file: "comments/mentions.json",
    table: "comment_mentions",
    scope: "workspace",
    columns: ["id", "project_id", "task_id", "comment_id", "mentioned_user_id", "created_at"],
  },
  {
    file: "documents/documents.json",
    table: "docs",
    scope: "workspace",
    columns: [
      "id",
      "project_id",
      "parent_id",
      "title",
      "content",
      "author_id",
      "icon",
      "is_public",
      "workspace_access",
      "inherit_permissions",
      "created_at",
      "updated_at",
      "deleted_at",
    ],
  },
  {
    file: "documents/versions.json",
    table: "doc_versions",
    scope: "workspace",
    columns: ["id", "doc_id", "title", "content", "version_number", "saved_by_id", "created_at"],
  },
  {
    file: "documents/permissions.json",
    table: "document_permissions",
    scope: "workspace",
    columns: ["id", "doc_id", "user_id", "access_level", "granted_by_id", "created_at", "updated_at"],
  },
  {
    file: "forms/forms.json",
    table: "forms",
    scope: "workspace",
    columns: [
      "id",
      "project_id",
      "name",
      "description",
      "fields",
      "settings",
      "responses",
      "is_active",
      "created_at",
      "updated_at",
      "deleted_at",
    ],
  },
  {
    file: "forms/responses.json",
    table: "form_responses",
    scope: "workspace",
    columns: [
      "id",
      "form_id",
      "data",
      "created_task_id",
      "submitted_at",
      "task_creation_status",
      "task_creation_completed_at",
    ],
  },
  {
    file: "goals/goals.json",
    table: "goals",
    scope: "workspace",
    columns: [
      "id",
      "title",
      "description",
      "type",
      "parent_id",
      "progress",
      "status",
      "owner_id",
      "checkins",
      "period_start",
      "period_end",
      "progress_mode",
      "measurement_unit",
      "start_value",
      "current_value",
      "target_value",
      "weight",
      "created_at",
      "updated_at",
      "deleted_at",
    ],
  },
  {
    file: "goals/check-ins.json",
    table: "goal_checkins",
    scope: "workspace",
    columns: ["id", "goal_id", "progress", "current_value", "status", "note", "created_by_id", "created_at"],
  },
  {
    file: "goals/task-links.json",
    table: "goal_task_links",
    scope: "workspace",
    columns: ["id", "goal_id", "task_id", "weight", "created_by_id", "created_at"],
  },
  {
    file: "time/timesheets.json",
    table: "timesheets",
    scope: "workspace",
    columns: [
      "id",
      "user_id",
      "period_start",
      "period_end",
      "status",
      "submitted_at",
      "reviewed_by_id",
      "reviewed_at",
      "rejection_reason",
      "locked_at",
      "version",
      "created_at",
      "updated_at",
    ],
  },
  {
    file: "time/logs.json",
    table: "time_logs",
    scope: "workspace",
    columns: [
      "id",
      "task_id",
      "user_id",
      "timesheet_id",
      "description",
      "started_at",
      "ended_at",
      "duration_minutes",
      "billable",
      "created_at",
      "updated_at",
      "deleted_at",
    ],
  },
  {
    file: "automations/definitions.json",
    table: "automations",
    scope: "workspace",
    columns: [
      "id",
      "name",
      "trigger",
      "conditions",
      "actions",
      "enabled",
      "runs",
      "last_run_at",
      "created_at",
      "updated_at",
      "deleted_at",
    ],
  },
  {
    file: "sprints/sprints.json",
    table: "sprints",
    scope: "workspace",
    columns: [
      "id",
      "project_id",
      "name",
      "goal",
      "status",
      "starts_at",
      "ends_at",
      "started_at",
      "completed_at",
      "cancelled_at",
      "created_by",
      "created_at",
      "updated_at",
      "deleted_at",
    ],
  },
  {
    file: "sprints/assignment-history.json",
    table: "task_sprint_assignments",
    scope: "workspace",
    columns: [
      "id",
      "project_id",
      "task_id",
      "sprint_id",
      "assigned_at",
      "removed_at",
      "assigned_by",
      "created_at",
      "updated_at",
    ],
  },
  {
    file: "sprints/snapshots.json",
    table: "sprint_snapshots",
    scope: "workspace",
    columns: [
      "id",
      "project_id",
      "sprint_id",
      "snapshot_type",
      "data_quality",
      "scope_task_count",
      "scope_story_points",
      "completed_task_count",
      "completed_story_points",
      "remaining_task_count",
      "remaining_story_points",
      "captured_at",
      "created_at",
    ],
  },
  {
    file: "analytics/sprint-events.json",
    table: "sprint_analytics_events",
    scope: "workspace",
    columns: [
      "id",
      "project_id",
      "sprint_id",
      "task_id",
      "event_type",
      "story_points_at_event",
      "is_completed_at_event",
      "old_story_points",
      "new_story_points",
      "occurred_at",
      "actor_id",
      "event_sequence",
      "created_at",
    ],
  },
  {
    file: "reports/schedules.json",
    table: "report_schedules",
    scope: "workspace",
    columns: [
      "id",
      "created_by",
      "name",
      "format",
      "cadence",
      "timezone",
      "minute_of_day",
      "day_of_week",
      "day_of_month",
      "is_enabled",
      "next_run_at",
      "last_run_at",
      "version",
      "created_at",
      "updated_at",
      "deleted_at",
    ],
  },
  {
    file: "reports/recipients.json",
    table: "report_schedule_recipients",
    scope: "workspace",
    columns: ["id", "schedule_id", "user_id", "created_at"],
  },
  {
    file: "invitations/history.json",
    table: "invitations",
    scope: "organization-workspace-optional",
    columns: [
      "id",
      "workspace_id",
      "email",
      "role",
      "status",
      "invited_by",
      "created_at",
      "expires_at",
      "accepted_at",
      "accepted_by",
      "revoked_at",
      "declined_at",
      "last_sent_at",
      "updated_at",
    ],
  },
  {
    file: "integrations/credentials-metadata.json",
    table: "integration_credentials",
    scope: "workspace",
    columns: [
      "id",
      "provider",
      "credential_key",
      "display_name",
      "auth_type",
      "external_account_id",
      "scopes",
      "status",
      "expires_at",
      "last_used_at",
      "last_rotated_at",
      "revoked_at",
      "created_by",
      "created_at",
      "updated_at",
    ],
  },
  {
    file: "integrations/webhooks-metadata.json",
    table: "integration_webhook_endpoints",
    scope: "workspace",
    columns: ["id", "provider", "display_name", "status", "created_by", "revoked_at", "created_at", "updated_at"],
  },
] as const;

function queryFor(entry: InventoryEntry) {
  const projection = entry.columns.map((column) => `"${column}"`).join(", ");
  const where =
    entry.scope === "workspace"
      ? "organization_id = $1 and workspace_id = $2"
      : entry.scope === "organization"
        ? "organization_id = $1"
        : entry.scope === "organization-workspace-optional"
          ? "organization_id = $1 and (workspace_id = $2 or workspace_id is null)"
          : "role_id in (select id from roles where organization_id = $1)";
  return `select ${projection} from ${entry.table} where ${where} order by id`;
}

function json(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function safeFileName(value: string) {
  return (
    value
      .normalize("NFKC")
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .slice(0, 120) || "attachment"
  );
}

export async function createWorkspacePortabilityZip(
  client: PoolClient,
  job: ExportJobScope,
  storage: PortabilityExportStorage,
) {
  await client.query("begin isolation level repeatable read read only");
  try {
    const organization = await client.query(
      "select id, name, slug, owner_id, plan, seats, settings, created_at, updated_at from organizations where id = $1 and deleted_at is null",
      [job.organizationId],
    );
    const workspace = await client.query(
      "select id, organization_id, name, slug, color, icon, description, created_at, updated_at from workspaces where id = $2 and organization_id = $1 and deleted_at is null",
      [job.organizationId, job.workspaceId],
    );
    if (!organization.rowCount || !workspace.rowCount) throw new Error("Export workspace is unavailable");
    const users = await client.query(
      `select distinct account.id, account.name, account.email, account.avatar_url, account.locale
         from memberships membership join users account on account.id = membership.user_id
        where membership.organization_id = $1 and (membership.workspace_id = $2 or membership.workspace_id is null)
        order by account.id`,
      [job.organizationId, job.workspaceId],
    );
    const datasets: Array<{ file: string; records: unknown[] }> = [];
    for (const entry of workspacePortabilityInventory) {
      const parameters =
        entry.scope === "organization" || entry.scope === "role-permission"
          ? [job.organizationId]
          : [job.organizationId, job.workspaceId];
      const result = await client.query(queryFor(entry), parameters);
      datasets.push({ file: entry.file, records: sanitizeNested(result.rows) as unknown[] });
    }
    const attachmentRows = await client.query<{
      id: string;
      task_id: string | null;
      project_id: string | null;
      uploader_id: string;
      file_name: string;
      file_size: number;
      mime_type: string | null;
      url: string;
      preview_reference: string | null;
      preview_mime_type: string | null;
      created_at: Date;
      deleted_at: Date | null;
    }>(
      `select id, task_id, project_id, uploader_id, file_name, file_size, mime_type, url,
              preview_reference, preview_mime_type, created_at, deleted_at
         from attachments where organization_id = $1 and workspace_id = $2 order by id`,
      [job.organizationId, job.workspaceId],
    );
    const generatedAt = new Date().toISOString();
    const snapshot = {
      manifest: {
        archiveType: "calmboard-portability",
        schemaVersion: "1.0.0",
        exportId: job.id,
        scope: "workspace",
        organizationId: job.organizationId,
        workspaceId: job.workspaceId,
        generatedAt,
        consistency: {
          relational: "PostgreSQL REPEATABLE READ snapshot",
          binaries: "Object bytes are read after the relational snapshot commits and are individually checksummed",
        },
        inventory: workspacePortabilityInventory.map(({ file, table, columns }) => ({ file, table, columns })),
      },
      organization: organization.rows[0],
      workspace: workspace.rows[0],
      users: users.rows,
      datasets,
    };
    assertPortabilitySecretExclusion(snapshot);
    await client.query("commit");

    const zip = new JSZip();
    zip.file("organization.json", json(snapshot.organization));
    zip.file(`workspaces/${job.workspaceId}/workspace.json`, json(snapshot.workspace));
    zip.file(`workspaces/${job.workspaceId}/members.json`, json(snapshot.users));
    for (const dataset of snapshot.datasets) zip.file(dataset.file, json(dataset.records));

    const attachmentMetadata: Array<Record<string, unknown>> = [];
    for (const attachment of attachmentRows.rows) {
      const originalPath = `attachments/${attachment.id}/original-${safeFileName(attachment.file_name)}`;
      const original = Buffer.from(await storage.getReference(attachment.url));
      zip.file(originalPath, original, { binary: true });
      let previewPath: string | null = null;
      let previewChecksumSha256: string | null = null;
      if (attachment.preview_reference && attachment.preview_reference !== attachment.url) {
        previewPath = `attachments/${attachment.id}/preview`;
        const preview = Buffer.from(await storage.getReference(attachment.preview_reference));
        zip.file(previewPath, preview, { binary: true });
        previewChecksumSha256 = createHash("sha256").update(preview).digest("hex");
      }
      attachmentMetadata.push({
        id: attachment.id,
        taskId: attachment.task_id,
        projectId: attachment.project_id,
        uploaderId: attachment.uploader_id,
        fileName: attachment.file_name,
        declaredFileSize: attachment.file_size,
        mimeType: attachment.mime_type,
        createdAt: attachment.created_at,
        deletedAt: attachment.deleted_at,
        archivePath: originalPath,
        checksumSha256: createHash("sha256").update(original).digest("hex"),
        previewArchivePath: previewPath,
        previewMimeType: attachment.preview_mime_type,
        previewChecksumSha256,
      });
    }
    zip.file("attachments/metadata.json", json(attachmentMetadata));
    zip.file("manifest.json", json({ ...snapshot.manifest, attachmentCount: attachmentMetadata.length }));
    const body = await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    });
    return { body, workspaceSlug: String((snapshot.workspace as { slug?: unknown }).slug ?? job.workspaceId) };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  }
}
