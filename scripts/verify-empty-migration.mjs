import "dotenv/config";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import pg from "pg";

const { Client, Pool } = pg;
const sourceUrl = process.env.DATABASE_URL;
if (!sourceUrl) throw new Error("DATABASE_URL is required to verify migrations.");
const migrationJournal = JSON.parse(await readFile(resolve("packages/database/migrations/meta/_journal.json"), "utf8"));
const expectedMigrationCount = migrationJournal.entries.length;
const latestMigration = migrationJournal.entries.at(-1);
if (!latestMigration?.tag) throw new Error("The migration journal does not contain a latest migration.");
const latestSnapshot = JSON.parse(
  await readFile(
    resolve(`packages/database/migrations/meta/${latestMigration.tag.split("_")[0]}_snapshot.json`),
    "utf8",
  ),
);
const expectedPublicTables = Object.keys(latestSnapshot.tables)
  .map((table) => table.replace(/^public\./, ""))
  .sort();
const verifyFullCi = process.argv.includes("--ci");

const databaseName = `calmboard_migration_check_${process.pid}_${Date.now()}`;
if (!/^calmboard_migration_check_\d+_\d+$/.test(databaseName)) {
  throw new Error("Refusing to use an unexpected temporary database name.");
}

const adminUrl = new URL(sourceUrl);
adminUrl.pathname = "/postgres";
const targetUrl = new URL(sourceUrl);
targetUrl.pathname = `/${databaseName}`;

const quoteIdentifier = (value) => `"${value.replaceAll('"', '""')}"`;
const admin = new Client({ connectionString: adminUrl.toString() });
let adminConnected = false;
let target;

