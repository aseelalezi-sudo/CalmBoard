import type { Pool, PoolClient } from "pg";
import {
  createCommentsRepository,
  createNotificationsRepository,
  createTasksRepository,
  VALID_TASK_PRIORITIES,
  VALID_TASK_STATUSES,
  type TaskPriority,
  type TaskStatus,
} from "@calmboard/database";

export const automationEventJobName = "automations.process-events";
export const automationDailyJobName = "automations.enqueue-daily";
export const MAX_AUTOMATION_DEPTH = 5;

export type AutomationEventStatus = "pending" | "processing" | "sent" | "skipped" | "dead";

export function assertValidEventTransition(from: AutomationEventStatus, to: AutomationEventStatus): void {
  const allowedTransitions: Record<AutomationEventStatus, AutomationEventStatus[]> = {
    pending: ["processing"],
    processing: ["sent", "skipped", "dead", "pending"],
    sent: [],
    skipped: [],
    dead: [],
  };
  if (!allowedTransitions[from]?.includes(to)) {
    throw new Error(`Invalid automation event state transition from '${from}' to '${to}'`);
  }
}

export type AutomationEventOptions = {
  batchSize: number;
  claimTimeoutMinutes: number;
};

export type AutomationEventCandidate = {
  id: string;
  organizationId: string;
  workspaceId: string;
  taskId: string;
  trigger: string;
  taskVersion: number;
  actorId: string | null;
  previous: Record<string, unknown> | null;
  current: {
    status: string;
    priority: string;
    projectId: string;
    assigneeId: string | null;
    tags: string[];
    version: number;
  };
  depth: number;
  attempt: number;
  maxAttempts: number;
  claimToken: string;
};

type TaskState = {
  id: string;
  organization_id: string;
  workspace_id: string;
  serial: string;
  status: string;
  priority: string;
  progress: number;
  project_id: string;
  assignee_id: string | null;
  reporter_id: string | null;
  tags: string[];
  version: number;
};

type AutomationRule = {
  id: string;
  name: string;
  trigger: string;
  enabled: boolean;
  conditions: Record<string, unknown> | null;
  actions: Record<string, unknown> | null;
};

export function readAutomationEventOptions(env: NodeJS.ProcessEnv = process.env): AutomationEventOptions {
  const integer = (name: string, fallback: number, minimum: number, maximum: number) => {
    const value = env[name] === undefined ? fallback : Number(env[name]);
    if (!Number.isInteger(value) || value < minimum || value > maximum) {
      throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
    }
    return value;
  };
  return {
    batchSize: integer("AUTOMATION_EVENT_BATCH_SIZE", 25, 1, 250),
    claimTimeoutMinutes: integer("AUTOMATION_EVENT_CLAIM_TIMEOUT_MINUTES", 15, 1, 1440),
  };
}

