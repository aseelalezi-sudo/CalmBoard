import type { Pool, PoolClient } from "pg";

export const formSubmissionJobName = "forms.create-submission-tasks";

export type FormSubmissionOptions = {
  batchSize: number;
  claimTimeoutMinutes: number;
};

export type FormTaskCreationCandidate = {
  id: string;
  organizationId: string;
  workspaceId: string;
  payload: {
    projectId: string;
    title: string;
    description: string;
    status: "backlog" | "todo" | "in_progress" | "review";
    priority: "low" | "medium" | "high" | "urgent";
  };
  attempt: number;
  maxAttempts: number;
  claimToken: string;
};

export function readFormSubmissionOptions(env: NodeJS.ProcessEnv = process.env): FormSubmissionOptions {
  const integer = (name: string, fallback: number, minimum: number, maximum: number) => {
    const value = env[name] === undefined ? fallback : Number(env[name]);
    if (!Number.isInteger(value) || value < minimum || value > maximum) {
      throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
    }
    return value;
  };
  return {
    batchSize: integer("FORM_SUBMISSION_BATCH_SIZE", 25, 1, 250),
    claimTimeoutMinutes: integer("FORM_SUBMISSION_CLAIM_TIMEOUT_MINUTES", 15, 1, 1440),
  };
}

