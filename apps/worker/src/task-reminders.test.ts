import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { Pool, type PoolClient } from "pg";
import { dispatchDueTaskReminders, readTaskReminderOptions } from "./task-reminders.js";

describe("task reminder worker", () => {
  it("validates the reminder batch size", () => {
    assert.deepEqual(readTaskReminderOptions({ TASK_REMINDER_BATCH_SIZE: "25" }), { batchSize: 25 });
    assert.throws(() => readTaskReminderOptions({ TASK_REMINDER_BATCH_SIZE: "0" }), /between 1 and 1000/);
    assert.throws(() => readTaskReminderOptions({ TASK_REMINDER_BATCH_SIZE: "1.5" }), /integer/);
  });

  it("locks due reminders and commits notification creation with the sent state", async () => {
    const statements: string[] = [];
    const client = {
      async query(statement: string) {
        statements.push(statement);
        if (statement.startsWith("select reminder.id")) {
          return {
            rows: [
              {
                id: "reminder-1",
                organization_id: "organization-1",
                workspace_id: "workspace-1",
                task_id: "task-1",
                label: "Release review",
                task_title: "Ship release",
                task_serial: "CB-42",
              },
            ],
          };
        }
        if (statement.startsWith("with recipient_candidates")) {
          return { rows: [{ user_id: "user-1" }], rowCount: 1 };
        }
        return { rows: [], rowCount: 1 };
      },
      release() {},
    } as unknown as PoolClient;
    const pool = { connect: async () => client } as unknown as Pool;

    assert.deepEqual(await dispatchDueTaskReminders(pool, { batchSize: 10 }), {
      claimed: 1,
      sent: 1,
      failed: 0,
      notifications: 1,
    });
    assert.equal(statements[0], "begin");
    assert.match(statements[1] ?? "", /for update of reminder skip locked/);
    assert.match(statements[2] ?? "", /membership\.organization_id = \$2/);
    assert.match(statements[3] ?? "", /status = 'sent'/);
    assert.equal(statements[4], "commit");
  });

  it("rolls back the whole reminder and notification transaction on failure", async () => {
    const statements: string[] = [];
    const client = {
      async query(statement: string) {
        statements.push(statement);
        if (statement.startsWith("select reminder.id")) {
          return {
            rows: [
              {
                id: "reminder-1",
                organization_id: "organization-1",
                workspace_id: "workspace-1",
                task_id: "task-1",
                label: "Release review",
                task_title: "Ship release",
                task_serial: "CB-42",
              },
            ],
          };
        }
        if (statement.startsWith("with recipient_candidates")) throw new Error("temporary database error");
        return { rows: [] };
      },
      release() {},
    } as unknown as PoolClient;
    const pool = { connect: async () => client } as unknown as Pool;

    await assert.rejects(() => dispatchDueTaskReminders(pool, { batchSize: 10 }), /temporary database error/);
    assert.equal(statements.at(-1), "rollback");
  });

  it("is retry-safe after a committed reminder is no longer scheduled", async () => {
    let dispatchCount = 0;
    const client = {
      async query(statement: string) {
        if (statement.startsWith("select reminder.id")) return { rows: [] };
        if (statement.startsWith("with recipient_candidates")) dispatchCount += 1;
        return { rows: [] };
      },
      release() {},
    } as unknown as PoolClient;
    const pool = { connect: async () => client } as unknown as Pool;

    assert.deepEqual(await dispatchDueTaskReminders(pool, { batchSize: 10 }), {
      claimed: 0,
      sent: 0,
      failed: 0,
      notifications: 0,
    });
    assert.equal(dispatchCount, 0);
  });

  it(
    "delivers a tenant-scoped reminder exactly once in PostgreSQL",
    { skip: !process.env.DATABASE_MAINTENANCE_URL },
    async () => {
      const pool = new Pool({ connectionString: process.env.DATABASE_MAINTENANCE_URL, max: 2 });
      const reminderId = randomUUID();
      try {
        const target = await pool.query<{
          organization_id: string;
          workspace_id: string;
          project_id: string;
          task_id: string;
          user_id: string;
        }>(
          `select task.organization_id,
                  task.workspace_id,
                  task.project_id,
                  task.id as task_id,
                  membership.user_id
           from tasks task
           join memberships membership
             on membership.organization_id = task.organization_id
            and (membership.workspace_id = task.workspace_id or membership.workspace_id is null)
            and membership.status = 'active'
           where task.deleted_at is null
           order by task.created_at
           limit 1`,
        );
        assert.equal(target.rowCount, 1, "integration database must contain a seeded task and active member");
        const scope = target.rows[0]!;
        await pool.query(
          `insert into task_reminders (
             id, organization_id, workspace_id, project_id, task_id, external_id,
             remind_at, label, status, created_by
           ) values ($1::uuid, $2, $3, $4, $5, $1::text, now() - interval '1 minute', $6, 'scheduled', $7)`,
          [
            reminderId,
            scope.organization_id,
            scope.workspace_id,
            scope.project_id,
            scope.task_id,
            "Worker integration reminder",
            scope.user_id,
          ],
        );

        const firstRun = await dispatchDueTaskReminders(pool, { batchSize: 10 });
        assert.equal(firstRun.sent >= 1, true);
        const secondRun = await dispatchDueTaskReminders(pool, { batchSize: 10 });
        assert.equal(secondRun.claimed, 0);

        const reminder = await pool.query<{ status: string; sent_at: Date | null }>(
          "select status, sent_at from task_reminders where id = $1",
          [reminderId],
        );
        assert.equal(reminder.rows[0]?.status, "sent");
        assert.ok(reminder.rows[0]?.sent_at);

        const notifications = await pool.query<{ organization_id: string; workspace_id: string; user_id: string }>(
          `select organization_id, workspace_id, user_id
           from notifications
           where type = 'task_reminder' and entity_type = 'task_reminder' and entity_id = $1`,
          [reminderId],
        );
        assert.deepEqual(notifications.rows, [
          {
            organization_id: scope.organization_id,
            workspace_id: scope.workspace_id,
            user_id: scope.user_id,
          },
        ]);
      } finally {
        await pool.query(
          "delete from notifications where type = 'task_reminder' and entity_type = 'task_reminder' and entity_id = $1",
          [reminderId],
        );
        await pool.query("delete from task_reminders where id = $1", [reminderId]);
        await pool.end();
      }
    },
  );
});
