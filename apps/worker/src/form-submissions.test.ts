import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { Pool, type PoolClient } from "pg";
import {
  claimFormTaskCreationBatch,
  processFormSubmissionTasks,
  readFormSubmissionOptions,
  type FormTaskCreationCandidate,
} from "./form-submissions.js";

const candidate: FormTaskCreationCandidate = {
  id: "response-1",
  organizationId: "organization-1",
  workspaceId: "workspace-1",
  payload: {
    projectId: "project-1",
    title: "[Intake] Customer request",
    description: "Please review",
    status: "todo",
    priority: "high",
  },
  attempt: 1,
  maxAttempts: 5,
  claimToken: "claim-1",
};

describe("form submission task worker", () => {
  it("validates bounded polling options", () => {
    assert.deepEqual(
      readFormSubmissionOptions({
        FORM_SUBMISSION_BATCH_SIZE: "20",
        FORM_SUBMISSION_CLAIM_TIMEOUT_MINUTES: "10",
      }),
      { batchSize: 20, claimTimeoutMinutes: 10 },
    );
    assert.throws(() => readFormSubmissionOptions({ FORM_SUBMISSION_BATCH_SIZE: "0" }), /between 1 and 250/);
  });

  it("claims durable task requests with skip-locked crash recovery", async () => {
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
                  task_creation_payload: candidate.payload,
                  task_creation_attempts: candidate.attempt,
                  task_creation_max_attempts: candidate.maxAttempts,
                  task_creation_claim_token: candidate.claimToken,
                },
              ],
            }
          : { rows: [] };
      },
    } as unknown as PoolClient;

    assert.deepEqual(await claimFormTaskCreationBatch(client, { batchSize: 25, claimTimeoutMinutes: 15 }), [candidate]);
    assert.equal(statements[0], "begin");
    assert.match(statements[1] ?? "", /for update skip locked/);
    assert.match(statements[1] ?? "", /task_creation_attempts = response\.task_creation_attempts \+ 1/);
    assert.match(statements[1] ?? "", /gen_random_uuid/);
    assert.equal(statements[2], "commit");
  });

  it(
    "creates one task and automation event for a durable form response",
    { skip: !process.env.DATABASE_MAINTENANCE_URL },
    async () => {
      const pool = new Pool({ connectionString: process.env.DATABASE_MAINTENANCE_URL, max: 4 });
      const organizationId = randomUUID();
      const workspaceId = randomUUID();
      const projectId = randomUUID();
      const formId = randomUUID();
      const responseId = randomUUID();
      try {
        await pool.query("insert into organizations (id, name, slug) values ($1, 'Form tenant', $2)", [
          organizationId,
          `form-${organizationId}`,
        ]);
        await pool.query(
          "insert into workspaces (id, organization_id, name, slug) values ($1, $2, 'Form workspace', $3)",
          [workspaceId, organizationId, `form-${workspaceId}`],
        );
        await pool.query(
          "insert into projects (id, organization_id, workspace_id, name) values ($1, $2, $3, 'Form project')",
          [projectId, organizationId, workspaceId],
        );
        await pool.query(
          `insert into forms (id, organization_id, workspace_id, project_id, name, fields, settings)
           values ($1, $2, $3, $4, 'Intake', '[]'::jsonb, $5::jsonb)`,
          [formId, organizationId, workspaceId, projectId, JSON.stringify({ schemaVersion: 1, createTask: true })],
        );
        await pool.query(
          `insert into form_responses (
             id, organization_id, workspace_id, form_id, data,
             task_creation_payload, task_creation_status
           ) values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, 'pending')`,
          [
            responseId,
            organizationId,
            workspaceId,
            formId,
            JSON.stringify({ title: "Customer request" }),
            JSON.stringify({
              projectId,
              title: "[Intake] Customer request",
              description: "Please review",
              status: "todo",
              priority: "high",
            }),
          ],
        );

        await processFormSubmissionTasks(pool, { batchSize: 25, claimTimeoutMinutes: 15 });
        await processFormSubmissionTasks(pool, { batchSize: 25, claimTimeoutMinutes: 15 });

        const state = await pool.query<{
          task_creation_status: string;
          task_count: number;
          event_count: number;
          created_task_id: string | null;
        }>(
          `select response.task_creation_status, response.created_task_id,
             (select count(*)::int from tasks where organization_id = $2 and tags @> '["form"]'::jsonb) as task_count,
             (select count(*)::int from automation_events where deduplication_key = $3) as event_count
           from form_responses response where response.id = $1`,
          [responseId, organizationId, `form-response/${responseId}/task-created`],
        );
        assert.equal(state.rows[0]?.task_creation_status, "completed");
        assert.ok(state.rows[0]?.created_task_id);
        assert.equal(state.rows[0]?.task_count, 1);
        assert.equal(state.rows[0]?.event_count, 1);
      } finally {
        await pool.query("delete from automation_events where organization_id = $1", [organizationId]);
        await pool.query("delete from form_responses where organization_id = $1", [organizationId]);
        await pool.query("delete from tasks where organization_id = $1", [organizationId]);
        await pool.query("delete from forms where organization_id = $1", [organizationId]);
        await pool.query("delete from projects where organization_id = $1", [organizationId]);
        await pool.query("delete from workspaces where organization_id = $1", [organizationId]);
        await pool.query("delete from organizations where id = $1", [organizationId]);
        await pool.end();
      }
    },
  );
});
