import type { Pool, PoolClient } from "pg";

export const automationEventJobName = "automations.process-events";
export const automationDailyJobName = "automations.enqueue-daily";

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

const taskStatuses = new Set(["todo", "in_progress", "review", "done"]);
const taskPriorities = new Set(["low", "medium", "high", "urgent"]);

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
     ) values ($1, $2, $3, $4, $5, $6, 1, $7, $8)
     on conflict (event_id, automation_id) do update
     set status = excluded.status,
         attempt = automation_runs.attempt + 1,
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
    const completed = await client.query<{ status: string }>(
      `select status
       from automation_runs
       where event_id = $1 and automation_id = $2
       for update`,
      [event.id, ruleId],
    );
    if (completed.rows[0]?.status === "success" || completed.rows[0]?.status === "skipped") {
      await client.query("commit");
      return completed.rows[0].status;
    }

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

    const setStatus = stringAction(actions, "setStatus", 30);
    const setPriority = stringAction(actions, "setPriority", 30);
    const assignTo = stringAction(actions, "assignTo", 64);
    const addTag = stringAction(actions, "addTag", 100);
    const addComment = stringAction(actions, "addComment", 10_000);
    const notify = stringAction(actions, "notify", 20);
    const notifyTitle = stringAction(actions, "notifyTitle", 500);
    if (setStatus && !taskStatuses.has(setStatus)) throw new Error("Automation status action is invalid");
    if (setPriority && !taskPriorities.has(setPriority)) throw new Error("Automation priority action is invalid");
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

    const nextStatus = setStatus ?? row.task.status;
    const nextPriority = setPriority ?? row.task.priority;
    const nextProgress = nextStatus === "done" ? 100 : row.task.progress;
    const nextAssignee = assignTo ?? row.task.assignee_id;
    const nextTags = addTag ? [...new Set([...row.task.tags, addTag])] : row.task.tags;
    const changedTriggers: string[] = [];
    if (nextStatus !== row.task.status) changedTriggers.push("task_status_changed");
    if (nextPriority !== row.task.priority) changedTriggers.push("task_priority_changed");
    if (nextAssignee !== row.task.assignee_id) changedTriggers.push("task_assignee_changed");
    const tagsChanged = JSON.stringify(nextTags) !== JSON.stringify(row.task.tags);
    const progressChanged = nextProgress !== row.task.progress;

    let nextVersion = row.task.version;
    if (changedTriggers.length || tagsChanged || progressChanged) {
      const updated = await client.query<{ version: number }>(
        `update tasks
         set status = $2,
             priority = $3,
             progress = $4,
             assignee_id = $5,
             tags = $6::jsonb,
             version = version + 1,
             updated_at = now()
         where id = $1
         returning version`,
        [event.taskId, nextStatus, nextPriority, nextProgress, nextAssignee, JSON.stringify(nextTags)],
      );
      nextVersion = updated.rows[0]!.version;
      if (event.depth < 5) {
        for (const trigger of changedTriggers) {
          await client.query(
            `insert into automation_events (
             organization_id, workspace_id, task_id, trigger, task_version,
             actor_id, previous, current, depth, parent_event_id, deduplication_key
           ) values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11)
             on conflict (deduplication_key) do nothing`,
            [
              event.organizationId,
              event.workspaceId,
              event.taskId,
              trigger,
              nextVersion,
              event.actorId,
              JSON.stringify({
                status: row.task.status,
                priority: row.task.priority,
                assigneeId: row.task.assignee_id,
                version: row.task.version,
              }),
              JSON.stringify({
                status: nextStatus,
                priority: nextPriority,
                projectId: row.task.project_id,
                assigneeId: nextAssignee,
                tags: nextTags,
                version: nextVersion,
              }),
              event.depth + 1,
              event.id,
              `task/${event.taskId}/version/${nextVersion}/${trigger}`,
            ],
          );
        }
      }
    }

    if (addComment && event.actorId) {
      const comment = await client.query<{ id: string }>(
        `insert into comments (
           organization_id, workspace_id, task_id, user_id, content
         ) values ($1, $2, $3, $4, $5)
         returning id`,
        [event.organizationId, event.workspaceId, event.taskId, event.actorId, addComment],
      );
      if (event.depth < 5) {
        await client.query(
          `insert into automation_events (
             organization_id, workspace_id, task_id, trigger, task_version,
             actor_id, current, depth, parent_event_id, deduplication_key
           ) values ($1, $2, $3, 'comment_added', $4, $5, $6::jsonb, $7, $8, $9)
           on conflict (deduplication_key) do nothing`,
          [
            event.organizationId,
            event.workspaceId,
            event.taskId,
            nextVersion,
            event.actorId,
            JSON.stringify({
              status: nextStatus,
              priority: nextPriority,
              projectId: row.task.project_id,
              assigneeId: nextAssignee,
              tags: nextTags,
              version: nextVersion,
            }),
            event.depth + 1,
            event.id,
            `comment/${comment.rows[0]!.id}/comment_added`,
          ],
        );
      }
    }

    if (notify) {
      const recipients =
        notify === "assignee"
          ? [nextAssignee]
          : notify === "reporter"
            ? [row.task.reporter_id]
            : [nextAssignee, row.task.reporter_id];
      for (const recipient of [...new Set(recipients.filter((value): value is string => Boolean(value)))]) {
        const eligible = await client.query(
          `select 1 from memberships
           where user_id = $1 and organization_id = $2
             and (workspace_id = $3 or workspace_id is null)
             and status = 'active'
           limit 1`,
          [recipient, event.organizationId, event.workspaceId],
        );
        if (!eligible.rowCount) continue;
        await client.query(
          `insert into notifications (
             organization_id, workspace_id, user_id, type, title, body, entity_type, entity_id, is_read
           ) values ($1, $2, $3, 'automation', $4, $5, 'task', $6, false)`,
          [
            event.organizationId,
            event.workspaceId,
            recipient,
            notifyTitle ?? `أتمتة: ${row.rule.name}`,
            `نُفذت قاعدة الأتمتة للمهمة ${row.task.serial}`,
            event.taskId,
          ],
        );
      }
    }

    await saveRun(
      client,
      event,
      ruleId,
      "success",
      `Executed ${Object.keys(actions).length} actions`,
      Date.now() - started,
    );
    await client.query(
      `update automations
       set runs = coalesce(runs, 0) + 1, last_run_at = now(), updated_at = now()
       where id = $1`,
      [ruleId],
    );
    await client.query("commit");
    return "success";
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    const message = error instanceof Error ? error.message : "Unknown automation error";
    await saveRun(client, event, ruleId, "failed", message, Date.now() - started).catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function completeEvent(client: PoolClient, event: AutomationEventCandidate, status: "sent" | "skipped") {
  await client.query(
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
}

async function releaseEvent(client: PoolClient, event: AutomationEventCandidate, error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown automation event error";
  const backoffSeconds = Math.min(3600, 5 * 2 ** Math.max(event.attempt - 1, 0));
  await client.query(
    `update automation_events
     set status = case when attempts >= max_attempts then 'dead'::notification_email_status else 'pending'::notification_email_status end,
         available_at = case when attempts >= max_attempts then available_at else now() + make_interval(secs => $3) end,
         claimed_at = null,
         claim_token = null,
         last_error = $4,
         updated_at = now()
     where id = $1 and status = 'processing' and claim_token = $2`,
    [event.id, event.claimToken, backoffSeconds, message.slice(0, 2000)],
  );
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
      for (const rule of rules.rows) await executeRule(pool, event, rule.id);
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

export async function enqueueDailyAutomationEvents(pool: Pool) {
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
            'schedule-daily/' || to_char(current_date, 'YYYY-MM-DD') || '/task/' || task.id::text
     from tasks task
     where task.deleted_at is null
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
  );
  return { enqueued: result.rowCount ?? 0 };
}
