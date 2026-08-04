import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import { inArray, sql } from "drizzle-orm";
import {
  createProjectsRepository,
  currentDatabaseTenantContext,
  db,
  forms,
  organizations,
  pool,
  projects,
  TenantResourceNotFoundError,
  withTenantTransaction,
  workspaces,
} from "../src/index";

after(async () => {
  await pool.end();
});

describe("PostgreSQL tenant isolation", () => {
  it("enforces repository scope and database RLS for a restricted runtime role", async () => {
    const organizationOneId = randomUUID();
    const organizationTwoId = randomUUID();
    const workspaceOneId = randomUUID();
    const workspaceTwoId = randomUUID();
    const projectOneId = randomUUID();
    const projectTwoId = randomUUID();
    const publicFormId = randomUUID();
    const restrictedRole = `calmboard_rls_${randomUUID().replaceAll("-", "")}`;
    const quoteIdentifier = (value: string) => `"${value.replaceAll('"', '""')}"`;
    let roleCreated = false;

    try {
      await db.insert(organizations).values([
        {
          id: organizationOneId,
          name: "Integration tenant one",
          slug: `integration-one-${organizationOneId}`,
        },
        {
          id: organizationTwoId,
          name: "Integration tenant two",
          slug: `integration-two-${organizationTwoId}`,
        },
      ]);
      await db.insert(workspaces).values([
        {
          id: workspaceOneId,
          organizationId: organizationOneId,
          name: "Workspace one",
          slug: `workspace-one-${workspaceOneId}`,
        },
        {
          id: workspaceTwoId,
          organizationId: organizationTwoId,
          name: "Workspace two",
          slug: `workspace-two-${workspaceTwoId}`,
        },
      ]);
      await db.insert(projects).values([
        {
          id: projectOneId,
          organizationId: organizationOneId,
          workspaceId: workspaceOneId,
          name: "Tenant one project",
        },
        {
          id: projectTwoId,
          organizationId: organizationTwoId,
          workspaceId: workspaceTwoId,
          name: "Tenant two project",
        },
      ]);
      await db.insert(forms).values({
        id: publicFormId,
        organizationId: organizationOneId,
        workspaceId: workspaceOneId,
        name: "Public tenant resolver",
        isActive: true,
      });

      const tenantOneProjects = createProjectsRepository({
        organizationId: organizationOneId,
        workspaceId: workspaceOneId,
      });
      const visibleProjects = await tenantOneProjects.list();

      assert.deepEqual(
        visibleProjects.map((project) => project.id),
        [projectOneId],
      );
      await assert.rejects(
        () => tenantOneProjects.getById(projectTwoId),
        (error: unknown) => error instanceof TenantResourceNotFoundError,
      );
      await assert.rejects(
        () =>
          createProjectsRepository({
            organizationId: organizationOneId,
            workspaceId: workspaceTwoId,
          }).list(),
        (error: unknown) => error instanceof TenantResourceNotFoundError,
      );

      const sessionContext = await withTenantTransaction(
        { organizationId: organizationOneId, workspaceId: workspaceOneId },
        async () => {
          assert.deepEqual(currentDatabaseTenantContext(), {
            organizationId: organizationOneId,
            workspaceId: workspaceOneId,
          });
          return db.execute<{ organization_id: string; workspace_id: string }>(sql`
            select
              current_setting('app.organization_id') as organization_id,
              current_setting('app.workspace_id') as workspace_id
          `);
        },
      );
      assert.deepEqual(sessionContext.rows[0], {
        organization_id: organizationOneId,
        workspace_id: workspaceOneId,
      });
      assert.equal(currentDatabaseTenantContext(), undefined);

      const rlsState = await pool.query<{ count: number }>(
        `select count(*)::int as count
         from pg_class relation
         join pg_namespace namespace on namespace.oid = relation.relnamespace
         where namespace.nspname = 'public'
           and relation.relrowsecurity = true
           and relation.relforcerowsecurity = true`,
      );
      assert.equal(rlsState.rows[0]?.count, 65);
      const missingTenantProtection = await pool.query<{ table_name: string }>(
        `with tenant_tables as (
           select table_name
           from information_schema.columns
           where table_schema = 'public' and column_name = 'organization_id'
           union
           select 'organizations'
         )
         select tenant_table.table_name
         from tenant_tables tenant_table
         left join pg_class relation on relation.relname = tenant_table.table_name
         left join pg_namespace namespace
           on namespace.oid = relation.relnamespace and namespace.nspname = 'public'
         where relation.oid is null
            or relation.relrowsecurity is not true
            or relation.relforcerowsecurity is not true
            or not exists (
              select 1 from pg_policy policy where policy.polrelid = relation.oid
            )
         order by tenant_table.table_name`,
      );
      assert.deepEqual(missingTenantProtection.rows, []);

      await pool.query(
        `CREATE ROLE ${quoteIdentifier(restrictedRole)} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`,
      );
      roleCreated = true;
      await pool.query(`GRANT USAGE ON SCHEMA public TO ${quoteIdentifier(restrictedRole)}`);
      await pool.query(`GRANT SELECT, INSERT ON public.projects TO ${quoteIdentifier(restrictedRole)}`);
      await pool.query(`GRANT SELECT ON public.forms TO ${quoteIdentifier(restrictedRole)}`);

      const restrictedClient = await pool.connect();
      try {
        await restrictedClient.query("begin");
        await restrictedClient.query(`set local role ${quoteIdentifier(restrictedRole)}`);

        const withoutContext = await restrictedClient.query<{ id: string }>(
          "select id from projects where id = any($1::uuid[])",
          [[projectOneId, projectTwoId]],
        );
        assert.deepEqual(withoutContext.rows, []);

        const resolvedPublicForm = await restrictedClient.query<{
          organization_id: string;
          workspace_id: string;
        }>("select * from public.resolve_public_form_tenant($1)", [publicFormId]);
        assert.deepEqual(resolvedPublicForm.rows[0], {
          organization_id: organizationOneId,
          workspace_id: workspaceOneId,
        });

        await restrictedClient.query(
          "select set_config('app.organization_id', $1, true), set_config('app.workspace_id', $2, true)",
          [organizationOneId, workspaceOneId],
        );
        const tenantOneRows = await restrictedClient.query<{ id: string }>(
          "select id from projects where id = any($1::uuid[]) order by id",
          [[projectOneId, projectTwoId]],
        );
        assert.deepEqual(
          tenantOneRows.rows.map((row) => row.id),
          [projectOneId],
        );

        await assert.rejects(
          () =>
            restrictedClient.query(
              `insert into projects (id, organization_id, workspace_id, name)
               values ($1, $2, $3, 'Cross-tenant RLS violation')`,
              [randomUUID(), organizationTwoId, workspaceTwoId],
            ),
          (error: unknown) => (error as { code?: string }).code === "42501",
        );
        await restrictedClient.query("rollback");
      } finally {
        restrictedClient.release();
      }
    } finally {
      if (roleCreated) {
        await pool.query(`DROP OWNED BY ${quoteIdentifier(restrictedRole)}`);
        await pool.query(`DROP ROLE ${quoteIdentifier(restrictedRole)}`);
      }
      await db
        .delete(forms)
        .where(inArray(forms.id, [publicFormId]))
        .catch(() => undefined);
      await db
        .delete(projects)
        .where(inArray(projects.id, [projectOneId, projectTwoId]))
        .catch(() => undefined);
      await db
        .delete(workspaces)
        .where(inArray(workspaces.id, [workspaceOneId, workspaceTwoId]))
        .catch(() => undefined);
      await db
        .delete(organizations)
        .where(inArray(organizations.id, [organizationOneId, organizationTwoId]))
        .catch(() => undefined);
    }
  });
});
