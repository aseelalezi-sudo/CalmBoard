import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { Pool } from "pg";
import {
  createExportJobsRepository,
  createOrganizationExportJobsRepository,
  withDatabaseContext,
} from "../src/index.js";

const maintenanceUrl = process.env.DATABASE_URL ?? process.env.DATABASE_MAINTENANCE_URL;

describe("0063 export scope", () => {
  it(
    "enforces scope, format, schedule, immutable target, authorization, requester RLS, and cleanup index",
    { skip: !maintenanceUrl },
    async () => {
      const maintenance = new Pool({ connectionString: maintenanceUrl, max: 2 });
      const rlsRole = `export_scope_reader_${randomUUID().replaceAll("-", "")}`;
      const organizationId = randomUUID();
      const foreignOrganizationId = randomUUID();
      const workspaceId = randomUUID();
      const foreignWorkspaceId = randomUUID();
      const ownerId = randomUUID();
      const otherRequesterId = randomUUID();
      const workspaceOnlyId = randomUUID();
      const scheduleId = randomUUID();
      const workspaceJobId = randomUUID();
      const organizationJobId = randomUUID();
      const legacyDefaultJobId = randomUUID();

      const insertJob = (values: string, parameters: unknown[]) =>
        maintenance.query(
          `insert into export_jobs
             (id, organization_id, workspace_id, export_scope, requested_by, format, idempotency_key)
           values (${values})`,
          parameters,
        );

      try {
        await maintenance.query(
          `insert into users (id, email, name) values
             ($1, $2, 'Export owner'), ($3, $4, 'Other requester'), ($5, $6, 'Workspace member')`,
          [
            ownerId,
            `${ownerId}@example.test`,
            otherRequesterId,
            `${otherRequesterId}@example.test`,
            workspaceOnlyId,
            `${workspaceOnlyId}@example.test`,
          ],
        );
        await maintenance.query(
          `insert into organizations (id, name, slug, owner_id) values
             ($1, 'Export scope org', $2, $3), ($4, 'Foreign export org', $5, $3)`,
          [
            organizationId,
            `export-scope-${organizationId}`,
            ownerId,
            foreignOrganizationId,
            `foreign-${organizationId}`,
          ],
        );
        await maintenance.query(
          `insert into workspaces (id, organization_id, name, slug) values
             ($1, $2, 'Export workspace', $3), ($4, $5, 'Foreign workspace', $6)`,
          [
            workspaceId,
            organizationId,
            `export-${workspaceId}`,
            foreignWorkspaceId,
            foreignOrganizationId,
            `foreign-${foreignWorkspaceId}`,
          ],
        );
        await maintenance.query(
          `insert into memberships (user_id, organization_id, workspace_id, role, status) values
             ($1, $2, null, 'owner', 'active'),
             ($3, $2, null, 'member', 'active'),
             ($4, $2, $5, 'manager', 'active')`,
          [ownerId, organizationId, otherRequesterId, workspaceOnlyId, workspaceId],
        );

        await insertJob("$1, $2, $3, 'workspace', $4, 'json', $5", [
          workspaceJobId,
          organizationId,
          workspaceId,
          ownerId,
          `scope/${workspaceJobId}`,
        ]);
        await insertJob("$1, $2, null, 'organization', $3, 'json', $4", [
          organizationJobId,
          organizationId,
          ownerId,
          `scope/${organizationJobId}`,
        ]);
        await maintenance.query(
          `insert into export_jobs (id, organization_id, workspace_id, requested_by, format, idempotency_key)
           values ($1, $2, $3, $4, 'json', $5)`,
          [legacyDefaultJobId, organizationId, workspaceId, ownerId, `scope/${legacyDefaultJobId}`],
        );
        assert.deepEqual(
          (
            await maintenance.query(
              "select id, export_scope, workspace_id from export_jobs where id = any($1::uuid[]) order by id",
              [[workspaceJobId, organizationJobId, legacyDefaultJobId]],
            )
          ).rows.map((row) => ({ scope: row.export_scope, hasWorkspace: row.workspace_id !== null })),
          [workspaceJobId, organizationJobId, legacyDefaultJobId]
            .sort()
            .map((id) =>
              id === organizationJobId
                ? { scope: "organization", hasWorkspace: false }
                : { scope: "workspace", hasWorkspace: true },
            ),
        );

        await assert.rejects(
          () =>
            insertJob("$1, $2, null, 'workspace', $3, 'json', $4", [
              randomUUID(),
              organizationId,
              ownerId,
              `scope/${randomUUID()}`,
            ]),
          /scope_target|violates check constraint|workspace does not belong/i,
        );
        await assert.rejects(
          () =>
            insertJob("$1, $2, $3, 'organization', $4, 'json', $5", [
              randomUUID(),
              organizationId,
              workspaceId,
              ownerId,
              `scope/${randomUUID()}`,
            ]),
          /scope_target|violates check constraint/i,
        );
        await assert.rejects(
          () =>
            insertJob("$1, $2, null, 'organization', $3, 'pdf', $4", [
              randomUUID(),
              organizationId,
              ownerId,
              `scope/${randomUUID()}`,
            ]),
          /organization_format|violates check constraint/i,
        );

        await maintenance.query(
          `insert into report_schedules
             (id, organization_id, workspace_id, created_by, name, format, cadence, timezone, minute_of_day, next_run_at)
           values ($1, $2, $3, $4, 'Scope report', 'pdf', 'daily', 'UTC', 480, now() + interval '1 day')`,
          [scheduleId, organizationId, workspaceId, ownerId],
        );
        await maintenance.query(
          `insert into export_jobs
             (id, organization_id, workspace_id, export_scope, requested_by, format, idempotency_key,
              report_schedule_id, scheduled_for)
           values ($1, $2, $3, 'workspace', $4, 'pdf', $5, $6, now())`,
          [randomUUID(), organizationId, workspaceId, ownerId, `scope/${randomUUID()}`, scheduleId],
        );
        await assert.rejects(
          () =>
            maintenance.query(
              `insert into export_jobs
                 (organization_id, workspace_id, export_scope, requested_by, format, idempotency_key,
                  report_schedule_id, scheduled_for)
               values ($1, null, 'organization', $2, 'json', $3, $4, now())`,
              [organizationId, ownerId, `scope/${randomUUID()}`, scheduleId],
            ),
          /schedule_fields|Scheduled exports|violates check constraint/i,
        );
        await assert.rejects(
          () =>
            maintenance.query(
              "update export_jobs set export_scope = 'organization', workspace_id = null where id = $1",
              [workspaceJobId],
            ),
          /identity is immutable/i,
        );

        const organizationOwnerContext = { organizationId, actorId: ownerId };
        const organizationOtherContext = { organizationId, actorId: otherRequesterId };
        assert.equal(
          (
            await withDatabaseContext(organizationOwnerContext, () =>
              createOrganizationExportJobsRepository(organizationOwnerContext).get(organizationJobId),
            )
          ).id,
          organizationJobId,
        );
        await assert.rejects(() =>
          withDatabaseContext(organizationOtherContext, () =>
            createOrganizationExportJobsRepository(organizationOtherContext).get(organizationJobId),
          ),
        );
        await assert.rejects(() =>
          withDatabaseContext({ organizationId, workspaceId, actorId: ownerId }, () =>
            createExportJobsRepository({ organizationId, workspaceId, actorId: ownerId }).get(organizationJobId),
          ),
        );
        await assert.rejects(() =>
          withDatabaseContext({ organizationId: foreignOrganizationId, actorId: ownerId }, () =>
            createOrganizationExportJobsRepository({ organizationId: foreignOrganizationId, actorId: ownerId }).get(
              organizationJobId,
            ),
          ),
        );

        await maintenance.query(`create role "${rlsRole}" nosuperuser nocreatedb nocreaterole noinherit nobypassrls`);
        await maintenance.query(`grant usage on schema public to "${rlsRole}"`);
        await maintenance.query(`grant select on export_jobs to "${rlsRole}"`);

        const visible = async (
          scope: { organizationId: string; workspaceId?: string; actorId: string },
          jobId: string,
        ) => {
          const client = await maintenance.connect();
          try {
            await client.query("begin");
            await client.query(`set local role "${rlsRole}"`);
            await client.query(
              `select set_config('app.organization_id', $1, true),
                      set_config('app.workspace_id', $2, true),
                      set_config('app.actor_id', $3, true)`,
              [scope.organizationId, scope.workspaceId ?? "", scope.actorId],
            );
            const result = await client.query("select id from export_jobs where id = $1", [jobId]);
            await client.query("rollback");
            return result.rowCount;
          } finally {
            client.release();
          }
        };
        assert.equal(await visible({ organizationId, workspaceId, actorId: ownerId }, workspaceJobId), 1);
        assert.equal(await visible({ organizationId, workspaceId, actorId: otherRequesterId }, workspaceJobId), 0);
        assert.equal(await visible({ organizationId, actorId: ownerId }, organizationJobId), 1);
        assert.equal(await visible({ organizationId, actorId: otherRequesterId }, organizationJobId), 0);
        assert.equal(
          await visible({ organizationId, workspaceId: foreignWorkspaceId, actorId: ownerId }, workspaceJobId),
          0,
        );
        assert.equal(await visible({ organizationId: foreignOrganizationId, actorId: ownerId }, organizationJobId), 0);

        await maintenance.query(
          `update export_jobs set status = 'completed', object_key = $2, file_name = 'expired.zip',
             content_type = 'application/zip', file_size = 1, checksum_sha256 = $3,
             completed_at = now(), expires_at = now() + interval '1 hour'
           where id = $1`,
          [organizationJobId, `organizations/${organizationId}/exports/${organizationJobId}.zip`, "a".repeat(64)],
        );
        assert.equal(
          (
            await withDatabaseContext(organizationOwnerContext, () =>
              createOrganizationExportJobsRepository(organizationOwnerContext).getDownload(organizationJobId),
            )
          ).fileName,
          "expired.zip",
        );
        await assert.rejects(() =>
          withDatabaseContext(organizationOtherContext, () =>
            createOrganizationExportJobsRepository(organizationOtherContext).getDownload(organizationJobId),
          ),
        );
        await maintenance.query("update export_jobs set expires_at = now() - interval '1 minute' where id = $1", [
          organizationJobId,
        ]);
        await assert.rejects(() =>
          withDatabaseContext(organizationOwnerContext, () =>
            createOrganizationExportJobsRepository(organizationOwnerContext).getDownload(organizationJobId),
          ),
        );
        await maintenance.query("set enable_seqscan = off");
        const plan = await maintenance.query(
          `explain (format text) select id from export_jobs
           where status = 'completed' and expires_at <= now()
           order by expires_at, id limit 25`,
        );
        assert.match(plan.rows.map((row) => row["QUERY PLAN"]).join("\n"), /export_jobs_expired_cleanup_idx/);
      } finally {
        await maintenance.query(`drop role if exists "${rlsRole}"`).catch(() => undefined);
        await maintenance
          .query("delete from organizations where id = any($1::uuid[])", [[organizationId, foreignOrganizationId]])
          .catch(() => undefined);
        await maintenance
          .query("delete from users where id = any($1::uuid[])", [[ownerId, otherRequesterId, workspaceOnlyId]])
          .catch(() => undefined);
        await maintenance.end();
      }
    },
  );
});
