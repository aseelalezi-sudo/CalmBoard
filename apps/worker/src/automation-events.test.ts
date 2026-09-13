import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { Pool, type PoolClient } from "pg";
import {
  assertValidEventTransition,
  claimAutomationEventBatch,
  completeEvent,
  enqueueDailyAutomationEvents,
  executeRule,
  processAutomationEvents,
  readAutomationEventOptions,
  releaseEvent,
  saveRun,
  MAX_AUTOMATION_DEPTH,
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

  it("enforces explicit automation event state machine transitions", () => {
    // Valid transitions
    assert.doesNotThrow(() => assertValidEventTransition("pending", "processing"));
    assert.doesNotThrow(() => assertValidEventTransition("processing", "sent"));
    assert.doesNotThrow(() => assertValidEventTransition("processing", "skipped"));
    assert.doesNotThrow(() => assertValidEventTransition("processing", "dead"));
    assert.doesNotThrow(() => assertValidEventTransition("processing", "pending"));

    // Invalid transitions
    assert.throws(() => assertValidEventTransition("pending", "sent"), /Invalid automation event state transition/);
    assert.throws(() => assertValidEventTransition("pending", "dead"), /Invalid automation event state transition/);
    assert.throws(() => assertValidEventTransition("pending", "skipped"), /Invalid automation event state transition/);
    assert.throws(() => assertValidEventTransition("sent", "processing"), /Invalid automation event state transition/);
    assert.throws(() => assertValidEventTransition("sent", "pending"), /Invalid automation event state transition/);
    assert.throws(() => assertValidEventTransition("sent", "skipped"), /Invalid automation event state transition/);
    assert.throws(
      () => assertValidEventTransition("skipped", "processing"),
      /Invalid automation event state transition/,
    );
    assert.throws(() => assertValidEventTransition("skipped", "sent"), /Invalid automation event state transition/);
    assert.throws(() => assertValidEventTransition("dead", "pending"), /Invalid automation event state transition/);
    assert.throws(() => assertValidEventTransition("dead", "processing"), /Invalid automation event state transition/);
  });

  it("enforces loop protection threshold depth >= 5", () => {
    assert.equal(0 >= MAX_AUTOMATION_DEPTH, false);
    assert.equal(4 >= MAX_AUTOMATION_DEPTH, false);
    assert.equal(5 >= MAX_AUTOMATION_DEPTH, true);
    assert.equal(6 >= MAX_AUTOMATION_DEPTH, true);
    assert.equal(MAX_AUTOMATION_DEPTH, 5);
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
    assert.match(statement, /on conflict \(deduplication_key\) do nothing/);
  });

  // ==========================================
  // POSTGRESQL INTEGRATION TEST SUITE
  // ==========================================
  async function setupTestTenant(pool: Pool) {
    const userId = randomUUID();
    const secondUserId = randomUUID();
    const organizationId = randomUUID();
    const workspaceId = randomUUID();
    const projectId = randomUUID();

    await pool.query("insert into users (id, email, name) values ($1, $2, 'Primary actor')", [
      userId,
      `actor-${userId}@example.test`,
    ]);
    await pool.query("insert into users (id, email, name) values ($1, $2, 'Second actor')", [
      secondUserId,
      `second-${secondUserId}@example.test`,
    ]);
    await pool.query("insert into organizations (id, name, slug, owner_id) values ($1, 'Automation tenant', $2, $3)", [
      organizationId,
      `org-${organizationId}`,
      userId,
    ]);
    await pool.query(
      "insert into workspaces (id, organization_id, name, slug) values ($1, $2, 'Automation workspace', $3)",
      [workspaceId, organizationId, `ws-${workspaceId}`],
    );
    await pool.query(
      "insert into memberships (user_id, organization_id, workspace_id, status) values ($1, $2, $3, 'active')",
      [userId, organizationId, workspaceId],
    );
    await pool.query(
      "insert into memberships (user_id, organization_id, workspace_id, status) values ($1, $2, $3, 'active')",
      [secondUserId, organizationId, workspaceId],
    );
    await pool.query(
      "insert into projects (id, organization_id, workspace_id, name, owner_id) values ($1, $2, $3, 'Automation project', $4)",
      [projectId, organizationId, workspaceId, userId],
    );

    const cleanup = async () => {
      try {
        await pool.query("delete from automation_runs where organization_id = $1", [organizationId]);
        await pool.query("delete from automation_events where organization_id = $1", [organizationId]);
        await pool.query("delete from comments where organization_id = $1", [organizationId]);
        await pool.query("delete from notifications where organization_id = $1", [organizationId]);
        await pool.query("delete from task_assignees where organization_id = $1", [organizationId]);
        await pool.query("delete from tasks where organization_id = $1", [organizationId]);
        await pool.query("delete from automations where organization_id = $1", [organizationId]);
        await pool.query("delete from projects where organization_id = $1", [organizationId]);
        await pool.query("delete from memberships where organization_id = $1", [organizationId]);
        await pool.query("delete from workspaces where organization_id = $1", [organizationId]);
        await pool.query("delete from organizations where id = $1", [organizationId]);
      } catch {
        // ignore cleanup errors
      }
      await pool.query("delete from users where id = $1 or id = $2", [userId, secondUserId]);
    };

    return { userId, secondUserId, organizationId, workspaceId, projectId, cleanup };
  }

  it(
    "executes database effects once and emits a bounded follow-up event",
    { skip: !process.env.DATABASE_MAINTENANCE_URL },
    async () => {
      const pool = new Pool({ connectionString: process.env.DATABASE_MAINTENANCE_URL, max: 4 });
      const tenant = await setupTestTenant(pool);
      const automationId = randomUUID();
      const taskId = randomUUID();
      const eventId = randomUUID();
      try {
        await pool.query(
          `insert into automations (
             id, organization_id, workspace_id, name, trigger, conditions, actions, enabled
           ) values ($1, $2, $3, 'Start task', 'task_created', $4::jsonb, $5::jsonb, true)`,
          [
            automationId,
            tenant.organizationId,
            tenant.workspaceId,
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
          [
            taskId,
            tenant.organizationId,
            tenant.workspaceId,
            tenant.projectId,
            `AUTO-${taskId.slice(0, 8)}`,
            tenant.userId,
          ],
        );
        await pool.query(
          `insert into automation_events (
             id, organization_id, workspace_id, task_id, trigger, task_version,
             actor_id, current, depth, deduplication_key
           ) values ($1, $2, $3, $4, 'task_created', 1, $5, $6::jsonb, 0, $7)`,
          [
            eventId,
            tenant.organizationId,
            tenant.workspaceId,
            taskId,
            tenant.userId,
            JSON.stringify({
              status: "todo",
              priority: "medium",
              projectId: tenant.projectId,
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
      } finally {
        await tenant.cleanup();
        await pool.end();
      }
    },
  );

  it(
    "recognizes true task no-ops without version increment or run counter inflation",
    { skip: !process.env.DATABASE_MAINTENANCE_URL },
    async () => {
      const pool = new Pool({ connectionString: process.env.DATABASE_MAINTENANCE_URL, max: 4 });
      const tenant = await setupTestTenant(pool);
      const automationId = randomUUID();
      const taskId = randomUUID();
      const eventId = randomUUID();
      try {
        await pool.query(
          `insert into automations (
             id, organization_id, workspace_id, name, trigger, conditions, actions, enabled
           ) values ($1, $2, $3, 'Set Done', 'task_created', '{}'::jsonb, $4::jsonb, true)`,
          [automationId, tenant.organizationId, tenant.workspaceId, JSON.stringify({ setStatus: "done" })],
        );
        // Task is already 'done'
        await pool.query(
          `insert into tasks (
             id, organization_id, workspace_id, project_id, title, serial, status, progress, reporter_id, version
           ) values ($1, $2, $3, $4, 'Already done task', $5, 'done', 100, $6, 5)`,
          [
            taskId,
            tenant.organizationId,
            tenant.workspaceId,
            tenant.projectId,
            `AUTO-${taskId.slice(0, 8)}`,
            tenant.userId,
          ],
        );
        await pool.query(
          `insert into automation_events (
             id, organization_id, workspace_id, task_id, trigger, task_version,
             actor_id, current, depth, deduplication_key
           ) values ($1, $2, $3, $4, 'task_created', 5, $5, $6::jsonb, 0, $7)`,
          [
            eventId,
            tenant.organizationId,
            tenant.workspaceId,
            taskId,
            tenant.userId,
            JSON.stringify({
              status: "done",
              priority: "medium",
              projectId: tenant.projectId,
              assigneeId: null,
              tags: [],
              version: 5,
            }),
            `automation-noop-test/${eventId}`,
          ],
        );

        const result = await processAutomationEvents(pool, { batchSize: 25, claimTimeoutMinutes: 15 });
        assert.equal(result.completed, 1);

        // Verify task version did NOT increment
        const taskCheck = await pool.query<{ status: string; version: number }>(
          `select status, version from tasks where id = $1`,
          [taskId],
        );
        assert.equal(taskCheck.rows[0]?.version, 5);
        assert.equal(taskCheck.rows[0]?.status, "done");

        // Verify automation_runs recorded skipped
        const runCheck = await pool.query<{ status: string }>(
          `select status from automation_runs where event_id = $1 and automation_id = $2`,
          [eventId, automationId],
        );
        assert.equal(runCheck.rows[0]?.status, "skipped");

        // Verify automations.runs did NOT increment
        const ruleCheck = await pool.query<{ runs: number }>(
          `select coalesce(runs, 0)::int as runs from automations where id = $1`,
          [automationId],
        );
        assert.equal(ruleCheck.rows[0]?.runs, 0);
      } finally {
        await tenant.cleanup();
        await pool.end();
      }
    },
  );

  it(
    "enforces canonical assignment and workspace membership",
    { skip: !process.env.DATABASE_MAINTENANCE_URL },
    async () => {
      const pool = new Pool({ connectionString: process.env.DATABASE_MAINTENANCE_URL, max: 4 });
      const tenant = await setupTestTenant(pool);
      const automationId = randomUUID();
      const taskId = randomUUID();
      const eventId = randomUUID();
      try {
        await pool.query(
          `insert into automations (
             id, organization_id, workspace_id, name, trigger, conditions, actions, enabled
           ) values ($1, $2, $3, 'Assign Lead', 'task_created', '{}'::jsonb, $4::jsonb, true)`,
          [automationId, tenant.organizationId, tenant.workspaceId, JSON.stringify({ assignTo: tenant.secondUserId })],
        );
        await pool.query(
          `insert into tasks (
             id, organization_id, workspace_id, project_id, title, serial, reporter_id, version
           ) values ($1, $2, $3, $4, 'Unassigned task', $5, $6, 1)`,
          [
            taskId,
            tenant.organizationId,
            tenant.workspaceId,
            tenant.projectId,
            `AUTO-${taskId.slice(0, 8)}`,
            tenant.userId,
          ],
        );
        await pool.query(
          `insert into automation_events (
             id, organization_id, workspace_id, task_id, trigger, task_version,
             actor_id, current, depth, deduplication_key
           ) values ($1, $2, $3, $4, 'task_created', 1, $5, $6::jsonb, 0, $7)`,
          [
            eventId,
            tenant.organizationId,
            tenant.workspaceId,
            taskId,
            tenant.userId,
            JSON.stringify({
              status: "todo",
              priority: "medium",
              projectId: tenant.projectId,
              assigneeId: null,
              tags: [],
              version: 1,
            }),
            `automation-assign-test/${eventId}`,
          ],
        );

        await processAutomationEvents(pool, { batchSize: 25, claimTimeoutMinutes: 15 });

        // Verify task assignee is updated canonically
        const taskRow = await pool.query<{ assignee_id: string }>(`select assignee_id from tasks where id = $1`, [
          taskId,
        ]);
        assert.equal(taskRow.rows[0]?.assignee_id, tenant.secondUserId);

        // Verify task_assignees row was created canonically
        const assigneeRow = await pool.query<{ user_id: string; is_primary: boolean }>(
          `select user_id, is_primary from task_assignees where task_id = $1 and unassigned_at is null`,
          [taskId],
        );
        assert.equal(assigneeRow.rows[0]?.user_id, tenant.secondUserId);
        assert.equal(assigneeRow.rows[0]?.is_primary, true);
      } finally {
        await tenant.cleanup();
        await pool.end();
      }
    },
  );

  it("enforces loop protection for depth >= 5", { skip: !process.env.DATABASE_MAINTENANCE_URL }, async () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_MAINTENANCE_URL, max: 4 });
    const tenant = await setupTestTenant(pool);
    const automationId = randomUUID();
    const taskId = randomUUID();
    try {
      await pool.query(
        `insert into automations (
             id, organization_id, workspace_id, name, trigger, conditions, actions, enabled
           ) values ($1, $2, $3, 'Change status', 'task_created', '{}'::jsonb, $4::jsonb, true)`,
        [automationId, tenant.organizationId, tenant.workspaceId, JSON.stringify({ setPriority: "urgent" })],
      );
      await pool.query(
        `insert into tasks (
             id, organization_id, workspace_id, project_id, title, serial, priority, reporter_id, version
           ) values ($1, $2, $3, $4, 'Loop task', $5, 'low', $6, 1)`,
        [
          taskId,
          tenant.organizationId,
          tenant.workspaceId,
          tenant.projectId,
          `AUTO-${taskId.slice(0, 8)}`,
          tenant.userId,
        ],
      );

      // Create a valid parent chain for depths 0 -> 1 -> 2 -> 3 -> 4 -> 5
      let parentId: string | null = null;
      let eventDepth5Id = "";
      for (let d = 0; d <= 5; d++) {
        const currentEventId = randomUUID();
        const isTarget = d === 5;
        if (isTarget) eventDepth5Id = currentEventId;
        await pool.query(
          `insert into automation_events (
               id, organization_id, workspace_id, task_id, trigger, task_version,
               actor_id, current, depth, parent_event_id, deduplication_key, status, completed_at
             ) values ($1, $2, $3, $4, 'task_created', 1, $5, $6::jsonb, $7, $8, $9, $10, $11)`,
          [
            currentEventId,
            tenant.organizationId,
            tenant.workspaceId,
            taskId,
            tenant.userId,
            JSON.stringify({
              status: "todo",
              priority: "low",
              projectId: tenant.projectId,
              assigneeId: null,
              tags: [],
              version: 1,
            }),
            d,
            parentId,
            `automation-loop-chain-${d}-${currentEventId}`,
            isTarget ? "pending" : "sent",
            isTarget ? null : new Date(),
          ],
        );
        parentId = currentEventId;
      }

      // Process all events
      const res = await processAutomationEvents(pool, { batchSize: 25, claimTimeoutMinutes: 15 });
      assert.ok(res.skipped >= 1, "Depth 5 event must be skipped");

      // Status of depth 5 event should be 'skipped'
      const eventStatus = await pool.query<{ id: string; status: string; depth: number }>(
        `select id, status, depth from automation_events where id = $1`,
        [eventDepth5Id],
      );
      assert.equal(eventStatus.rows[0]?.status, "skipped");
      assert.equal(eventStatus.rows[0]?.depth, 5);

      // Task was NOT mutated
      const taskCheck = await pool.query<{ priority: string }>(`select priority from tasks where id = $1`, [taskId]);
      assert.equal(taskCheck.rows[0]?.priority, "low");

      // Rule runs was NOT incremented
      const ruleCheck = await pool.query<{ runs: number }>(
        `select coalesce(runs, 0)::int as runs from automations where id = $1`,
        [automationId],
      );
      assert.equal(ruleCheck.rows[0]?.runs, 0);
    } finally {
      await tenant.cleanup();
      await pool.end();
    }
  });

  it(
    "reclaims stale processing events and fences expired claim tokens",
    { skip: !process.env.DATABASE_MAINTENANCE_URL },
    async () => {
      const pool = new Pool({ connectionString: process.env.DATABASE_MAINTENANCE_URL, max: 4 });
      const tenant = await setupTestTenant(pool);
      const eventId = randomUUID();
      const taskId = randomUUID();
      const staleClaimToken = randomUUID();
      try {
        await pool.query(
          `insert into tasks (
             id, organization_id, workspace_id, project_id, title, serial, reporter_id, version
           ) values ($1, $2, $3, $4, 'Stale task', $5, $6, 1)`,
          [
            taskId,
            tenant.organizationId,
            tenant.workspaceId,
            tenant.projectId,
            `AUTO-${taskId.slice(0, 8)}`,
            tenant.userId,
          ],
        );

        // Insert event already in 'processing' status with an old claimed_at timestamp
        await pool.query(
          `insert into automation_events (
             id, organization_id, workspace_id, task_id, trigger, task_version,
             actor_id, current, depth, status, attempts, claimed_at, claim_token, deduplication_key
           ) values ($1, $2, $3, $4, 'task_created', 1, $5, $6::jsonb, 0, 'processing', 1, now() - interval '30 minutes', $7, $8)`,
          [
            eventId,
            tenant.organizationId,
            tenant.workspaceId,
            taskId,
            tenant.userId,
            JSON.stringify({
              status: "todo",
              priority: "medium",
              projectId: tenant.projectId,
              assigneeId: null,
              tags: [],
              version: 1,
            }),
            staleClaimToken,
            `automation-stale-test/${eventId}`,
          ],
        );

        // New worker claims batch
        const client = await pool.connect();
        let claimed: AutomationEventCandidate[];
        try {
          claimed = await claimAutomationEventBatch(client, { batchSize: 25, claimTimeoutMinutes: 15 });
        } finally {
          client.release();
        }

        const reclaimedEvent = claimed.find((e) => e.id === eventId);
        assert.ok(reclaimedEvent, "Event should be reclaimed by worker");
        assert.notEqual(reclaimedEvent.claimToken, staleClaimToken, "New claim token generated");
        assert.equal(reclaimedEvent.attempt, 2, "Attempt incremented on takeover");

        // Stale worker tries to complete event with staleClaimToken -> MUST FAIL
        const staleClient = await pool.connect();
        try {
          await assert.rejects(
            () => completeEvent(staleClient, { ...reclaimedEvent, claimToken: staleClaimToken }, "sent"),
            /claim token expired or was superseded/,
          );
        } finally {
          staleClient.release();
        }
      } finally {
        await tenant.cleanup();
        await pool.end();
      }
    },
  );

  it(
    "enforces race-safe daily schedule deduplication and tenant isolation",
    { skip: !process.env.DATABASE_MAINTENANCE_URL },
    async () => {
      const pool = new Pool({ connectionString: process.env.DATABASE_MAINTENANCE_URL, max: 4 });
      const tenant = await setupTestTenant(pool);
      const automationId = randomUUID();
      const taskId = randomUUID();
      const date = "2026-09-12";
      try {
        // Daily rule enabled
        await pool.query(
          `insert into automations (
             id, organization_id, workspace_id, name, trigger, conditions, actions, enabled
           ) values ($1, $2, $3, 'Daily Check', 'schedule_daily', '{}'::jsonb, '{}'::jsonb, true)`,
          [automationId, tenant.organizationId, tenant.workspaceId],
        );
        await pool.query(
          `insert into tasks (
             id, organization_id, workspace_id, project_id, title, serial, reporter_id, version
           ) values ($1, $2, $3, $4, 'Daily task', $5, $6, 1)`,
          [
            taskId,
            tenant.organizationId,
            tenant.workspaceId,
            tenant.projectId,
            `AUTO-${taskId.slice(0, 8)}`,
            tenant.userId,
          ],
        );

        // First run: enqueues 1 event
        const first = await enqueueDailyAutomationEvents(pool, {
          date,
          organizationId: tenant.organizationId,
          workspaceId: tenant.workspaceId,
        });
        assert.equal(first.enqueued, 1);

        // Concurrent / duplicate run: enqueues 0 events (race-safe ON CONFLICT)
        const second = await enqueueDailyAutomationEvents(pool, {
          date,
          organizationId: tenant.organizationId,
          workspaceId: tenant.workspaceId,
        });
        assert.equal(second.enqueued, 0);

        // Verify event in database
        const eventRow = await pool.query<{ trigger: string; deduplication_key: string }>(
          `select trigger, deduplication_key from automation_events where task_id = $1`,
          [taskId],
        );
        assert.equal(eventRow.rows.length, 1);
        assert.equal(eventRow.rows[0]?.trigger, "schedule_daily");
        assert.equal(eventRow.rows[0]?.deduplication_key, `schedule-daily/${date}/task/${taskId}`);
      } finally {
        await tenant.cleanup();
        await pool.end();
      }
    },
  );

  describe("concurrency, fencing, and idempotency guarantees", () => {
    it(
      "CASE A: stale worker attempts task mutation after claim token superseded -> no side effect committed",
      { skip: !process.env.DATABASE_MAINTENANCE_URL },
      async () => {
        const pool = new Pool({ connectionString: process.env.DATABASE_MAINTENANCE_URL, max: 4 });
        const tenant = await setupTestTenant(pool);
        const automationId = randomUUID();
        const taskId = randomUUID();
        const eventId = randomUUID();
        const tokenA = randomUUID();
        const tokenB = randomUUID();

        try {
          await pool.query(
            `insert into automations (id, organization_id, workspace_id, name, trigger, conditions, actions, enabled)
             values ($1, $2, $3, 'Mutate Status', 'task_created', '{}'::jsonb, $4::jsonb, true)`,
            [
              automationId,
              tenant.organizationId,
              tenant.workspaceId,
              JSON.stringify({ setStatus: "in_progress", setPriority: "urgent" }),
            ],
          );
          await pool.query(
            `insert into tasks (id, organization_id, workspace_id, project_id, title, serial, status, priority, reporter_id, version)
             values ($1, $2, $3, $4, 'Task A', $5, 'todo', 'low', $6, 1)`,
            [
              taskId,
              tenant.organizationId,
              tenant.workspaceId,
              tenant.projectId,
              `AUTO-${taskId.slice(0, 8)}`,
              tenant.userId,
            ],
          );
          await pool.query(
            `insert into automation_events (
               id, organization_id, workspace_id, task_id, trigger, task_version,
               actor_id, current, depth, deduplication_key, status, claim_token, claimed_at, attempts
             ) values ($1, $2, $3, $4, 'task_created', 1, $5, $6::jsonb, 0, $7, 'processing', $8, now(), 1)`,
            [
              eventId,
              tenant.organizationId,
              tenant.workspaceId,
              taskId,
              tenant.userId,
              JSON.stringify({
                status: "todo",
                priority: "low",
                projectId: tenant.projectId,
                assigneeId: null,
                tags: [],
                version: 1,
              }),
              `case-a-event-${eventId}`,
              tokenA,
            ],
          );

          // Worker B takes over with token B
          await pool.query(
            `update automation_events set claim_token = $1, attempts = 2, claimed_at = now() where id = $2`,
            [tokenB, eventId],
          );

          // Worker A attempts task mutation with stale token A
          const candidateA: AutomationEventCandidate = {
            id: eventId,
            organizationId: tenant.organizationId,
            workspaceId: tenant.workspaceId,
            taskId,
            trigger: "task_created",
            taskVersion: 1,
            actorId: tenant.userId,
            previous: null,
            current: {
              status: "todo",
              priority: "low",
              projectId: tenant.projectId,
              assigneeId: null,
              tags: [],
              version: 1,
            },
            depth: 0,
            attempt: 1,
            maxAttempts: 8,
            claimToken: tokenA,
          };

          await assert.rejects(
            () => executeRule(pool, candidateA, automationId),
            /claim has expired or was superseded/,
          );

          // Verify no task side effect was committed
          const taskCheck = await pool.query<{ status: string; priority: string; version: number }>(
            `select status, priority, version from tasks where id = $1`,
            [taskId],
          );
          assert.equal(taskCheck.rows[0]?.status, "todo");
          assert.equal(taskCheck.rows[0]?.priority, "low");
          assert.equal(taskCheck.rows[0]?.version, 1);
        } finally {
          await tenant.cleanup();
          await pool.end();
        }
      },
    );

    it(
      "CASE B: stale worker loses claim before comment creation -> no comment created",
      { skip: !process.env.DATABASE_MAINTENANCE_URL },
      async () => {
        const pool = new Pool({ connectionString: process.env.DATABASE_MAINTENANCE_URL, max: 4 });
        const tenant = await setupTestTenant(pool);
        const automationId = randomUUID();
        const taskId = randomUUID();
        const eventId = randomUUID();
        const tokenA = randomUUID();
        const tokenB = randomUUID();

        try {
          await pool.query(
            `insert into automations (id, organization_id, workspace_id, name, trigger, conditions, actions, enabled)
             values ($1, $2, $3, 'Add Comment Rule', 'task_created', '{}'::jsonb, $4::jsonb, true)`,
            [
              automationId,
              tenant.organizationId,
              tenant.workspaceId,
              JSON.stringify({ addComment: "Automated test comment" }),
            ],
          );
          await pool.query(
            `insert into tasks (id, organization_id, workspace_id, project_id, title, serial, status, priority, reporter_id, version)
             values ($1, $2, $3, $4, 'Task B', $5, 'todo', 'low', $6, 1)`,
            [
              taskId,
              tenant.organizationId,
              tenant.workspaceId,
              tenant.projectId,
              `AUTO-${taskId.slice(0, 8)}`,
              tenant.userId,
            ],
          );
          await pool.query(
            `insert into automation_events (
               id, organization_id, workspace_id, task_id, trigger, task_version,
               actor_id, current, depth, deduplication_key, status, claim_token, claimed_at, attempts
             ) values ($1, $2, $3, $4, 'task_created', 1, $5, $6::jsonb, 0, $7, 'processing', $8, now(), 1)`,
            [
              eventId,
              tenant.organizationId,
              tenant.workspaceId,
              taskId,
              tenant.userId,
              JSON.stringify({
                status: "todo",
                priority: "low",
                projectId: tenant.projectId,
                assigneeId: null,
                tags: [],
                version: 1,
              }),
              `case-b-event-${eventId}`,
              tokenA,
            ],
          );

          // Worker B takes over with token B
          await pool.query(
            `update automation_events set claim_token = $1, attempts = 2, claimed_at = now() where id = $2`,
            [tokenB, eventId],
          );

          // Worker A attempts to execute rule and create comment with stale token A
          const candidateA: AutomationEventCandidate = {
            id: eventId,
            organizationId: tenant.organizationId,
            workspaceId: tenant.workspaceId,
            taskId,
            trigger: "task_created",
            taskVersion: 1,
            actorId: tenant.userId,
            previous: null,
            current: {
              status: "todo",
              priority: "low",
              projectId: tenant.projectId,
              assigneeId: null,
              tags: [],
              version: 1,
            },
            depth: 0,
            attempt: 1,
            maxAttempts: 8,
            claimToken: tokenA,
          };

          await assert.rejects(
            () => executeRule(pool, candidateA, automationId),
            /claim has expired or was superseded/,
          );

          // Verify no comment was created in database
          const commentCheck = await pool.query<{ count: number }>(
            `select count(*)::int as count from comments where task_id = $1`,
            [taskId],
          );
          assert.equal(commentCheck.rows[0]?.count, 0);
        } finally {
          await tenant.cleanup();
          await pool.end();
        }
      },
    );

    it(
      "CASE C: worker loses claim before run completion -> cannot overwrite newer worker's run result",
      { skip: !process.env.DATABASE_MAINTENANCE_URL },
      async () => {
        const pool = new Pool({ connectionString: process.env.DATABASE_MAINTENANCE_URL, max: 4 });
        const tenant = await setupTestTenant(pool);
        const automationId = randomUUID();
        const taskId = randomUUID();
        const eventId = randomUUID();
        const tokenA = randomUUID();
        const tokenB = randomUUID();

        try {
          await pool.query(
            `insert into automations (id, organization_id, workspace_id, name, trigger, conditions, actions, enabled)
             values ($1, $2, $3, 'Run Fencing', 'task_created', '{}'::jsonb, $4::jsonb, true)`,
            [automationId, tenant.organizationId, tenant.workspaceId, JSON.stringify({ setPriority: "urgent" })],
          );
          await pool.query(
            `insert into tasks (id, organization_id, workspace_id, project_id, title, serial, status, priority, reporter_id, version)
             values ($1, $2, $3, $4, 'Task C', $5, 'todo', 'low', $6, 1)`,
            [
              taskId,
              tenant.organizationId,
              tenant.workspaceId,
              tenant.projectId,
              `AUTO-${taskId.slice(0, 8)}`,
              tenant.userId,
            ],
          );
          await pool.query(
            `insert into automation_events (
               id, organization_id, workspace_id, task_id, trigger, task_version,
               actor_id, current, depth, deduplication_key, status, claim_token, claimed_at, attempts
             ) values ($1, $2, $3, $4, 'task_created', 1, $5, $6::jsonb, 0, $7, 'processing', $8, now(), 2)`,
            [
              eventId,
              tenant.organizationId,
              tenant.workspaceId,
              taskId,
              tenant.userId,
              JSON.stringify({
                status: "todo",
                priority: "low",
                projectId: tenant.projectId,
                assigneeId: null,
                tags: [],
                version: 1,
              }),
              `case-c-event-${eventId}`,
              tokenB,
            ],
          );

          // Worker B successfully recorded a run
          await pool.query(
            `insert into automation_runs (
               organization_id, workspace_id, automation_id, event_id, task_id,
               status, attempt, claim_token, message, duration_ms
             ) values ($1, $2, $3, $4, $5, 'success', 2, $6, 'Completed successfully by Worker B', 25)`,
            [tenant.organizationId, tenant.workspaceId, automationId, eventId, taskId, tokenB],
          );

          // Worker A (stale with tokenA) attempts to overwrite the run
          const staleCandidate: AutomationEventCandidate = {
            id: eventId,
            organizationId: tenant.organizationId,
            workspaceId: tenant.workspaceId,
            taskId,
            trigger: "task_created",
            taskVersion: 1,
            actorId: tenant.userId,
            previous: null,
            current: {
              status: "todo",
              priority: "low",
              projectId: tenant.projectId,
              assigneeId: null,
              tags: [],
              version: 1,
            },
            depth: 0,
            attempt: 1,
            maxAttempts: 8,
            claimToken: tokenA,
          };

          const overwritten = await saveRun(pool, staleCandidate, automationId, "failed", "Stale failure message", 999);
          assert.equal(overwritten, false, "Stale worker must not update run");

          // Verify Worker B's record was untouched
          const runRow = await pool.query<{ status: string; claim_token: string; message: string; attempt: number }>(
            `select status, claim_token, message, attempt from automation_runs where event_id = $1 and automation_id = $2`,
            [eventId, automationId],
          );
          assert.equal(runRow.rows[0]?.status, "success");
          assert.equal(runRow.rows[0]?.claim_token, tokenB);
          assert.equal(runRow.rows[0]?.message, "Completed successfully by Worker B");
          assert.equal(runRow.rows[0]?.attempt, 2);
        } finally {
          await tenant.cleanup();
          await pool.end();
        }
      },
    );

    it(
      "CASE D: retry after successful comment creation -> exactly one automation comment",
      { skip: !process.env.DATABASE_MAINTENANCE_URL },
      async () => {
        const pool = new Pool({ connectionString: process.env.DATABASE_MAINTENANCE_URL, max: 4 });
        const tenant = await setupTestTenant(pool);
        const automationId = randomUUID();
        const taskId = randomUUID();
        const eventId = randomUUID();

        try {
          await pool.query(
            `insert into automations (id, organization_id, workspace_id, name, trigger, conditions, actions, enabled)
             values ($1, $2, $3, 'Comment Rule', 'task_created', '{}'::jsonb, $4::jsonb, true)`,
            [
              automationId,
              tenant.organizationId,
              tenant.workspaceId,
              JSON.stringify({ addComment: "Idempotent comment" }),
            ],
          );
          await pool.query(
            `insert into tasks (id, organization_id, workspace_id, project_id, title, serial, status, priority, reporter_id, version)
             values ($1, $2, $3, $4, 'Task D', $5, 'todo', 'low', $6, 1)`,
            [
              taskId,
              tenant.organizationId,
              tenant.workspaceId,
              tenant.projectId,
              `AUTO-${taskId.slice(0, 8)}`,
              tenant.userId,
            ],
          );
          await pool.query(
            `insert into automation_events (
               id, organization_id, workspace_id, task_id, trigger, task_version,
               actor_id, current, depth, deduplication_key, status
             ) values ($1, $2, $3, $4, 'task_created', 1, $5, $6::jsonb, 0, $7, 'pending')`,
            [
              eventId,
              tenant.organizationId,
              tenant.workspaceId,
              taskId,
              tenant.userId,
              JSON.stringify({
                status: "todo",
                priority: "low",
                projectId: tenant.projectId,
                assigneeId: null,
                tags: [],
                version: 1,
              }),
              `case-d-event-${eventId}`,
            ],
          );

          // First run: claim event and execute rule (creates comment)
          const claimClient = await pool.connect();
          let claimedEvents: AutomationEventCandidate[];
          try {
            claimedEvents = await claimAutomationEventBatch(claimClient, { batchSize: 25, claimTimeoutMinutes: 15 });
          } finally {
            claimClient.release();
          }
          const candidateD = claimedEvents.find((e) => e.id === eventId)!;
          assert.ok(candidateD, "Event should be claimed");

          await executeRule(pool, candidateD, automationId);

          const initialCommentCount = await pool.query<{ count: number }>(
            `select count(*)::int as count from comments where task_id = $1 and deleted_at is null`,
            [taskId],
          );
          assert.equal(initialCommentCount.rows[0]?.count, 1);

          // Simulate worker crash before calling completeEvent: release the event for retry
          const releaseClient = await pool.connect();
          try {
            await releaseEvent(releaseClient, candidateD, new Error("Simulated worker crash before completeEvent"));
          } finally {
            releaseClient.release();
          }

          // Make event immediately available for retry
          await pool.query(`update automation_events set available_at = now() where id = $1`, [eventId]);

          // Second run: retries execution via processAutomationEvents
          await processAutomationEvents(pool, { batchSize: 25, claimTimeoutMinutes: 15 });

          // Verify exactly ONE comment still exists
          const finalCommentCount = await pool.query<{ count: number }>(
            `select count(*)::int as count from comments where task_id = $1 and deleted_at is null`,
            [taskId],
          );
          assert.equal(finalCommentCount.rows[0]?.count, 1);
        } finally {
          await tenant.cleanup();
          await pool.end();
        }
      },
    );

    it(
      "CASE E: two workers race for the same event/rule -> exactly one successful execution effect",
      { skip: !process.env.DATABASE_MAINTENANCE_URL },
      async () => {
        const pool = new Pool({ connectionString: process.env.DATABASE_MAINTENANCE_URL, max: 4 });
        const tenant = await setupTestTenant(pool);
        const automationId = randomUUID();
        const taskId = randomUUID();
        const eventId = randomUUID();

        try {
          await pool.query(
            `insert into automations (id, organization_id, workspace_id, name, trigger, conditions, actions, enabled)
             values ($1, $2, $3, 'Race Rule', 'task_created', '{}'::jsonb, $4::jsonb, true)`,
            [
              automationId,
              tenant.organizationId,
              tenant.workspaceId,
              JSON.stringify({ setStatus: "done", addComment: "Race comment", notify: "reporter" }),
            ],
          );
          await pool.query(
            `insert into tasks (id, organization_id, workspace_id, project_id, title, serial, status, priority, reporter_id, version)
             values ($1, $2, $3, $4, 'Task E', $5, 'todo', 'low', $6, 1)`,
            [
              taskId,
              tenant.organizationId,
              tenant.workspaceId,
              tenant.projectId,
              `AUTO-${taskId.slice(0, 8)}`,
              tenant.userId,
            ],
          );
          await pool.query(
            `insert into automation_events (
               id, organization_id, workspace_id, task_id, trigger, task_version,
               actor_id, current, depth, deduplication_key, status
             ) values ($1, $2, $3, $4, 'task_created', 1, $5, $6::jsonb, 0, $7, 'pending')`,
            [
              eventId,
              tenant.organizationId,
              tenant.workspaceId,
              taskId,
              tenant.userId,
              JSON.stringify({
                status: "todo",
                priority: "low",
                projectId: tenant.projectId,
                assigneeId: null,
                tags: [],
                version: 1,
              }),
              `case-e-event-${eventId}`,
            ],
          );

          // Two workers race concurrently to process events
          const [res1, res2] = await Promise.all([
            processAutomationEvents(pool, { batchSize: 25, claimTimeoutMinutes: 15 }),
            processAutomationEvents(pool, { batchSize: 25, claimTimeoutMinutes: 15 }),
          ]);

          assert.equal(res1.completed + res2.completed, 1);

          // Verify task version incremented exactly once (1 -> 2)
          const taskRow = await pool.query<{ status: string; version: number }>(
            `select status, version from tasks where id = $1`,
            [taskId],
          );
          assert.equal(taskRow.rows[0]?.status, "done");
          assert.equal(taskRow.rows[0]?.version, 2);

          // Verify exactly one comment
          const commentRow = await pool.query<{ count: number }>(
            `select count(*)::int as count from comments where task_id = $1 and deleted_at is null`,
            [taskId],
          );
          assert.equal(commentRow.rows[0]?.count, 1);

          // Verify exactly one notification
          const notifRow = await pool.query<{ count: number }>(
            `select count(*)::int as count from notifications where entity_id = $1 and type = 'automation'`,
            [taskId],
          );
          assert.equal(notifRow.rows[0]?.count, 1);

          // Verify automations.runs incremented exactly once
          const ruleRow = await pool.query<{ runs: number }>(
            `select coalesce(runs, 0)::int as runs from automations where id = $1`,
            [automationId],
          );
          assert.equal(ruleRow.rows[0]?.runs, 1);

          // Verify automation_runs has exactly one successful record
          const runsRow = await pool.query<{ count: number }>(
            `select count(*)::int as count from automation_runs where event_id = $1 and status = 'success'`,
            [eventId],
          );
          assert.equal(runsRow.rows[0]?.count, 1);
        } finally {
          await tenant.cleanup();
          await pool.end();
        }
      },
    );

    it(
      "CASE F: no-op automation -> no task version/timestamp/event churn and no automations.runs increment",
      { skip: !process.env.DATABASE_MAINTENANCE_URL },
      async () => {
        const pool = new Pool({ connectionString: process.env.DATABASE_MAINTENANCE_URL, max: 4 });
        const tenant = await setupTestTenant(pool);
        const automationId = randomUUID();
        const taskId = randomUUID();
        const eventId = randomUUID();

        try {
          await pool.query(
            `insert into automations (id, organization_id, workspace_id, name, trigger, conditions, actions, enabled)
             values ($1, $2, $3, 'Noop Rule', 'task_created', '{}'::jsonb, $4::jsonb, true)`,
            [automationId, tenant.organizationId, tenant.workspaceId, JSON.stringify({ setStatus: "done" })],
          );
          await pool.query(
            `insert into tasks (id, organization_id, workspace_id, project_id, title, serial, status, progress, priority, reporter_id, version, updated_at)
             values ($1, $2, $3, $4, 'Task F', $5, 'done', 100, 'low', $6, 7, now() - interval '2 hours')`,
            [
              taskId,
              tenant.organizationId,
              tenant.workspaceId,
              tenant.projectId,
              `AUTO-${taskId.slice(0, 8)}`,
              tenant.userId,
            ],
          );

          const taskBefore = await pool.query<{ version: number; updated_at: string }>(
            `select version, updated_at::text from tasks where id = $1`,
            [taskId],
          );

          await pool.query(
            `insert into automation_events (
               id, organization_id, workspace_id, task_id, trigger, task_version,
               actor_id, current, depth, deduplication_key, status
             ) values ($1, $2, $3, $4, 'task_created', 7, $5, $6::jsonb, 0, $7, 'pending')`,
            [
              eventId,
              tenant.organizationId,
              tenant.workspaceId,
              taskId,
              tenant.userId,
              JSON.stringify({
                status: "done",
                progress: 100,
                priority: "low",
                projectId: tenant.projectId,
                assigneeId: null,
                tags: [],
                version: 7,
              }),
              `case-f-event-${eventId}`,
            ],
          );

          const eventsBefore = await pool.query<{ count: number }>(
            `select count(*)::int as count from automation_events where task_id = $1`,
            [taskId],
          );

          await processAutomationEvents(pool, { batchSize: 25, claimTimeoutMinutes: 15 });

          // Verify task version and updated_at are completely unchanged
          const taskAfter = await pool.query<{ status: string; version: number; updated_at: string }>(
            `select status, version, updated_at::text from tasks where id = $1`,
            [taskId],
          );
          assert.equal(taskAfter.rows[0]?.version, taskBefore.rows[0]?.version);
          assert.equal(taskAfter.rows[0]?.updated_at, taskBefore.rows[0]?.updated_at);
          assert.equal(taskAfter.rows[0]?.status, "done");

          // Verify no new automation events were enqueued
          const eventsAfter = await pool.query<{ count: number }>(
            `select count(*)::int as count from automation_events where task_id = $1`,
            [taskId],
          );
          assert.equal(eventsAfter.rows[0]?.count, eventsBefore.rows[0]?.count);

          // Verify automations.runs was NOT incremented
          const ruleRow = await pool.query<{ runs: number }>(
            `select coalesce(runs, 0)::int as runs from automations where id = $1`,
            [automationId],
          );
          assert.equal(ruleRow.rows[0]?.runs, 0);

          // Verify automation_runs recorded skipped
          const runRow = await pool.query<{ status: string }>(
            `select status from automation_runs where event_id = $1 and automation_id = $2`,
            [eventId, automationId],
          );
          assert.equal(runRow.rows[0]?.status, "skipped");
        } finally {
          await tenant.cleanup();
          await pool.end();
        }
      },
    );
  });
});
