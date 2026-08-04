import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { Pool, type PoolClient } from "pg";
import {
  claimAutomationEventBatch,
  enqueueDailyAutomationEvents,
  processAutomationEvents,
  readAutomationEventOptions,
  type AutomationEventCandidate,
} from "./automation-events.js";

const candidate: AutomationEventCandidate = {
  id: "event-1",
  organizationId: "organization-1",
  workspaceId: "workspace-1",
  taskId: "task-1",
  trigger: "task_created",
  taskVersion: 1,
  actorId: "actor-1",
  previous: null,
  current: {
    status: "todo",
    priority: "medium",
    projectId: "project-1",
    assigneeId: null,
    tags: [],
    version: 1,
  },
  depth: 0,
  attempt: 1,
  maxAttempts: 8,
  claimToken: "claim-1",
};

describe("automation event worker", () => {
  it("validates bounded polling options", () => {
    assert.deepEqual(
      readAutomationEventOptions({
        AUTOMATION_EVENT_BATCH_SIZE: "20",
        AUTOMATION_EVENT_CLAIM_TIMEOUT_MINUTES: "10",
      }),
      { batchSize: 20, claimTimeoutMinutes: 10 },
    );
    assert.throws(() => readAutomationEventOptions({ AUTOMATION_EVENT_BATCH_SIZE: "0" }), /between 1 and 250/);
  });

  it("claims durable events with skip-locked recovery", async () => {
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
                  task_id: candidate.taskId,
                  trigger: candidate.trigger,
                  task_version: candidate.taskVersion,
                  actor_id: candidate.actorId,
                  previous: candidate.previous,
                  current: candidate.current,
                  depth: candidate.depth,
                  attempts: candidate.attempt,
                  max_attempts: candidate.maxAttempts,
                  claim_token: candidate.claimToken,
                },
              ],
            }
          : { rows: [] };
      },
    } as unknown as PoolClient;

    assert.deepEqual(await claimAutomationEventBatch(client, { batchSize: 25, claimTimeoutMinutes: 15 }), [candidate]);
    assert.equal(statements[0], "begin");
    assert.match(statements[1] ?? "", /for update skip locked/);
    assert.match(statements[1] ?? "", /gen_random_uuid/);
    assert.equal(statements[2], "commit");
  });

  it("enqueues each daily task event with a date-stable deduplication key", async () => {
    let statement = "";
    const pool = {
      async query(sql: string) {
        statement = sql;
        return { rowCount: 3 };
      },
    } as unknown as Pool;
    assert.deepEqual(await enqueueDailyAutomationEvents(pool), { enqueued: 3 });
    assert.match(statement, /rule\.trigger = 'schedule_daily'/);
    assert.match(statement, /to_char\(current_date, 'YYYY-MM-DD'\)/);
    assert.match(statement, /on conflict \(deduplication_key\) do nothing/);
  });

  it(
    "executes database effects once and emits a bounded follow-up event",
    { skip: !process.env.DATABASE_MAINTENANCE_URL },
    async () => {
      const pool = new Pool({ connectionString: process.env.DATABASE_MAINTENANCE_URL, max: 4 });
      const userId = randomUUID();
      const organizationId = randomUUID();
      const workspaceId = randomUUID();
      const projectId = randomUUID();
      const automationId = randomUUID();
      const taskId = randomUUID();
      const eventId = randomUUID();
      try {
        await pool.query("insert into users (id, email, name) values ($1, $2, 'Automation actor')", [
          userId,
          `automation-${userId}@example.test`,
        ]);
        await pool.query(
          "insert into organizations (id, name, slug, owner_id) values ($1, 'Automation tenant', $2, $3)",
          [organizationId, `automation-${organizationId}`, userId],
        );
        await pool.query(
          "insert into workspaces (id, organization_id, name, slug) values ($1, $2, 'Automation workspace', $3)",
          [workspaceId, organizationId, `automation-${workspaceId}`],
        );
        await pool.query(
          "insert into memberships (user_id, organization_id, workspace_id, status) values ($1, $2, $3, 'active')",
          [userId, organizationId, workspaceId],
        );
        await pool.query(
          "insert into projects (id, organization_id, workspace_id, name, owner_id) values ($1, $2, $3, 'Automation project', $4)",
          [projectId, organizationId, workspaceId, userId],
        );
        await pool.query(
          `insert into automations (
             id, organization_id, workspace_id, name, trigger, conditions, actions, enabled
           ) values ($1, $2, $3, 'Start task', 'task_created', $4::jsonb, $5::jsonb, true)`,
          [
            automationId,
            organizationId,
            workspaceId,
            JSON.stringify({ status: "todo" }),
            JSON.stringify({
              setStatus: "in_progress",
              addComment: "Started by automation",
              notify: "reporter",
            }),
          ],
        );
        await pool.query(
          `insert into tasks (
             id, organization_id, workspace_id, project_id, title, serial, reporter_id
           ) values ($1, $2, $3, $4, 'Queued task', $5, $6)`,
          [taskId, organizationId, workspaceId, projectId, `AUTO-${taskId.slice(0, 8)}`, userId],
        );
        await pool.query(
          `insert into automation_events (
             id, organization_id, workspace_id, task_id, trigger, task_version,
             actor_id, current, depth, deduplication_key
           ) values ($1, $2, $3, $4, 'task_created', 1, $5, $6::jsonb, 0, $7)`,
          [
            eventId,
            organizationId,
            workspaceId,
            taskId,
            userId,
            JSON.stringify({
              status: "todo",
              priority: "medium",
              projectId,
              assigneeId: null,
              tags: [],
              version: 1,
            }),
            `automation-test/${eventId}`,
          ],
        );

        await processAutomationEvents(pool, { batchSize: 25, claimTimeoutMinutes: 15 });
        await processAutomationEvents(pool, { batchSize: 25, claimTimeoutMinutes: 15 });
        await processAutomationEvents(pool, { batchSize: 25, claimTimeoutMinutes: 15 });

        const state = await pool.query<{
          status: string;
          version: number;
          comments: number;
          notifications: number;
          successful_runs: number;
          rule_runs: number;
        }>(
          `select task.status,
                  task.version,
                  (select count(*)::int from comments where task_id = task.id and deleted_at is null) as comments,
                  (select count(*)::int from notifications where entity_id = task.id and type = 'automation') as notifications,
                  (select count(*)::int from automation_runs where event_id = $2 and status = 'success') as successful_runs,
                  (select coalesce(runs, 0)::int from automations where id = $3) as rule_runs
           from tasks task
           where task.id = $1`,
          [taskId, eventId, automationId],
        );
        assert.deepEqual(state.rows, [
          {
            status: "in_progress",
            version: 2,
            comments: 1,
            notifications: 1,
            successful_runs: 1,
            rule_runs: 1,
          },
        ]);
        const events = await pool.query<{ trigger: string; status: string; depth: number }>(
          `select trigger, status, depth
           from automation_events
           where task_id = $1
           order by depth, trigger`,
          [taskId],
        );
        assert.deepEqual(events.rows, [
          { trigger: "task_created", status: "sent", depth: 0 },
          { trigger: "comment_added", status: "skipped", depth: 1 },
          { trigger: "task_status_changed", status: "skipped", depth: 1 },
        ]);
      } finally {
        await pool.query("delete from organizations where id = $1", [organizationId]).catch(async () => {
          await pool.query("delete from automation_runs where organization_id = $1", [organizationId]);
          await pool.query("delete from automation_events where organization_id = $1", [organizationId]);
          await pool.query("delete from comments where organization_id = $1", [organizationId]);
          await pool.query("delete from notifications where organization_id = $1", [organizationId]);
          await pool.query("delete from tasks where organization_id = $1", [organizationId]);
          await pool.query("delete from automations where organization_id = $1", [organizationId]);
          await pool.query("delete from projects where organization_id = $1", [organizationId]);
          await pool.query("delete from memberships where organization_id = $1", [organizationId]);
          await pool.query("delete from workspaces where organization_id = $1", [organizationId]);
          await pool.query("delete from organizations where id = $1", [organizationId]);
        });
        await pool.query("delete from users where id = $1", [userId]);
        await pool.end();
      }
    },
  );
});
