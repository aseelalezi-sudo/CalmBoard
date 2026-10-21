import type { Pool, PoolClient } from "pg";
import { sql } from "drizzle-orm";
import {
  createCommentsRepository,
  createNotificationsRepository,
  createTasksRepository,
  withTenantTransaction,
  db,
  VALID_TASK_PRIORITIES,
  VALID_TASK_STATUSES,
  type DatabaseTenantContext,
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

export async function saveRun(
  client: PoolClient | Pool,
  event: AutomationEventCandidate,
  ruleId: string,
  status: "success" | "failed" | "skipped",
  message: string,
  durationMs: number,
): Promise<boolean> {
  const result = await client.query(
    `insert into automation_runs (
       organization_id, workspace_id, automation_id, event_id, task_id,
       status, attempt, claim_token, message, duration_ms
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     on conflict (event_id, automation_id) do update
     set status = excluded.status,
         attempt = excluded.attempt,
         claim_token = excluded.claim_token,
         message = excluded.message,
         duration_ms = excluded.duration_ms,
         updated_at = now()
     where automation_runs.claim_token = excluded.claim_token
       and automation_runs.status not in ('success', 'skipped')`,
    [
      event.organizationId,
      event.workspaceId,
      ruleId,
      event.id,
      event.taskId,
      status,
      event.attempt,
      event.claimToken,
      message.slice(0, 2000),
      durationMs,
    ],
  );
  return Boolean(result.rowCount && result.rowCount > 0);
}

export async function executeRule(pool: Pool, event: AutomationEventCandidate, ruleId: string) {
  const started = Date.now();

  const tenantContext: DatabaseTenantContext = {
    organizationId: event.organizationId,
    workspaceId: event.workspaceId,
    actorId: event.actorId ?? undefined,
    automation: {
      depth: event.depth,
      parentEventId: event.id,
    },
  };

  try {
    return await withTenantTransaction(tenantContext, async () => {
      // 1. FENCE: atomically verify and lock the claim row
      const claimCheck = await db.execute(sql`
        select id, claim_token, status
        from automation_events
        where id = ${event.id}
          and status = 'processing'
          and claim_token = ${event.claimToken}
        for update
      `);
      if (!claimCheck.rowCount) {
        throw new Error("Automation event claim has expired or was superseded");
      }

      // 2. IDEMPOTENCY GATE: DB-backed execution gate BEFORE any irreversible effects
      const gateResult = await db.execute(sql`
        insert into automation_runs (
          organization_id, workspace_id, automation_id, event_id, task_id,
          status, attempt, claim_token, message, duration_ms
        ) values (
          ${event.organizationId}, ${event.workspaceId}, ${ruleId}, ${event.id}, ${event.taskId},
          'running', ${event.attempt}, ${event.claimToken}, 'Executing automation rule', 0
        )
        on conflict (event_id, automation_id) do update
        set status = 'running',
            attempt = excluded.attempt,
            claim_token = excluded.claim_token,
            message = 'Executing automation rule',
            updated_at = now()
        where automation_runs.status not in ('success', 'skipped')
          and (automation_runs.status != 'running' or excluded.attempt > automation_runs.attempt)
        returning id
      `);

      if (!gateResult.rowCount) {
        const existingRun = await db.execute(sql`
          select status
          from automation_runs
          where event_id = ${event.id} and automation_id = ${ruleId}
        `);
        return ((existingRun.rows[0]?.status as string) ?? "skipped") as "success" | "skipped" | "failed";
      }

      // 3. TENANT SCOPE: load rule and task strictly within (organizationId, workspaceId)
      const result = await db.execute(sql`
        select row_to_json(rule.*) as rule, row_to_json(task.*) as task
        from automations rule
        join tasks task
          on task.id = ${event.taskId}
         and task.organization_id = rule.organization_id
         and task.workspace_id = rule.workspace_id
        where rule.id = ${ruleId}
          and rule.organization_id = ${event.organizationId}
          and rule.workspace_id = ${event.workspaceId}
          and rule.deleted_at is null
          and task.deleted_at is null
        for update of rule, task
      `);
      const row = result.rows[0] as { rule: AutomationRule; task: TaskState } | undefined;
      if (!row || !row.rule.enabled || row.rule.trigger !== event.trigger) {
        await db.execute(sql`
          update automation_runs
          set status = 'skipped',
              message = 'Rule is disabled or no longer matches the event',
              duration_ms = ${Date.now() - started},
              updated_at = now()
          where event_id = ${event.id}
            and automation_id = ${ruleId}
            and claim_token = ${event.claimToken}
            and status = 'running'
        `);
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
        await db.execute(sql`
          update automation_runs
          set status = 'skipped',
              message = 'Conditions did not match',
              duration_ms = ${Date.now() - started},
              updated_at = now()
          where event_id = ${event.id}
            and automation_id = ${ruleId}
            and claim_token = ${event.claimToken}
            and status = 'running'
        `);
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
        const member = await db.execute(sql`
          select 1 from memberships
          where user_id = ${assignTo} and organization_id = ${event.organizationId}
            and (workspace_id = ${event.workspaceId} or workspace_id is null)
            and status = 'active'
          limit 1
        `);
        if (!member.rowCount) throw new Error("Automation assignee is not an active tenant member");
      }

      // 5. CANONICAL TASK MUTATION
      const hasTaskMutation = Boolean(setStatus || setPriority || assignTo || addTag);
      let taskChanged = false;
      let latestAssigneeId = row.task.assignee_id;

      if (hasTaskMutation) {
        const nextTags = addTag ? [...new Set([...row.task.tags, addTag])] : row.task.tags;
        const tagsChanged = JSON.stringify(nextTags) !== JSON.stringify(row.task.tags);

        const tasksRepo = createTasksRepository(tenantContext);
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

      // 6. CANONICAL COMMENT CREATION (DEDUPLICATED & FENCED)
      let commentCreated = false;
      if (addComment) {
        if (!event.actorId) {
          throw new Error("Automation comment action requires an authenticated actor");
        }
        const memberCheck = await db.execute(sql`
          select 1 from memberships
          where user_id = ${event.actorId} and organization_id = ${event.organizationId}
            and (workspace_id = ${event.workspaceId} or workspace_id is null)
            and status = 'active'
          limit 1
        `);
        if (!memberCheck.rowCount) {
          throw new Error("Automation comment actor is not an active tenant member");
        }

        const commentsRepo = createCommentsRepository(tenantContext);
        const commentDeduplicationKey = `automation-comment/${event.id}/${ruleId}/comment`;
        const commentResult = await commentsRepo.create({
          taskId: event.taskId,
          userId: event.actorId,
          content: addComment,
          deduplicationKey: commentDeduplicationKey,
        });
        commentCreated = !("alreadyExisted" in commentResult && commentResult.alreadyExisted);
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

        for (const recipient of validRecipients) {
          const eligible = await db.execute(sql`
            select 1 from memberships
            where user_id = ${recipient} and organization_id = ${event.organizationId}
              and (workspace_id = ${event.workspaceId} or workspace_id is null)
              and status = 'active'
            limit 1
          `);
          if (!eligible.rowCount) continue;

          const notifResult = await db.execute(sql`
            insert into notifications (
              organization_id, workspace_id, user_id, type, title, body, entity_type, entity_id, deduplication_key, is_read
            )
            select ${event.organizationId}, ${event.workspaceId}, ${recipient}, 'automation',
                   ${notifyTitle ?? `أتمتة: ${row.rule.name}`}, ${`نُفذت قاعدة الأتمتة للمهمة ${row.task.serial}`},
                   'task', ${event.taskId}, ${`automation-run/${event.id}/${ruleId}/${recipient}`}, false
            where exists (
              select 1 from automation_events
              where id = ${event.id} and status = 'processing' and claim_token = ${event.claimToken}
            )
            on conflict (organization_id, user_id, deduplication_key) where deduplication_key is not null do nothing
            returning id
          `);
          if (notifResult.rowCount && notifResult.rowCount > 0) {
            notificationSent = true;
          }
        }
      }

      // 8. TRUE NO-OP & EXECUTION ACCOUNTING
      const hasAnyGenuineEffect = taskChanged || commentCreated || notificationSent;
      if (!hasAnyGenuineEffect && hasTaskMutation && !addComment && !notify) {
        await db.execute(sql`
          update automation_runs
          set status = 'skipped',
              message = 'No-op: task state already matches action',
              duration_ms = ${Date.now() - started},
              updated_at = now()
          where event_id = ${event.id}
            and automation_id = ${ruleId}
            and claim_token = ${event.claimToken}
            and status = 'running'
        `);
        return "skipped";
      }

      await db.execute(sql`
        update automation_runs
        set status = 'success',
            message = ${`Executed actions (taskChanged: ${taskChanged}, comment: ${commentCreated}, notification: ${notificationSent})`},
            duration_ms = ${Date.now() - started},
            updated_at = now()
        where event_id = ${event.id}
          and automation_id = ${ruleId}
          and claim_token = ${event.claimToken}
          and status = 'running'
      `);

      if (hasAnyGenuineEffect) {
        await db.execute(sql`
          update automations
          set runs = coalesce(runs, 0) + 1, last_run_at = now(), updated_at = now()
          where id = ${ruleId}
            and exists (
              select 1 from automation_runs
              where event_id = ${event.id}
                and automation_id = ${ruleId}
                and claim_token = ${event.claimToken}
                and status = 'success'
            )
            and exists (
              select 1 from automation_events
              where id = ${event.id}
                and status = 'processing'
                and claim_token = ${event.claimToken}
            )
        `);
      }
      return "success";
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown automation error";
    if (!message.includes("claim has expired or was superseded")) {
      await pool
        .query(
          `update automation_runs
         set status = 'failed',
             message = $3,
             duration_ms = $4,
             updated_at = now()
         where event_id = $1
           and automation_id = $2
           and claim_token = $5
           and status = 'running'`,
          [event.id, ruleId, message.slice(0, 2000), Date.now() - started, event.claimToken],
        )
        .catch(() => undefined);
    }
    throw error;
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
      // A failing rule must not starve the rules after it: run them all, then retry the event once if any failed.
      // Succeeded and skipped rules are gated by the per-(event, rule) idempotency run, so retries stay exactly-once.
      let ruleError: unknown;
      for (const rule of rules.rows) {
        try {
          await executeRule(pool, event, rule.id);
        } catch (error) {
          if (error instanceof Error && error.message.includes("claim has expired or was superseded")) throw error;
          ruleError ??= error;
        }
      }
      if (ruleError !== undefined) throw ruleError;
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
