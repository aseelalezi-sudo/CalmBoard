import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { Pool, type PoolClient } from "pg";
import type { Readable } from "node:stream";
import JSZip from "jszip";
import {
  claimWorkspaceExportBatch,
  cleanupExpiredExports,
  processWorkspaceExports,
  readWorkspaceExportOptions,
  type WorkspaceExportCandidate,
} from "./workspace-exports.js";

const candidate: WorkspaceExportCandidate = {
  id: "export-1",
  organizationId: "organization-1",
  workspaceId: "workspace-1",
  exportScope: "workspace",
  requestedBy: "user-1",
  attempt: 1,
  maxAttempts: 5,
  claimToken: "claim-1",
  format: "json",
  reportScheduleId: null,
  scheduledFor: null,
};

describe("workspace export worker", () => {
  it("validates bounded processing options", () => {
    assert.deepEqual(
      readWorkspaceExportOptions({
        WORKSPACE_EXPORT_BATCH_SIZE: "10",
        WORKSPACE_EXPORT_CLAIM_TIMEOUT_MINUTES: "20",
        WORKSPACE_EXPORT_RETENTION_DAYS: "14",
      }),
      { batchSize: 10, claimTimeoutMinutes: 20, retentionDays: 14, organizationPageSize: 500, cleanupBatchSize: 25 },
    );
    assert.throws(() => readWorkspaceExportOptions({ WORKSPACE_EXPORT_BATCH_SIZE: "0" }), /between 1 and 50/);
    assert.throws(() => readWorkspaceExportOptions({ WORKSPACE_EXPORT_RETENTION_DAYS: "91" }), /between 1 and 90/);
  });

  it("claims due jobs with skip-locked recovery", async () => {
    const statements: string[] = [];
    const client = {
      async query(statement: string) {
        statements.push(statement);
        return statement.startsWith("with candidates")
          ? {
              rows: [
                {
                  id: candidate.id,
                  organization_id: candidate.organizationId,
                  workspace_id: candidate.workspaceId,
                  export_scope: candidate.exportScope,
                  requested_by: candidate.requestedBy,
                  attempts: candidate.attempt,
                  max_attempts: candidate.maxAttempts,
                  claim_token: candidate.claimToken,
                  format: candidate.format,
                },
              ],
            }
          : { rows: [] };
      },
    } as unknown as PoolClient;

    assert.deepEqual(
      await claimWorkspaceExportBatch(client, {
        batchSize: 5,
        claimTimeoutMinutes: 30,
        retentionDays: 7,
        organizationPageSize: 500,
        cleanupBatchSize: 25,
      }),
      [candidate],
    );
    assert.equal(statements[0], "begin");
    assert.match(statements[1] ?? "", /for update skip locked/);
    assert.match(statements[1] ?? "", /gen_random_uuid/);
    assert.equal(statements[2], "commit");
  });

  it("deletes only generated export artifacts and records bounded idempotent cleanup", async () => {
    const generatedKeys = [
      "organizations/org-1/exports/export-1.zip",
      "organizations/org-1/workspaces/workspace-1/exports/export-2.pdf",
    ];
    const updates: Array<{ text: string; values: unknown[] }> = [];
    const client = {
      async query(text: string, values: unknown[]) {
        assert.match(text, /expires_at <= now\(\)/);
        assert.match(text, /limit \$1/);
        assert.deepEqual(values, [2]);
        return {
          rows: [
            {
              id: "export-1",
              organization_id: "org-1",
              workspace_id: null,
              export_scope: "organization",
              format: "json",
              status: "completed",
              object_key: generatedKeys[0],
            },
            {
              id: "export-2",
              organization_id: "org-1",
              workspace_id: "workspace-1",
              export_scope: "workspace",
              format: "pdf",
              status: "dead",
              object_key: null,
            },
          ],
        };
      },
      release() {},
    };
    const pool = {
      async connect() {
        return client;
      },
      async query(text: string, values: unknown[]) {
        updates.push({ text, values });
        return { rowCount: 1, rows: [] };
      },
    } as unknown as Pool;
    const deleted: string[] = [];
    const result = await cleanupExpiredExports(
      pool,
      {
        async deleteObject(key) {
          deleted.push(key);
        },
        async objectExists() {
          return false;
        },
      },
      { cleanupBatchSize: 2 },
    );
    assert.deepEqual(result, { selected: 2, cleaned: 2, failed: 0 });
    assert.deepEqual(deleted, generatedKeys);
    assert.equal(
      deleted.some((key) => key.includes("attachments/")),
      false,
    );
    assert.equal(updates.length, 2);
    assert.ok(updates.every((entry) => entry.text.includes("[artifact-cleaned]")));
  });

  it("keeps a cleanup candidate retryable when object absence cannot be verified", async () => {
    const updates: string[] = [];
    const pool = {
      async connect() {
        return {
          async query() {
            return {
              rows: [
                {
                  id: "export-1",
                  organization_id: "org-1",
                  workspace_id: null,
                  export_scope: "organization",
                  format: "json",
                  status: "completed",
                  object_key: "organizations/org-1/exports/export-1.zip",
                },
              ],
            };
          },
          release() {},
        };
      },
      async query(text: string) {
        updates.push(text);
        return { rowCount: 1, rows: [] };
      },
    } as unknown as Pool;
    const result = await cleanupExpiredExports(
      pool,
      {
        async deleteObject() {},
        async objectExists() {
          return true;
        },
      },
      { cleanupBatchSize: 1 },
    );
    assert.deepEqual(result, { selected: 1, cleaned: 0, failed: 1 });
    assert.match(updates[0] ?? "", /Artifact cleanup failed|last_error/);
    assert.doesNotMatch(updates[0] ?? "", /\[artifact-cleaned\]/);
  });

  it(
    "creates one tenant-scoped archive and completes the durable job exactly once",
    { skip: !process.env.DATABASE_MAINTENANCE_URL },
    async () => {
      const pool = new Pool({ connectionString: process.env.DATABASE_MAINTENANCE_URL, max: 3 });
      const userId = randomUUID();
      const organizationId = randomUUID();
      const workspaceId = randomUUID();
      const secondWorkspaceId = randomUUID();
      const projectId = randomUUID();
      const deletedProjectId = randomUUID();
      const taskId = randomUUID();
      const scheduleId = randomUUID();
      const attachmentId = randomUUID();
      const integrationCredentialId = randomUUID();
      const attachmentReference = "s3://test-private/fixtures/export-attachment.txt";
      const attachmentBody = Buffer.from("CalmBoard portability attachment", "utf8");
      const forbiddenCiphertext = "FORBIDDEN-INTEGRATION-CIPHERTEXT";
      const exportJobs = [
        { id: randomUUID(), format: "json", scheduleId: null, exportScope: "workspace", workspaceId },
        { id: randomUUID(), format: "pdf", scheduleId, exportScope: "workspace", workspaceId },
        { id: randomUUID(), format: "xlsx", scheduleId: null, exportScope: "workspace", workspaceId },
        { id: randomUUID(), format: "json", scheduleId: null, exportScope: "organization", workspaceId: null },
      ] as const;
      const stored = new Map<string, Buffer>();
      const puts: Array<{ key: string; contentType: string }> = [];
      try {
        await pool.query("insert into users (id, email, name) values ($1, $2, 'Export actor')", [
          userId,
          `export-${userId}@example.test`,
        ]);
        await pool.query("insert into organizations (id, name, slug, owner_id) values ($1, 'Export tenant', $2, $3)", [
          organizationId,
          `export-${organizationId}`,
          userId,
        ]);
        await pool.query(
          "insert into workspaces (id, organization_id, name, slug) values ($1, $2, 'Export workspace', $3)",
          [workspaceId, organizationId, `export-${workspaceId}`],
        );
        await pool.query(
          "insert into workspaces (id, organization_id, name, slug) values ($1, $2, 'Second workspace', $3)",
          [secondWorkspaceId, organizationId, `export-${secondWorkspaceId}`],
        );
        await pool.query(
          "insert into memberships (user_id, organization_id, workspace_id, role, status) values ($1, $2, null, 'owner', 'active')",
          [userId, organizationId],
        );
        await pool.query(
          "insert into projects (id, organization_id, workspace_id, name, owner_id) values ($1, $2, $3, 'Active project', $4)",
          [projectId, organizationId, workspaceId, userId],
        );
        await pool.query(
          `insert into projects (id, organization_id, workspace_id, name, owner_id, deleted_at)
           values ($1, $2, $3, 'Deleted project', $4, now())`,
          [deletedProjectId, organizationId, workspaceId, userId],
        );
        await pool.query(
          `insert into tasks (
             id, organization_id, workspace_id, project_id, title, serial, reporter_id
           ) values ($1, $2, $3, $4, 'Exported task', $5, $6)`,
          [taskId, organizationId, workspaceId, projectId, `EXP-${taskId.slice(0, 8)}`, userId],
        );
        await pool.query(
          `insert into attachments
            (id, organization_id, workspace_id, task_id, uploader_id, file_name, file_size, mime_type, url, scan_status)
           values ($1, $2, $3, $4, $5, 'export-attachment.txt', $6, 'text/plain', $7, 'clean')`,
          [attachmentId, organizationId, workspaceId, taskId, userId, attachmentBody.byteLength, attachmentReference],
        );
        await pool.query(
          `insert into integration_credentials
            (id, organization_id, workspace_id, provider, credential_key, display_name, auth_type,
             encrypted_payload, initialization_vector, authentication_tag, secret_fingerprint, created_by)
           values ($1, $2, $3, 'github', 'default', 'GitHub test', 'oauth2', $4, 'AAAAAAAAAAAAAAAA',
                   'BBBBBBBBBBBBBBBB', $5, $6)`,
          [integrationCredentialId, organizationId, workspaceId, forbiddenCiphertext, "c".repeat(64), userId],
        );
        await pool.query(
          `insert into report_schedules (
             id, organization_id, workspace_id, created_by, name, format, cadence, timezone,
             minute_of_day, next_run_at
           ) values ($1, $2, $3, $4, 'Weekly PDF', 'pdf', 'daily', 'UTC', 480, now() + interval '1 day')`,
          [scheduleId, organizationId, workspaceId, userId],
        );
        await pool.query(
          `insert into report_schedule_recipients (
             organization_id, workspace_id, schedule_id, user_id
           ) values ($1, $2, $3, $4)`,
          [organizationId, workspaceId, scheduleId, userId],
        );
        for (const exportJob of exportJobs) {
          await pool.query(
            `insert into export_jobs (
               id, organization_id, workspace_id, export_scope, requested_by, format, idempotency_key,
               report_schedule_id, scheduled_for, available_at
             ) values ($1, $2, $3, $4, $5, $6, $7, $8,
                       case when $8::uuid is null then null else now() end, timestamp '2000-01-01')`,
            [
              exportJob.id,
              organizationId,
              exportJob.workspaceId,
              exportJob.exportScope,
              userId,
              exportJob.format,
              `workspace-export-test/${exportJob.id}`,
              exportJob.scheduleId,
            ],
          );
        }

        const storage = {
          async putObject(key: string, body: Uint8Array | Readable, contentType: string) {
            let bytes: Buffer;
            if (body instanceof Uint8Array) bytes = Buffer.from(body);
            else {
              const chunks: Buffer[] = [];
              for await (const chunk of body) chunks.push(Buffer.from(chunk));
              bytes = Buffer.concat(chunks);
            }
            puts.push({ key, contentType });
            stored.set(key, bytes);
          },
          async getReference(reference: string) {
            assert.equal(reference, attachmentReference);
            return attachmentBody;
          },
        };
        const options = {
          batchSize: 4,
          claimTimeoutMinutes: 30,
          retentionDays: 7,
          organizationPageSize: 500,
          cleanupBatchSize: 25,
        };
        const firstRun = await processWorkspaceExports(pool, storage, options);
        const exportErrors =
          firstRun.failed > 0
            ? await pool.query<{ format: string; last_error: string | null }>(
                `select format, last_error
                 from export_jobs
                 where organization_id = $1
                 order by format`,
                [organizationId],
              )
            : undefined;
        assert.deepEqual(
          firstRun,
          {
            claimed: 4,
            completed: 4,
            failed: 0,
          },
          exportErrors ? JSON.stringify(exportErrors.rows) : "workspace exports should complete",
        );
        assert.equal(puts.length, 4);
        const jsonPut = puts.find((put) => put.key.includes(`/workspaces/${workspaceId}/`) && put.key.endsWith(".zip"));
        const organizationPut = puts.find(
          (put) => put.key === `organizations/${organizationId}/exports/${exportJobs[3].id}.zip`,
        );
        const pdfPut = puts.find((put) => put.key.endsWith(".pdf"));
        const xlsxPut = puts.find((put) => put.key.endsWith(".xlsx"));
        assert.ok(jsonPut && organizationPut && pdfPut && xlsxPut);
        assert.equal(stored.get(jsonPut.key)?.subarray(0, 2).toString("ascii"), "PK");
        assert.equal(jsonPut.contentType, "application/zip");
        const zip = await JSZip.loadAsync(stored.get(jsonPut.key)!);
        const manifest = JSON.parse(await zip.file("manifest.json")!.async("string")) as {
          archiveType: string;
          schemaVersion: string;
          scope: string;
          attachmentCount: number;
        };
        assert.deepEqual(
          {
            archiveType: manifest.archiveType,
            schemaVersion: manifest.schemaVersion,
            scope: manifest.scope,
            attachmentCount: manifest.attachmentCount,
          },
          { archiveType: "calmboard-portability", schemaVersion: "1.0.0", scope: "workspace", attachmentCount: 1 },
        );
        const exportedProjects = JSON.parse(await zip.file("projects/projects.json")!.async("string")) as Array<{
          id: string;
        }>;
        const exportedTasks = JSON.parse(await zip.file("tasks/tasks.json")!.async("string")) as Array<{ id: string }>;
        assert.deepEqual(exportedProjects.map((project) => project.id).sort(), [deletedProjectId, projectId].sort());
        assert.deepEqual(
          exportedTasks.map((task) => task.id),
          [taskId],
        );
        assert.deepEqual(
          Buffer.from(
            await zip.file(`attachments/${attachmentId}/original-export-attachment.txt`)!.async("uint8array"),
          ),
          attachmentBody,
        );
        const allJson = (
          await Promise.all(
            Object.values(zip.files)
              .filter((entry) => !entry.dir && entry.name.endsWith(".json"))
              .map((entry) => entry.async("string")),
          )
        ).join("\n");
        assert.equal(allJson.includes(forbiddenCiphertext), false);
        assert.equal(allJson.includes(attachmentReference), false);
        const organizationZip = await JSZip.loadAsync(stored.get(organizationPut.key)!);
        const organizationManifest = JSON.parse(await organizationZip.file("manifest.json")!.async("string")) as {
          scope: string;
          workspaceCount: number;
          resourceBehavior: { archive: string };
        };
        assert.equal(organizationManifest.scope, "organization");
        assert.equal(organizationManifest.workspaceCount, 2);
        assert.match(organizationManifest.resourceBehavior.archive, /not held in memory/);
        assert.ok(organizationZip.file(`workspaces/${workspaceId}/projects/projects.json`));
        assert.ok(organizationZip.file(`workspaces/${secondWorkspaceId}/workspace.json`));
        const organizationJson = (
          await Promise.all(
            Object.values(organizationZip.files)
              .filter((entry) => !entry.dir && entry.name.endsWith(".json"))
              .map((entry) => entry.async("string")),
          )
        ).join("\n");
        assert.equal(organizationJson.includes(forbiddenCiphertext), false);
        assert.equal(organizationJson.includes(attachmentReference), false);
        assert.equal(stored.get(pdfPut.key)?.subarray(0, 5).toString("ascii"), "%PDF-");
        assert.equal(stored.get(xlsxPut.key)?.subarray(0, 2).toString("ascii"), "PK");
        assert.equal(pdfPut.contentType, "application/pdf");
        assert.equal(xlsxPut.contentType, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");

        const persisted = await pool.query<{
          format: string;
          status: string;
          attempts: number;
          object_key: string;
          content_type: string;
          file_size: string;
          checksum_sha256: string;
        }>(
          `select format, status, attempts, object_key, content_type, file_size::text, checksum_sha256
           from export_jobs
           where organization_id = $1
           order by format`,
          [organizationId],
        );
        assert.deepEqual(
          persisted.rows.map((row) => row.format),
          ["json", "json", "pdf", "xlsx"],
        );
        for (const row of persisted.rows) {
          assert.equal(row.status, "completed");
          assert.equal(row.attempts, 1);
          assert.equal(Number(row.file_size), stored.get(row.object_key)?.byteLength);
          assert.match(row.checksum_sha256, /^[a-f0-9]{64}$/);
        }
        const scheduledEmail = await pool.query<{
          attachment_object_key: string;
          attachment_file_name: string;
          attachment_content_type: string;
          status: string;
        }>(
          `select attachment_object_key, attachment_file_name, attachment_content_type, status
           from notification_email_outbox
           where organization_id = $1 and idempotency_key like 'scheduled-report-email/%'`,
          [organizationId],
        );
        assert.equal(scheduledEmail.rowCount, 1);
        assert.equal(scheduledEmail.rows[0]?.attachment_content_type, "application/pdf");
        assert.equal(scheduledEmail.rows[0]?.status, "pending");
      } finally {
        await pool.query("delete from notification_email_outbox where organization_id = $1", [organizationId]);
        await pool.query("delete from notifications where organization_id = $1", [organizationId]);
        await pool.query("delete from export_jobs where organization_id = $1", [organizationId]);
        await pool.query("delete from integration_credentials where organization_id = $1", [organizationId]);
        await pool.query("delete from attachments where organization_id = $1", [organizationId]);
        await pool.query("delete from tasks where organization_id = $1", [organizationId]);
        await pool.query("delete from projects where organization_id = $1", [organizationId]);
        await pool.query("delete from memberships where organization_id = $1", [organizationId]);
        await pool.query("delete from workspaces where organization_id = $1", [organizationId]);
        await pool.query("delete from organizations where id = $1", [organizationId]);
        await pool.query("delete from users where id = $1", [userId]);
        await pool.end();
      }
    },
  );
});