export async function claimFormTaskCreationBatch(
  client: PoolClient,
  options: FormSubmissionOptions,
): Promise<FormTaskCreationCandidate[]> {
  await client.query("begin");
  try {
    const result = await client.query<{
      id: string;
      organization_id: string;
      workspace_id: string;
      task_creation_payload: FormTaskCreationCandidate["payload"];
      task_creation_attempts: number;
      task_creation_max_attempts: number;
      task_creation_claim_token: string;
    }>(
      `with candidates as (
         select response.id
         from form_responses response
         where response.task_creation_attempts < response.task_creation_max_attempts
           and response.task_creation_available_at <= now()
           and (
             response.task_creation_status = 'pending'
             or (
               response.task_creation_status = 'processing'
               and response.task_creation_claimed_at < now() - make_interval(mins => $1)
             )
           )
         order by response.task_creation_available_at, response.submitted_at, response.id
         for update skip locked
         limit $2
       )
       update form_responses response
       set task_creation_status = 'processing',
           task_creation_attempts = response.task_creation_attempts + 1,
           task_creation_claimed_at = now(),
           task_creation_claim_token = gen_random_uuid(),
           task_creation_last_error = null
       from candidates
       where response.id = candidates.id
       returning response.id, response.organization_id, response.workspace_id,
         response.task_creation_payload, response.task_creation_attempts,
         response.task_creation_max_attempts, response.task_creation_claim_token`,
      [options.claimTimeoutMinutes, options.batchSize],
    );
    await client.query("commit");
    return result.rows.map((row) => ({
      id: row.id,
      organizationId: row.organization_id,
      workspaceId: row.workspace_id,
      payload: row.task_creation_payload,
      attempt: row.task_creation_attempts,
      maxAttempts: row.task_creation_max_attempts,
      claimToken: row.task_creation_claim_token,
    }));
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

function assertPayload(payload: FormTaskCreationCandidate["payload"]) {
  if (!payload || typeof payload !== "object") throw new Error("Form task creation payload is missing");
  if (typeof payload.projectId !== "string" || !payload.projectId) throw new Error("Form project is missing");
  if (typeof payload.title !== "string" || !payload.title || payload.title.length > 500) {
    throw new Error("Form task title is invalid");
  }
  if (typeof payload.description !== "string" || payload.description.length > 100_000) {
    throw new Error("Form task description is invalid");
  }
  if (!["backlog", "todo", "in_progress", "review"].includes(payload.status)) {
    throw new Error("Form task status is invalid");
  }
  if (!["low", "medium", "high", "urgent"].includes(payload.priority)) {
    throw new Error("Form task priority is invalid");
  }
}

async function createTaskForResponse(client: PoolClient, candidate: FormTaskCreationCandidate) {
  assertPayload(candidate.payload);
  await client.query("begin");
  try {
    const locked = await client.query<{ created_task_id: string | null }>(
      `select created_task_id
       from form_responses
       where id = $1 and organization_id = $2 and workspace_id = $3
         and task_creation_status = 'processing' and task_creation_claim_token = $4
       for update`,
      [candidate.id, candidate.organizationId, candidate.workspaceId, candidate.claimToken],
    );
    if (!locked.rowCount) {
      await client.query("rollback");
      return "stale" as const;
    }
    if (locked.rows[0]?.created_task_id) {
      throw new Error("Form response is already linked to a task but is not completed");
    }

    const project = await client.query(
      `select 1 from projects
       where id = $1 and organization_id = $2 and workspace_id = $3 and deleted_at is null
       limit 1`,
      [candidate.payload.projectId, candidate.organizationId, candidate.workspaceId],
    );
    if (!project.rowCount) throw new Error("Form target project is unavailable");

    const sequence = await client.query<{ serial_number: number }>(
      `insert into task_serial_sequences (organization_id, next_value, updated_at)
       values ($1, 1042, now())
       on conflict (organization_id) do update
       set next_value = task_serial_sequences.next_value + 1, updated_at = now()
       returning next_value - 1 as serial_number`,
      [candidate.organizationId],
    );
    const serialNumber = sequence.rows[0]?.serial_number;
    if (!Number.isSafeInteger(serialNumber)) throw new Error("Task serial allocation failed");
    const serial = `TASK-${serialNumber}`;
    const task = await client.query<{ id: string; serial: string }>(
      `insert into tasks (
         organization_id, workspace_id, project_id, serial, title, description,
         status, priority, "order", tags
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, '["form"]'::jsonb)
       returning id, serial`,
      [
        candidate.organizationId,
        candidate.workspaceId,
        candidate.payload.projectId,
        serial,
        candidate.payload.title,
        candidate.payload.description,
        candidate.payload.status,
        candidate.payload.priority,
        serialNumber - 1041,
      ],
    );
    const createdTask = task.rows[0];
    if (!createdTask) throw new Error("Task creation did not return a record");

    await client.query(
      `insert into automation_events (
         organization_id, workspace_id, task_id, trigger, task_version,
         actor_id, current, depth, deduplication_key
       ) values ($1, $2, $3, 'task_created', 1, null, $4::jsonb, 0, $5)
       on conflict (deduplication_key) do nothing`,
      [
        candidate.organizationId,
        candidate.workspaceId,
        createdTask.id,
        JSON.stringify({
          status: candidate.payload.status,
          priority: candidate.payload.priority,
          projectId: candidate.payload.projectId,
          assigneeId: null,
          tags: ["form"],
          version: 1,
        }),
        `form-response/${candidate.id}/task-created`,
      ],
    );
    await client.query(
      `update form_responses
       set created_task_id = $2,
           task_creation_status = 'completed',
           task_creation_completed_at = now(),
           task_creation_claimed_at = null,
           task_creation_claim_token = null,
           task_creation_last_error = null
       where id = $1 and task_creation_status = 'processing' and task_creation_claim_token = $3`,
      [candidate.id, createdTask.id, candidate.claimToken],
    );
    await client.query("commit");
    return "completed" as const;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  }
}

async function releaseFormTaskCreation(client: PoolClient, candidate: FormTaskCreationCandidate, error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown form task creation error";
  const backoffSeconds = Math.min(3600, 5 * 2 ** Math.max(candidate.attempt - 1, 0));
  await client.query(
    `update form_responses
     set task_creation_status = case
           when task_creation_attempts >= task_creation_max_attempts then 'dead'
           else 'pending'
         end,
         task_creation_available_at = case
           when task_creation_attempts >= task_creation_max_attempts then task_creation_available_at
           else now() + make_interval(secs => $3)
         end,
         task_creation_claimed_at = null,
         task_creation_claim_token = null,
         task_creation_last_error = $4
     where id = $1 and task_creation_status = 'processing' and task_creation_claim_token = $2`,
    [candidate.id, candidate.claimToken, backoffSeconds, message.slice(0, 2000)],
  );
}

export async function processFormSubmissionTasks(
  pool: Pool,
  options: FormSubmissionOptions = readFormSubmissionOptions(),
) {
  const claimClient = await pool.connect();
  let candidates: FormTaskCreationCandidate[];
  try {
    candidates = await claimFormTaskCreationBatch(claimClient, options);
  } finally {
    claimClient.release();
  }

  let completed = 0;
  let stale = 0;
  let failed = 0;
  for (const candidate of candidates) {
    const client = await pool.connect();
    try {
      const result = await createTaskForResponse(client, candidate);
      if (result === "completed") completed += 1;
      else stale += 1;
    } catch (error) {
      await releaseFormTaskCreation(client, candidate, error);
      failed += 1;
    } finally {
      client.release();
    }
  }
  return { claimed: candidates.length, completed, stale, failed };
}