export async function claimAutomationEventBatch(
  client: PoolClient,
  options: AutomationEventOptions,
): Promise<AutomationEventCandidate[]> {
  await client.query("begin");
  try {
    const result = await client.query<{
      id: string;
      organization_id: string;
      workspace_id: string;
      task_id: string;
      trigger: string;
      task_version: number;
      actor_id: string | null;
      previous: Record<string, unknown> | null;
      current: AutomationEventCandidate["current"];
      depth: number;
      attempts: number;
      max_attempts: number;
      claim_token: string;
    }>(
      `with candidates as (
         select event.id
         from automation_events event
         where event.attempts < event.max_attempts
           and event.available_at <= now()
           and (
             event.status = 'pending'
             or (
               event.status = 'processing'
               and event.claimed_at < now() - make_interval(mins => $1)
             )
           )
         order by event.available_at, event.created_at, event.id
         for update skip locked
         limit $2
       )
       update automation_events event
       set status = 'processing',
           attempts = event.attempts + 1,
           claimed_at = now(),
           claim_token = gen_random_uuid(),
           last_error = null,
           updated_at = now()
       from candidates
       where event.id = candidates.id
       returning event.id, event.organization_id, event.workspace_id, event.task_id,
         event.trigger, event.task_version, event.actor_id, event.previous, event.current, event.depth,
         event.attempts, event.max_attempts, event.claim_token`,
      [options.claimTimeoutMinutes, options.batchSize],
    );
    await client.query("commit");
    return result.rows.map((row) => ({
      id: row.id,
      organizationId: row.organization_id,
      workspaceId: row.workspace_id,
      taskId: row.task_id,
      trigger: row.trigger,
      taskVersion: row.task_version,
      actorId: row.actor_id,
      previous: row.previous,
      current: row.current,
      depth: row.depth,
      attempt: row.attempts,
      maxAttempts: row.max_attempts,
      claimToken: row.claim_token,
    }));
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

function stringAction(actions: Record<string, unknown>, key: string, maxLength = 500) {
  const value = actions[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) {
    throw new Error(`Automation action ${key} is invalid`);
  }
  return value.trim();
}

function matchesConditions(conditions: Record<string, unknown>, task: TaskState) {
  if (conditions.status && conditions.status !== task.status) return false;
  if (conditions.priority && conditions.priority !== task.priority) return false;
  if (conditions.projectId && conditions.projectId !== task.project_id) return false;
  if (conditions.assigneeId && conditions.assigneeId !== task.assignee_id) return false;
  if (conditions.hasTag && !task.tags.includes(String(conditions.hasTag))) return false;
  return true;
}

async function saveRun(
  client: PoolClient,
  event: AutomationEventCandidate,
  ruleId: string,
  status: "success" | "failed" | "skipped",
  message: string,
  durationMs: number,
) {
  await client.query(
    `insert into automation_runs (
       organization_id, workspace_id, automation_id, event_id, task_id,
       status, attempt, message, duration_ms
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     on conflict (event_id, automation_id) do update
     set status = excluded.status,
         attempt = excluded.attempt,
         message = excluded.message,
         duration_ms = excluded.duration_ms,
         updated_at = now()`,
    [
      event.organizationId,
      event.workspaceId,
      ruleId,
      event.id,
      event.taskId,
      status,
      event.attempt,
      message.slice(0, 2000),
      durationMs,
    ],
  );
}

async function executeRule(pool: Pool, event: AutomationEventCandidate, ruleId: string) {
  const client = await pool.connect();
  const started = Date.now();
  try {
    await client.query("begin");

    // 1. FENCE: verify this worker's claim token is still authoritative
    const fenceCheck = await client.query<{ id: string }>(
      `select id
       from automation_events
       where id = $1 and status = 'processing' and claim_token = $2
       for update`,
      [event.id, event.claimToken],
    );
    if (!fenceCheck.rowCount) {
      await client.query("rollback");
      throw new Error("Automation event claim has expired or was superseded");
    }

    // 2. IDEMPOTENCY GATE: DB-backed execution gate BEFORE any irreversible effects
    const gateResult = await client.query<{ id: string }>(
      `insert into automation_runs (
         organization_id, workspace_id, automation_id, event_id, task_id,
         status, attempt, message, duration_ms
       ) values ($1, $2, $3, $4, $5, 'running', $6, 'Executing automation rule', 0)
       on conflict (event_id, automation_id) do update
       set status = 'running',
           attempt = excluded.attempt,
           message = 'Executing automation rule',
           updated_at = now()
       where automation_runs.status not in ('success', 'skipped')
         and (automation_runs.status != 'running' or excluded.attempt > automation_runs.attempt)
       returning id`,
      [event.organizationId, event.workspaceId, ruleId, event.id, event.taskId, event.attempt],
    );

    if (!gateResult.rowCount) {
      const existingRun = await client.query<{ status: string }>(
        `select status
         from automation_runs
         where event_id = $1 and automation_id = $2`,
        [event.id, ruleId],
      );
      await client.query("commit");
      return existingRun.rows[0]?.status ?? "skipped";
    }

    // 3. TENANT SCOPE: load rule and task strictly within (organizationId, workspaceId)
    const result = await client.query<{ rule: AutomationRule; task: TaskState }>(
      `select row_to_json(rule.*) as rule, row_to_json(task.*) as task
       from automations rule
       join tasks task
         on task.id = $2
        and task.organization_id = rule.organization_id
        and task.workspace_id = rule.workspace_id
       where rule.id = $1
         and rule.organization_id = $3
         and rule.workspace_id = $4
         and rule.deleted_at is null
         and task.deleted_at is null
       for update of rule, task`,
      [ruleId, event.taskId, event.organizationId, event.workspaceId],
    );
    const row = result.rows[0];
    if (!row || !row.rule.enabled || row.rule.trigger !== event.trigger) {
      await saveRun(
        client,
        event,
        ruleId,
        "skipped",
        "Rule is disabled or no longer matches the event",
        Date.now() - started,
      );
      await client.query("commit");
      return "skipped";
    }

    const conditions = row.rule.conditions ?? {};
    const actions = row.rule.actions ?? {};
    const eventTask = {
      ...row.task,
      status: event.current.status,
      priority: event.current.priority,
      project_id: event.current.projectId,
      assignee_id: event.current.assigneeId,
      tags: event.current.tags,
      version: event.current.version,
    };
    if (!matchesConditions(conditions, eventTask)) {
      await saveRun(client, event, ruleId, "skipped", "Conditions did not match", Date.now() - started);
      await client.query("commit");
      return "skipped";
    }

    // 4. VALIDATE ACTIONS AGAINST CANONICAL CONTRACTS
    const setStatus = stringAction(actions, "setStatus", 30);
    const setPriority = stringAction(actions, "setPriority", 30);
    const assignTo = stringAction(actions, "assignTo", 64);
    const addTag = stringAction(actions, "addTag", 100);
    const addComment = stringAction(actions, "addComment", 10_000);
    const notify = stringAction(actions, "notify", 20);
    const notifyTitle = stringAction(actions, "notifyTitle", 500);

    if (setStatus && !VALID_TASK_STATUSES.has(setStatus as TaskStatus)) {
      throw new Error("Automation status action is invalid");
    }
    if (setPriority && !VALID_TASK_PRIORITIES.has(setPriority as TaskPriority)) {
      throw new Error("Automation priority action is invalid");
    }
    if (notify && !["assignee", "reporter", "all"].includes(notify)) {
      throw new Error("Automation notification target is invalid");
    }
    if (assignTo) {
      const member = await client.query(
        `select 1 from memberships
         where user_id = $1 and organization_id = $2
           and (workspace_id = $3 or workspace_id is null)
           and status = 'active'
         limit 1`,
        [assignTo, event.organizationId, event.workspaceId],
      );
      if (!member.rowCount) throw new Error("Automation assignee is not an active tenant member");
    }

    // Commit the inspection lock before invoking canonical repositories that manage their own transactions
    await client.query("commit");

    // 5. CANONICAL TASK MUTATION
    const hasTaskMutation = Boolean(setStatus || setPriority || assignTo || addTag);
    let taskChanged = false;
    let latestAssigneeId = row.task.assignee_id;

    if (hasTaskMutation) {
      const claimCheck = await pool.query(
        `select 1 from automation_events
         where id = $1 and status = 'processing' and claim_token = $2`,
        [event.id, event.claimToken],
      );
      if (!claimCheck.rowCount) {
        throw new Error("Automation event claim has expired or was superseded");
      }

      const nextTags = addTag ? [...new Set([...row.task.tags, addTag])] : row.task.tags;
      const tagsChanged = JSON.stringify(nextTags) !== JSON.stringify(row.task.tags);

      const tasksRepo = createTasksRepository({
        organizationId: event.organizationId,
        workspaceId: event.workspaceId,
        actorId: event.actorId ?? undefined,
        automation: {
          depth: event.depth,
          parentEventId: event.id,
        },
      });

      const updateResult = await tasksRepo.update(event.taskId, {
        expectedVersion: row.task.version,
        status: setStatus ? (setStatus as TaskStatus) : undefined,
        priority: setPriority ? (setPriority as TaskPriority) : undefined,
        assigneeId: assignTo !== undefined ? assignTo : undefined,
        tags: tagsChanged ? nextTags : undefined,
      });

      taskChanged = updateResult.task.version !== updateResult.before.version;
      latestAssigneeId = updateResult.task.assigneeId;
    }

    // 6. CANONICAL COMMENT CREATION
    let commentCreated = false;
    if (addComment) {
      if (!event.actorId) {
        throw new Error("Automation comment action requires an authenticated actor");
      }
      const memberCheck = await pool.query(
        `select 1 from memberships
         where user_id = $1 and organization_id = $2
           and (workspace_id = $3 or workspace_id is null)
           and status = 'active'
         limit 1`,
        [event.actorId, event.organizationId, event.workspaceId],
      );
      if (!memberCheck.rowCount) {
        throw new Error("Automation comment actor is not an active tenant member");
      }

      const claimCheck = await pool.query(
        `select 1 from automation_events
         where id = $1 and status = 'processing' and claim_token = $2`,
        [event.id, event.claimToken],
      );
      if (!claimCheck.rowCount) {
        throw new Error("Automation event claim has expired or was superseded");
      }

      const commentsRepo = createCommentsRepository({
        organizationId: event.organizationId,
        workspaceId: event.workspaceId,
        actorId: event.actorId,
        automation: {
          depth: event.depth,
          parentEventId: event.id,
        },
      });

      await commentsRepo.create({
        taskId: event.taskId,
        userId: event.actorId,
        content: addComment,
      });
      commentCreated = true;
    }

    // 7. NOTIFICATION CREATION (DEDUPLICATED & TENANT-SAFE)
    let notificationSent = false;
    if (notify) {
      const recipients =
        notify === "assignee"
          ? [latestAssigneeId]
          : notify === "reporter"
            ? [row.task.reporter_id]
            : [latestAssigneeId, row.task.reporter_id];

      const validRecipients = [...new Set(recipients.filter((r): r is string => Boolean(r)))];
      const notificationsRepo = createNotificationsRepository({
        organizationId: event.organizationId,
        workspaceId: event.workspaceId,
        actorId: event.actorId ?? undefined,
      });

      for (const recipient of validRecipients) {
        const eligible = await pool.query(
          `select 1 from memberships
           where user_id = $1 and organization_id = $2
             and (workspace_id = $3 or workspace_id is null)
             and status = 'active'
           limit 1`,
          [recipient, event.organizationId, event.workspaceId],
        );
        if (!eligible.rowCount) continue;

        const notifResult = await pool.query(
          `insert into notifications (
             organization_id, workspace_id, user_id, type, title, body, entity_type, entity_id, deduplication_key, is_read
           )
           select $1, $2, $3, 'automation', $4, $5, 'task', $6, $7, false
           where exists (
             select 1 from automation_events
             where id = $8 and status = 'processing' and claim_token = $9
           )
           on conflict (organization_id, user_id, deduplication_key) where deduplication_key is not null do nothing
           returning id`,
          [
            event.organizationId,
            event.workspaceId,
            recipient,
            notifyTitle ?? `أتمتة: ${row.rule.name}`,
            `نُفذت قاعدة الأتمتة للمهمة ${row.task.serial}`,
            event.taskId,
            `automation-run/${event.id}/${ruleId}/${recipient}`,
            event.id,
            event.claimToken,
          ],
        );
        if (notifResult.rowCount && notifResult.rowCount > 0) {
          notificationSent = true;
        }
      }
    }

    // 8. TRUE NO-OP & EXECUTION ACCOUNTING
    const hasAnyGenuineEffect = taskChanged || commentCreated || notificationSent;
    const saveClient = await pool.connect();
    try {
      if (!hasAnyGenuineEffect && hasTaskMutation && !addComment && !notify) {
        await saveRun(
          saveClient,
          event,
          ruleId,
          "skipped",
          "No-op: task state already matches action",
          Date.now() - started,
        );
        return "skipped";
      }

      await saveRun(
        saveClient,
        event,
        ruleId,
        "success",
        `Executed actions (taskChanged: ${taskChanged}, comment: ${commentCreated}, notification: ${notificationSent})`,
        Date.now() - started,
      );

      if (hasAnyGenuineEffect) {
        await saveClient.query(
          `update automations
           set runs = coalesce(runs, 0) + 1, last_run_at = now(), updated_at = now()
           where id = $1
             and exists (
               select 1 from automation_events
               where id = $2 and status = 'processing' and claim_token = $3
             )`,
          [ruleId, event.id, event.claimToken],
        );
      }
      return "success";
    } finally {
      saveClient.release();
    }
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    const message = error instanceof Error ? error.message : "Unknown automation error";
    const failClient = await pool.connect();
    try {
      await saveRun(failClient, event, ruleId, "failed", message, Date.now() - started).catch(() => undefined);
    } finally {
      failClient.release();
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function completeEvent(client: PoolClient, event: AutomationEventCandidate, status: "sent" | "skipped") {
  assertValidEventTransition("processing", status);
  const result = await client.query(
    `update automation_events
     set status = $3,
         completed_at = now(),
         claimed_at = null,
         claim_token = null,
         last_error = null,
         updated_at = now()
     where id = $1 and status = 'processing' and claim_token = $2`,
    [event.id, event.claimToken, status],
  );
  if (!result.rowCount) {
    throw new Error("Failed to complete automation event: claim token expired or was superseded");
  }
}

export async function releaseEvent(client: PoolClient, event: AutomationEventCandidate, error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown automation event error";
  const backoffSeconds = Math.min(3600, 5 * 2 ** Math.max(event.attempt - 1, 0));
  const isDead = event.attempt >= event.maxAttempts;
  const targetStatus: AutomationEventStatus = isDead ? "dead" : "pending";
  assertValidEventTransition("processing", targetStatus);

  const result = await client.query(
    `update automation_events
     set status = case when attempts >= max_attempts then 'dead'::automation_event_status else 'pending'::automation_event_status end,
         available_at = case when attempts >= max_attempts then available_at else now() + make_interval(secs => $3) end,
         claimed_at = null,
         claim_token = null,
         last_error = $4,
         updated_at = now()
     where id = $1 and status = 'processing' and claim_token = $2`,
    [event.id, event.claimToken, backoffSeconds, message.slice(0, 2000)],
  );
  if (!result.rowCount) {
    return;
  }
}

export async function processAutomationEvents(
  pool: Pool,
  options: AutomationEventOptions = readAutomationEventOptions(),
) {
  const claimClient = await pool.connect();
  let candidates: AutomationEventCandidate[];
  try {
    candidates = await claimAutomationEventBatch(claimClient, options);
  } finally {
    claimClient.release();
  }

  let completed = 0;
  let skipped = 0;
  let failed = 0;
  for (const event of candidates) {
    const stateClient = await pool.connect();
    try {
      // LOOP PROTECTION: depth >= 5 safely skips without side effects
      if (event.depth >= MAX_AUTOMATION_DEPTH) {
        await completeEvent(stateClient, event, "skipped");
        skipped += 1;
        continue;
      }

      const rules = await stateClient.query<{ id: string }>(
        `select id
         from automations
         where organization_id = $1 and workspace_id = $2
           and trigger = $3 and enabled = true and deleted_at is null
         order by created_at, id`,
        [event.organizationId, event.workspaceId, event.trigger],
      );
      if (!rules.rowCount) {
        await completeEvent(stateClient, event, "skipped");
        skipped += 1;
        continue;
      }
      for (const rule of rules.rows) {
        await executeRule(pool, event, rule.id);
      }
      await completeEvent(stateClient, event, "sent");
      completed += 1;
    } catch (error) {
      await releaseEvent(stateClient, event, error);
      failed += 1;
    } finally {
      stateClient.release();
    }
  }
  return { claimed: candidates.length, completed, skipped, failed };
}

export async function enqueueDailyAutomationEvents(
  pool: Pool,
  options?: { date?: string; organizationId?: string; workspaceId?: string },
) {
  const dateExpr = options?.date ? "$1" : "to_char(current_date, 'YYYY-MM-DD')";
  const params: unknown[] = options?.date ? [options.date] : [];
  let tenantFilter = "";
  if (options?.organizationId) {
    params.push(options.organizationId);
    tenantFilter += ` and task.organization_id = $${params.length}`;
  }
  if (options?.workspaceId) {
    params.push(options.workspaceId);
    tenantFilter += ` and task.workspace_id = $${params.length}`;
  }

  const result = await pool.query(
    `insert into automation_events (
       organization_id, workspace_id, task_id, trigger, task_version,
       actor_id, previous, current, depth, deduplication_key
     )
     select task.organization_id,
            task.workspace_id,
            task.id,
            'schedule_daily',
            task.version,
            null,
            null,
            jsonb_build_object(
              'status', task.status,
              'priority', task.priority,
              'projectId', task.project_id,
              'assigneeId', task.assignee_id,
              'tags', task.tags,
              'version', task.version
            ),
            0,
            'schedule-daily/' || ${dateExpr} || '/task/' || task.id::text
     from tasks task
     where task.deleted_at is null
       ${tenantFilter}
       and exists (
         select 1
         from automations rule
         where rule.organization_id = task.organization_id
           and rule.workspace_id = task.workspace_id
           and rule.trigger = 'schedule_daily'
           and rule.enabled = true
           and rule.deleted_at is null
       )
     on conflict (deduplication_key) do nothing`,
    params,
  );
  return { enqueued: result.rowCount ?? 0 };
}