try {
  await admin.connect();
  adminConnected = true;
  await admin.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);

  const migration = spawnSync(process.execPath, [resolve("scripts/database-command.mjs"), "migrate"], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: targetUrl.toString() },
    stdio: "inherit",
  });
  if (migration.error) throw migration.error;
  if (migration.status !== 0) throw new Error(`Migration command exited with ${migration.status}.`);

  const integrationTests = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--test",
      resolve("packages/database/integration/auth-sessions.test.ts"),
      resolve("packages/database/integration/authorization.test.ts"),
      resolve("apps/api/integration/auth-flow.test.ts"),
      resolve("apps/api/integration/auth-email-outbox.test.ts"),
      resolve("apps/api/integration/mfa-flow.test.ts"),
      resolve("apps/api/integration/oauth-flow.test.ts"),
      resolve("apps/api/integration/integration-oauth-flow.test.ts"),
      resolve("apps/api/integration/project-authorization-scope.test.ts"),
      resolve("packages/database/integration/billing-subscriptions.test.ts"),
      resolve("packages/database/integration/data-lifecycle.test.ts"),
      resolve("packages/database/integration/dead-letter-queue.test.ts"),
      resolve("packages/database/integration/export-jobs.test.ts"),
      resolve("packages/database/integration/integration-credentials.test.ts"),
      resolve("packages/database/integration/integration-webhooks.test.ts"),
      resolve("packages/database/integration/idempotency.test.ts"),
      resolve("packages/database/integration/security-events.test.ts"),
      resolve("packages/database/integration/project-fields.test.ts"),
      resolve("packages/database/integration/project-baselines.test.ts"),
      resolve("packages/database/integration/report-schedules.test.ts"),
      resolve("packages/database/integration/saved-views.test.ts"),
      resolve("packages/database/integration/search.test.ts"),
      resolve("packages/database/integration/dashboard-layouts.test.ts"),
      resolve("packages/database/integration/documents.test.ts"),
      resolve("packages/database/integration/goals.test.ts"),
      resolve("packages/database/integration/timesheets.test.ts"),
      resolve("packages/database/integration/forms.test.ts"),
      resolve("packages/database/integration/workload.test.ts"),
      resolve("packages/database/integration/task-serials.test.ts"),
      resolve("packages/database/integration/task-collaboration.test.ts"),
      resolve("packages/database/integration/task-pagination-scale.test.ts"),
      resolve("packages/database/integration/task-import.test.ts"),
      resolve("packages/database/integration/task-dependencies.test.ts"),
      resolve("packages/database/integration/task-schedules.test.ts"),
      resolve("packages/database/integration/task-workflows.test.ts"),
      resolve("packages/database/integration/sprint.test.ts"),
      resolve("packages/database/integration/tenant-isolation.test.ts"),
      resolve("packages/database/integration/usage-limits.test.ts"),
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_URL: targetUrl.toString(),
        DATABASE_APP_URL: targetUrl.toString(),
        TSX_TSCONFIG_PATH: resolve("apps/api/tsconfig.json"),
      },
      stdio: "inherit",
    },
  );
  if (integrationTests.error) throw integrationTests.error;
  if (integrationTests.status !== 0) {
    throw new Error(`Database integration tests exited with ${integrationTests.status}.`);
  }

  const automationWorkerTest = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--test",
      resolve("apps/worker/src/automation-events.test.ts"),
      resolve("apps/worker/src/form-submissions.test.ts"),
      resolve("apps/worker/src/billing-grace-periods.test.ts"),
      resolve("apps/worker/src/data-lifecycle.test.ts"),
      resolve("apps/worker/src/organization-purge.test.ts"),
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_MAINTENANCE_URL: targetUrl.toString(),
        TSX_TSCONFIG_PATH: resolve("apps/worker/tsconfig.json"),
      },
      stdio: "inherit",
    },
  );
  if (automationWorkerTest.error) throw automationWorkerTest.error;
  if (automationWorkerTest.status !== 0) {
    throw new Error(
      `Automation, form, and billing worker integration tests exited with ${automationWorkerTest.status}.`,
    );
  }

  const scheduledReportWorkerTest = spawnSync(
    process.execPath,
    ["--import", "tsx", "--test", resolve("apps/worker/src/scheduled-reports.test.ts")],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_MAINTENANCE_URL: targetUrl.toString(),
        TSX_TSCONFIG_PATH: resolve("apps/worker/tsconfig.json"),
      },
      stdio: "inherit",
    },
  );
  if (scheduledReportWorkerTest.error) throw scheduledReportWorkerTest.error;
  if (scheduledReportWorkerTest.status !== 0) {
    throw new Error(`Scheduled report worker integration test exited with ${scheduledReportWorkerTest.status}.`);
  }

  const workspaceExportWorkerTest = spawnSync(
    process.execPath,
    ["--import", "tsx", "--test", resolve("apps/worker/src/workspace-exports.test.ts")],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_MAINTENANCE_URL: targetUrl.toString(),
        TSX_TSCONFIG_PATH: resolve("apps/worker/tsconfig.json"),
      },
      stdio: "inherit",
    },
  );
  if (workspaceExportWorkerTest.error) throw workspaceExportWorkerTest.error;
  if (workspaceExportWorkerTest.status !== 0) {
    throw new Error(`Workspace export worker integration test exited with ${workspaceExportWorkerTest.status}.`);
  }

  const pnpmCli = process.env.npm_execpath;
  const developmentSeed = spawnSync(
    pnpmCli ? process.execPath : "pnpm",
    pnpmCli
      ? [pnpmCli, "exec", "tsx", resolve("scripts/seed-dev.ts")]
      : ["exec", "tsx", resolve("scripts/seed-dev.ts")],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_URL: targetUrl.toString(),
        DATABASE_APP_URL: targetUrl.toString(),
        NODE_ENV: "development",
      },
      stdio: "inherit",
    },
  );
  if (developmentSeed.error) throw developmentSeed.error;
  if (developmentSeed.status !== 0) {
    throw new Error(`Development seed verification exited with ${developmentSeed.status}.`);
  }

  if (verifyFullCi) {
    const ciEnvironment = {
      ...process.env,
      DATABASE_URL: targetUrl.toString(),
      DATABASE_APP_URL: targetUrl.toString(),
      DATABASE_MAINTENANCE_URL: targetUrl.toString(),
    };
    delete ciEnvironment.NODE_ENV;
    const fullCi = spawnSync(pnpmCli ? process.execPath : "pnpm", pnpmCli ? [pnpmCli, "run", "ci"] : ["run", "ci"], {
      cwd: process.cwd(),
      env: ciEnvironment,
      stdio: "inherit",
    });
    if (fullCi.error) throw fullCi.error;
    if (fullCi.status !== 0) throw new Error(`Full CI on the temporary database exited with ${fullCi.status}.`);
  }

  target = new Pool({ connectionString: targetUrl.toString(), max: 24 });
  const tables = await target.query(
    "select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name",
  );
  const journal = await target.query('select count(*)::int as count from drizzle."__drizzle_migrations"');
  const migratedPublicTables = tables.rows.map((row) => row.table_name);
  const tableCount = migratedPublicTables.length;
  const migrationCount = journal.rows[0]?.count ?? 0;
  assert.deepEqual(
    migratedPublicTables,
    expectedPublicTables,
    "Migrated tables must exactly match the latest snapshot.",
  );
  assert.equal(migrationCount, expectedMigrationCount, "Every journal migration must execute exactly once.");

  const sprintSecurity = await target.query(
    `select c.relname as table_name, c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced,
            count(p.policyname)::int as policy_count
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       left join pg_policies p on p.schemaname = n.nspname and p.tablename = c.relname
      where n.nspname = 'public'
        and c.relname = any($1::text[])
      group by c.relname, c.relrowsecurity, c.relforcerowsecurity
      order by c.relname`,
    [["sprint_analytics_events", "sprint_snapshots", "sprints", "task_sprint_assignments"]],
  );
  assert.deepEqual(
    sprintSecurity.rows,
    ["sprint_analytics_events", "sprint_snapshots", "sprints", "task_sprint_assignments"].map((tableName) => ({
      table_name: tableName,
      rls_enabled: true,
      rls_forced: true,
      policy_count: 1,
    })),
    "Every Sprint table must enforce one tenant-isolation RLS policy.",
  );

  const requiredSprintObjects = [
    "sprint_analytics_events_event_sequence_unique",
    "sprint_analytics_events_project_idx",
    "sprint_analytics_events_sprint_idx",
    "sprint_analytics_events_task_idx",
    "sprint_snapshots_project_type_captured_idx",
    "sprint_snapshots_type_unique",
    "sprints_active_unique",
    "sprints_project_idx",
    "sprints_project_status_idx",
    "task_sprint_assignments_active_unique",
    "task_sprint_assignments_project_idx",
    "task_sprint_assignments_sprint_idx",
    "task_sprint_assignments_task_idx",
    "tasks_sprint_id_idx",
  ];
  const sprintObjects = await target.query(
    `select indexname from pg_indexes
      where schemaname = 'public' and indexname = any($1::text[])
      order by indexname`,
    [requiredSprintObjects],
  );
  assert.deepEqual(
    sprintObjects.rows.map((row) => row.indexname),
    requiredSprintObjects.toSorted(),
    "Sprint indexes and unique constraints must match the approved migration chain.",
  );

  const billingCatalog = await target.query(
    `select
       (select count(*)::int from subscription_plans where is_active = true) as plan_count,
       (select count(*)::int from organizations where deleted_at is null) as organization_count,
       (select count(*)::int from subscriptions where ended_at is null) as current_subscription_count`,
  );
  assert.equal(billingCatalog.rows[0].plan_count, 5);
  assert.equal(billingCatalog.rows[0].current_subscription_count, billingCatalog.rows[0].organization_count);

  const organization = await target.query(
    "insert into organizations (name, slug) values ('Migration check', $1) returning id",
    [`migration-check-${databaseName}`],
  );
  const organizationId = organization.rows[0].id;
  const workspace = await target.query(
    "insert into workspaces (organization_id, name, slug) values ($1, 'Workspace one', 'duplicate-check') returning id",
    [organizationId],
  );
  const workspaceId = workspace.rows[0].id;
  await assert.rejects(
    () =>
      target.query(
        "insert into workspaces (organization_id, name, slug) values ($1, 'Workspace two', 'duplicate-check')",
        [organizationId],
      ),
    (error) => error?.code === "23505",
  );

  const user = await target.query("insert into users (email, name) values ($1, 'Migration check') returning id", [
    `migration-${databaseName}@example.test`,
  ]);
  const userId = user.rows[0].id;
  const membership = await target.query(
    "insert into memberships (user_id, organization_id) values ($1, $2) returning id",
    [userId, organizationId],
  );
  const membershipId = membership.rows[0].id;
  await assert.rejects(
    () => target.query("insert into memberships (user_id, organization_id) values ($1, $2)", [userId, organizationId]),
    (error) => error?.code === "23505",
  );

  const authorizationDefaults = await target.query(
    `select
       (select count(*)::int from roles where is_system = true) as system_role_count,
       (select count(*)::int
          from permissions
         where key in ('sprints.view', 'sprints.manage')) as sprint_permission_count,
       (select count(*)::int
          from permissions permission
         where not exists (
           select 1
             from role_permissions role_permission
             join roles role on role.id = role_permission.role_id
            where role_permission.permission_id = permission.id
              and role.key = 'owner'
              and role.is_system = true
         )) as owner_missing_permission_count`,
  );
  assert.deepEqual(authorizationDefaults.rows[0], {
    system_role_count: 6,
    sprint_permission_count: 2,
    owner_missing_permission_count: 0,
  });

  const readOnlyRoleDefaults = await target.query(
    `select role.key, array_agg(permission.key order by permission.key) filter (where permission.key is not null) as permissions
     from roles role
     left join role_permissions role_permission on role_permission.role_id = role.id
     left join permissions permission on permission.id = role_permission.permission_id
     where role.is_system = true and role.key in ('guest', 'viewer')
     group by role.key
     order by role.key`,
  );
  assert.deepEqual(readOnlyRoleDefaults.rows, [
    { key: "guest", permissions: ["sprints.view"] },
    { key: "viewer", permissions: ["sprints.view"] },
  ]);

  const primaryBinding = await target.query(
    `select role.key, binding.scope, binding.workspace_id
     from membership_role_bindings binding
     join roles role on role.id = binding.role_id
     where binding.membership_id = $1 and binding.is_primary = true`,
    [membershipId],
  );
  assert.deepEqual(primaryBinding.rows[0], { key: "member", scope: "organization", workspace_id: null });

  await target.query("update memberships set role = 'admin' where user_id = $1 and organization_id = $2", [
    userId,
    organizationId,
  ]);
  const updatedPrimaryBinding = await target.query(
    `select role.key
     from membership_role_bindings binding
     join roles role on role.id = binding.role_id
     join memberships membership on membership.id = binding.membership_id
     where membership.user_id = $1 and binding.is_primary = true`,
    [userId],
  );
  assert.equal(updatedPrimaryBinding.rows[0]?.key, "admin");

  await assert.rejects(
    () =>
      target.query(
        "insert into roles (key, name, is_system) values ('invalid-custom-role', 'Invalid custom role', false)",
      ),
    (error) => error?.code === "23514",
  );

  const project = await target.query(
    "insert into projects (organization_id, workspace_id, name, owner_id) values ($1, $2, 'Participant check', $3) returning id",
    [organizationId, workspaceId, userId],
  );
  const projectId = project.rows[0].id;
  const projectOwner = await target.query(
    "select role, is_owner from project_members where project_id = $1 and user_id = $2 and deleted_at is null",
    [projectId, userId],
  );
  assert.deepEqual(projectOwner.rows[0], { role: "manager", is_owner: true });

  const secondUser = await target.query(
    "insert into users (email, name) values ($1, 'Second participant') returning id",
    [`second-participant-${databaseName}@example.test`],
  );
  const secondUserId = secondUser.rows[0].id;
  await target.query("insert into memberships (user_id, organization_id, workspace_id) values ($1, $2, $3)", [
    secondUserId,
    organizationId,
    workspaceId,
  ]);

  const participantTask = await target.query(
    `insert into tasks (
       organization_id, workspace_id, project_id, serial, title, assignee_id, reporter_id
     ) values ($1, $2, $3, 'TASK-2000', 'Participant trigger check', $4, $4)
     returning id`,
    [organizationId, workspaceId, projectId, userId],
  );
  const participantTaskId = participantTask.rows[0].id;
  await target.query(
    `insert into task_assignees (
       organization_id, workspace_id, project_id, task_id, user_id
     ) values ($1, $2, $3, $4, $5)`,
    [organizationId, workspaceId, projectId, participantTaskId, secondUserId],
  );
  const activeParticipants = await target.query(
    `select
       (select count(*)::int from task_assignees where task_id = $1 and unassigned_at is null) as assignee_count,
       (select count(*)::int from task_followers where task_id = $1 and unfollowed_at is null) as follower_count`,
    [participantTaskId],
  );
  assert.deepEqual(activeParticipants.rows[0], { assignee_count: 2, follower_count: 1 });

  await target.query("update tasks set assignee_id = null where id = $1", [participantTaskId]);
  const primaryAfterUnassign = await target.query(
    "select count(*)::int as count from task_assignees where task_id = $1 and is_primary = true and unassigned_at is null",
    [participantTaskId],
  );
  assert.equal(primaryAfterUnassign.rows[0].count, 0);

  const allocatedSerials = await Promise.all(
    Array.from({ length: 24 }, async () => {
      const allocation = await target.query(
        `insert into task_serial_sequences (organization_id, next_value)
         values ($1, 1042)
         on conflict (organization_id) do update
         set next_value = task_serial_sequences.next_value + 1,
             updated_at = now()
         returning next_value - 1 as value`,
        [organizationId],
      );
      return Number(allocation.rows[0].value);
    }),
  );
  allocatedSerials.sort((left, right) => left - right);
  assert.deepEqual(
    allocatedSerials,
    Array.from({ length: 24 }, (_, index) => 1041 + index),
  );

  console.log(
    `Verified ${tableCount} tables, ${migrationCount} migrations, enforced row-level tenant security, development seed compatibility, idempotent execution, encrypted integration credentials, durable webhook replay protection, subscription catalog, lifecycle, and server-enforced usage limits, RBAC defaults, participant synchronization, task-link, schedule, checklist, approval, and refresh-token integrity, tenant uniqueness, and concurrent task serial allocation on an empty database.`,
  );
} finally {
  if (target) await target.end();
  if (adminConnected) {
    await admin.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)}`);
    await admin.end();
  }
}
