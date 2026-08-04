import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import { eq, inArray } from "drizzle-orm";
import {
  createDashboardLayoutsRepository,
  dashboardLayouts,
  db,
  defaultDashboardWidgets,
  memberships,
  organizations,
  pool,
  TenantConflictError,
  TenantPermissionDeniedError,
  TenantResourceNotFoundError,
  users,
  workspaces,
} from "../src/index";

after(async () => pool.end());

describe("personal dashboard layouts", () => {
  it("persists independent user layouts with optimistic concurrency", async () => {
    const organizationId = randomUUID();
    const workspaceId = randomUUID();
    const outsiderOrganizationId = randomUUID();
    const ownerId = randomUUID();
    const memberId = randomUUID();
    const outsiderId = randomUUID();
    const restrictedRole = `calmboard_dashboard_rls_${randomUUID().replaceAll("-", "")}`;
    const quoteIdentifier = (value: string) => `"${value.replaceAll('"', '""')}"`;
    let roleCreated = false;
    try {
      await db.insert(users).values([
        { id: ownerId, email: `${ownerId}@example.com`, name: "Dashboard owner" },
        { id: memberId, email: `${memberId}@example.com`, name: "Dashboard member" },
        { id: outsiderId, email: `${outsiderId}@example.com`, name: "Dashboard outsider" },
      ]);
      await db.insert(organizations).values([
        {
          id: organizationId,
          ownerId,
          name: "Dashboard layouts org",
          slug: `dashboard-layouts-${organizationId}`,
        },
        {
          id: outsiderOrganizationId,
          ownerId: outsiderId,
          name: "Outside org",
          slug: `outside-dashboard-${outsiderOrganizationId}`,
        },
      ]);
      await db.insert(workspaces).values({
        id: workspaceId,
        organizationId,
        name: "Dashboard layouts workspace",
        slug: `dashboard-layouts-${workspaceId}`,
      });
      await db.insert(memberships).values([
        { userId: ownerId, organizationId, workspaceId: null, role: "owner" },
        { userId: memberId, organizationId, workspaceId, role: "member" },
        { userId: outsiderId, organizationId: outsiderOrganizationId, workspaceId: null, role: "owner" },
      ]);

      assert.throws(
        () => createDashboardLayoutsRepository({ organizationId, workspaceId }),
        TenantPermissionDeniedError,
      );

      const owner = createDashboardLayoutsRepository({ organizationId, workspaceId, actorId: ownerId });
      const member = createDashboardLayoutsRepository({ organizationId, workspaceId, actorId: memberId });
      const outsider = createDashboardLayoutsRepository({ organizationId, workspaceId, actorId: outsiderId });
      const initial = await owner.get();
      assert.equal(initial.version, 0);
      assert.deepEqual(initial.widgets, defaultDashboardWidgets);

      const ownerLayout = await owner.update(
        [
          { id: "goals", width: "wide" },
          { id: "activity", width: "full" },
        ],
        0,
      );
      assert.equal(ownerLayout.version, 1);
      const memberLayout = await member.update([{ id: "time_logged", width: "medium" }], 0);
      assert.equal(memberLayout.version, 1);
      assert.notEqual(ownerLayout.id, memberLayout.id);
      assert.deepEqual((await owner.get()).widgets, [
        { id: "goals", width: "wide" },
        { id: "activity", width: "full" },
      ]);
      assert.deepEqual((await member.get()).widgets, [{ id: "time_logged", width: "medium" }]);

      const updated = await owner.update([{ id: "custom_chart", width: "full" }], 1);
      assert.equal(updated.version, 2);
      await assert.rejects(() => owner.update([{ id: "goals", width: "small" }], 1), TenantConflictError);
      await assert.rejects(() => outsider.get(), TenantResourceNotFoundError);

      await pool.query(
        `CREATE ROLE ${quoteIdentifier(restrictedRole)} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`,
      );
      roleCreated = true;
      await pool.query(`GRANT USAGE ON SCHEMA public TO ${quoteIdentifier(restrictedRole)}`);
      await pool.query(
        `GRANT SELECT, INSERT, UPDATE ON public.dashboard_layouts TO ${quoteIdentifier(restrictedRole)}`,
      );
      await pool.query(`GRANT SELECT ON public.memberships, public.workspaces TO ${quoteIdentifier(restrictedRole)}`);

      const restrictedClient = await pool.connect();
      try {
        await restrictedClient.query("begin");
        await restrictedClient.query(`set local role ${quoteIdentifier(restrictedRole)}`);
        await restrictedClient.query(
          "select set_config('app.organization_id', $1, true), set_config('app.workspace_id', $2, true), set_config('app.actor_id', $3, true)",
          [organizationId, workspaceId, ownerId],
        );
        const ownerRows = await restrictedClient.query<{ user_id: string }>(
          "select user_id from dashboard_layouts order by user_id",
        );
        assert.deepEqual(ownerRows.rows, [{ user_id: ownerId }]);

        await restrictedClient.query("select set_config('app.actor_id', $1, true)", [memberId]);
        const memberRows = await restrictedClient.query<{ user_id: string }>(
          "select user_id from dashboard_layouts order by user_id",
        );
        assert.deepEqual(memberRows.rows, [{ user_id: memberId }]);
        await assert.rejects(
          () =>
            restrictedClient.query(
              "insert into dashboard_layouts (organization_id, workspace_id, user_id, widgets) values ($1, $2, $3, '[]'::jsonb)",
              [organizationId, workspaceId, ownerId],
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
        .delete(dashboardLayouts)
        .where(eq(dashboardLayouts.organizationId, organizationId))
        .catch(() => undefined);
      await db
        .delete(organizations)
        .where(inArray(organizations.id, [organizationId, outsiderOrganizationId]))
        .catch(() => undefined);
      await db
        .delete(users)
        .where(inArray(users.id, [ownerId, memberId, outsiderId]))
        .catch(() => undefined);
    }
  });
});
