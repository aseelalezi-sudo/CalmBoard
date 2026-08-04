import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { Pool, type PoolClient } from "pg";
import { enqueueScheduledReports, readScheduledReportOptions } from "./scheduled-reports.js";

describe("scheduled report dispatcher", () => {
  it("validates a bounded batch size", () => {
    assert.deepEqual(readScheduledReportOptions({ REPORT_SCHEDULE_BATCH_SIZE: "50" }), { batchSize: 50 });
    assert.throws(() => readScheduledReportOptions({ REPORT_SCHEDULE_BATCH_SIZE: "0" }));
    assert.throws(() => readScheduledReportOptions({ REPORT_SCHEDULE_BATCH_SIZE: "201" }));
  });

  it("enqueues each due occurrence with a deterministic idempotency key", async () => {
    const scheduledFor = new Date("2026-08-03T05:00:00.000Z");
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        if (text.includes("from report_schedules") && text.includes("for update skip locked")) {
          return {
            rowCount: 1,
            rows: [
              {
                id: "schedule-1",
                organization_id: "organization-1",
                workspace_id: "workspace-1",
                created_by: "user-1",
                format: "pdf",
                cadence: "weekly",
                timezone: "Asia/Riyadh",
                minute_of_day: 480,
                day_of_week: 1,
                day_of_month: null,
                next_run_at: scheduledFor,
              },
            ],
          };
        }
        if (text.includes("insert into export_jobs")) return { rowCount: 1, rows: [{ id: "export-1" }] };
        return { rowCount: null, rows: [] };
      },
      release() {},
    } as unknown as PoolClient;
    const pool = {
      async connect() {
        return client;
      },
    } as unknown as Pool;
    assert.deepEqual(await enqueueScheduledReports(pool, { batchSize: 5 }), { claimed: 1, enqueued: 1 });
    const insert = queries.find((query) => query.text.includes("insert into export_jobs"));
    assert.equal(insert?.values?.[6], `scheduled-report/schedule-1/${scheduledFor.toISOString()}`);
    assert.ok(queries.some((query) => query.text === "commit"));
  });

  it(
    "creates one durable export for a due tenant schedule",
    { skip: !process.env.DATABASE_MAINTENANCE_URL },
    async () => {
      const pool = new Pool({ connectionString: process.env.DATABASE_MAINTENANCE_URL, max: 4 });
      const userId = randomUUID();
      const organizationId = randomUUID();
      const workspaceId = randomUUID();
      const scheduleId = randomUUID();
      try {
        await pool.query("insert into users (id, email, name) values ($1, $2, 'Schedule owner')", [
          userId,
          `schedule-${userId}@example.test`,
        ]);
        await pool.query("insert into organizations (id, name, slug, owner_id) values ($1, 'Schedule org', $2, $3)", [
          organizationId,
          `schedule-${organizationId}`,
          userId,
        ]);
        await pool.query(
          "insert into workspaces (id, organization_id, name, slug) values ($1, $2, 'Schedule workspace', $3)",
          [workspaceId, organizationId, `schedule-${workspaceId}`],
        );
        await pool.query(
          "insert into memberships (user_id, organization_id, workspace_id, status) values ($1, $2, $3, 'active')",
          [userId, organizationId, workspaceId],
        );
        await pool.query(
          `insert into report_schedules (
           id, organization_id, workspace_id, created_by, name, format, cadence, timezone,
           minute_of_day, next_run_at
         ) values ($1, $2, $3, $4, 'Daily PDF', 'pdf', 'daily', 'UTC', 480, now() - interval '1 minute')`,
          [scheduleId, organizationId, workspaceId, userId],
        );

        assert.deepEqual(await enqueueScheduledReports(pool, { batchSize: 5 }), { claimed: 1, enqueued: 1 });
        assert.deepEqual(await enqueueScheduledReports(pool, { batchSize: 5 }), { claimed: 0, enqueued: 0 });
        const result = await pool.query<{
          report_schedule_id: string;
          requested_by: string;
          format: string;
          status: string;
          scheduled_for: Date;
        }>(
          `select report_schedule_id, requested_by, format, status, scheduled_for
         from export_jobs where report_schedule_id = $1`,
          [scheduleId],
        );
        assert.equal(result.rowCount, 1);
        assert.equal(result.rows[0]?.requested_by, userId);
        assert.equal(result.rows[0]?.format, "pdf");
        assert.equal(result.rows[0]?.status, "pending");
      } finally {
        await pool.query("delete from export_jobs where organization_id = $1", [organizationId]).catch(() => undefined);
        await pool
          .query("delete from report_schedules where organization_id = $1", [organizationId])
          .catch(() => undefined);
        await pool.query("delete from memberships where organization_id = $1", [organizationId]).catch(() => undefined);
        await pool.query("delete from workspaces where id = $1", [workspaceId]).catch(() => undefined);
        await pool.query("delete from organizations where id = $1", [organizationId]).catch(() => undefined);
        await pool.query("delete from users where id = $1", [userId]).catch(() => undefined);
        await pool.end();
      }
    },
  );
});
