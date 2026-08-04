import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { Pool, type PoolClient } from "pg";
import {
  claimWorkspaceExportBatch,
  processWorkspaceExports,
  readWorkspaceExportOptions,
  type WorkspaceExportCandidate,
} from "./workspace-exports.js";

const candidate: WorkspaceExportCandidate = {
  id: "export-1",
  organizationId: "organization-1",
  workspaceId: "workspace-1",
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
      { batchSize: 10, claimTimeoutMinutes: 20, retentionDays: 14 },
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
      await claimWorkspaceExportBatch(client, { batchSize: 5, claimTimeoutMinutes: 30, retentionDays: 7 }),
      [candidate],
    );
    assert.equal(statements[0], "begin");
    assert.match(statements[1] ?? "", /for update skip locked/);
    assert.match(statements[1] ?? "", /gen_random_uuid/);
    assert.equal(statements[2], "commit");
  });

  it(
    "creates one tenant-scoped archive and completes the durable job exactly once",
    { skip: !process.env.DATABASE_MAINTENANCE_URL },
    async () => {
      const pool = new Pool({ connectionString: process.env.DATABASE_MAINTENANCE_URL, max: 3 });
      const userId = randomUUID();
      const organizationId = randomUUID();
      const workspaceId = randomUUID();
      const projectId = randomUUID();
      const deletedProjectId = randomUUID();
      const taskId = randomUUID();
      const scheduleId = randomUUID();
      const exportJobs = [
        { id: randomUUID(), format: "json", scheduleId: null },
        { id: randomUUID(), format: "pdf", scheduleId },
        { id: randomUUID(), format: "xlsx", scheduleId: null },
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
          "insert into memberships (user_id, organization_id, workspace_id, status) values ($1, $2, $3, 'active')",
          [userId, organizationId, workspaceId],
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
               id, organization_id, workspace_id, requested_by, format, idempotency_key,
               report_schedule_id, scheduled_for
             ) values ($1, $2, $3, $4, $5, $6, $7, case when $7::uuid is null then null else now() end)`,
            [
              exportJob.id,
              organizationId,
              workspaceId,
              userId,
              exportJob.format,
              `workspace-export-test/${exportJob.id}`,
              exportJob.scheduleId,
            ],
          );
        }

        const storage = {
          async putObject(key: string, body: Uint8Array, contentType: string) {
            puts.push({ key, contentType });
            stored.set(key, Buffer.from(body));
          },
        };
        const options = { batchSize: 5, claimTimeoutMinutes: 30, retentionDays: 7 };
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
            claimed: 3,
            completed: 3,
            failed: 0,
          },
          exportErrors ? JSON.stringify(exportErrors.rows) : "workspace exports should complete",
        );
        assert.deepEqual(await processWorkspaceExports(pool, storage, options), {
          claimed: 0,
          completed: 0,
          failed: 0,
        });

        assert.equal(puts.length, 3);
        const jsonPut = puts.find((put) => put.key.endsWith(".json"));
        const pdfPut = puts.find((put) => put.key.endsWith(".pdf"));
        const xlsxPut = puts.find((put) => put.key.endsWith(".xlsx"));
        assert.ok(jsonPut && pdfPut && xlsxPut);
        const archive = JSON.parse(stored.get(jsonPut.key)!.toString("utf8")) as {
          organizationId: string;
          workspace: { id: string };
          members: Array<{ user_id: string }>;
          projects: Array<{ id: string }>;
          tasks: Array<{ id: string }>;
        };
        assert.equal(archive.organizationId, organizationId);
        assert.equal(archive.workspace.id, workspaceId);
        assert.deepEqual(
          archive.members.map((member) => member.user_id),
          [userId],
        );
        assert.deepEqual(
          archive.projects.map((project) => project.id),
          [projectId],
        );
        assert.deepEqual(
          archive.tasks.map((task) => task.id),
          [taskId],
        );
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
          ["json", "pdf", "xlsx"],
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
        await pool.query("delete from tasks where organization_id = $1", [organizationId]);
        await pool.query("delete from projects where organization_id = $1", [organizationId]);
        await pool.query("delete from memberships where organization_id = $1", [organizationId]);
        await pool.query("delete from workspaces where id = $1", [workspaceId]);
        await pool.query("delete from organizations where id = $1", [organizationId]);
        await pool.query("delete from users where id = $1", [userId]);
        await pool.end();
      }
    },
  );
});
