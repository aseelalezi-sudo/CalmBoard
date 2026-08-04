import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import { eq, inArray } from "drizzle-orm";
import {
  createReportSchedulesRepository,
  db,
  memberships,
  organizations,
  pool,
  reportSchedules,
  TenantConflictError,
  TenantResourceNotFoundError,
  users,
  workspaces,
} from "../src/index";

after(async () => pool.end());

describe("timezone-aware scheduled reports", () => {
  it("persists recipients, optimistic updates, and owner-only RLS", async () => {
    const organizationId = randomUUID();
    const workspaceId = randomUUID();
    const ownerId = randomUUID();
    const recipientId = randomUUID();
    const outsiderId = randomUUID();
    const restrictedRole = `calmboard_reports_rls_${randomUUID().replaceAll("-", "")}`;
    const quoteIdentifier = (value: string) => `"${value.replaceAll('"', '""')}"`;
    let roleCreated = false;
    try {
      await db.insert(users).values([
        { id: ownerId, email: `${ownerId}@example.com`, name: "Report owner" },
        { id: recipientId, email: `${recipientId}@example.com`, name: "Report recipient" },
        { id: outsiderId, email: `${outsiderId}@example.com`, name: "Report outsider" },
      ]);
      await db.insert(organizations).values({
        id: organizationId,
        ownerId,
        name: "Scheduled reports org",
        slug: `scheduled-reports-${organizationId}`,
      });
      await db.insert(workspaces).values({
        id: workspaceId,
        organizationId,
        name: "Scheduled reports workspace",
        slug: `scheduled-reports-${workspaceId}`,
      });
      await db.insert(memberships).values([
        { userId: ownerId, organizationId, workspaceId, role: "owner" },
        { userId: recipientId, organizationId, workspaceId, role: "member" },
      ]);

      const owner = createReportSchedulesRepository({ organizationId, workspaceId, actorId: ownerId });
      const created = await owner.create({
        name: "Monday leadership",
        format: "pdf",
        cadence: "weekly",
        timezone: "Asia/Riyadh",
        minuteOfDay: 510,
        dayOfWeek: 1,
        dayOfMonth: null,
        recipientIds: [ownerId, recipientId],
        isEnabled: true,
      });
      assert.equal(created.version, 1);
      assert.deepEqual(new Set(created.recipientIds), new Set([ownerId, recipientId]));
      assert.ok(created.nextRunAt > new Date());
      assert.equal((await owner.list()).length, 1);

      const updated = await owner.update(created.id, 1, {
        name: "Monthly leadership",
        format: "xlsx",
        cadence: "monthly",
        timezone: "Asia/Riyadh",
        minuteOfDay: 600,
        dayOfWeek: null,
        dayOfMonth: 15,
        recipientIds: [recipientId],
        isEnabled: true,
      });
      assert.equal(updated.version, 2);
      assert.deepEqual(updated.recipientIds, [recipientId]);
      await assert.rejects(
        () => owner.update(created.id, 1, { ...updated, recipientIds: [recipientId] }),
        TenantConflictError,
      );
      await assert.rejects(
        () =>
          owner.create({
            name: "Invalid recipient",
            format: "pdf",
            cadence: "daily",
            timezone: "UTC",
            minuteOfDay: 480,
            dayOfWeek: null,
            dayOfMonth: null,
            recipientIds: [outsiderId],
            isEnabled: true,
          }),
        TenantResourceNotFoundError,
      );

      await pool.query(
        `CREATE ROLE ${quoteIdentifier(restrictedRole)} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`,
      );
      roleCreated = true;
      await pool.query(`GRANT USAGE ON SCHEMA public TO ${quoteIdentifier(restrictedRole)}`);
      await pool.query(`GRANT SELECT ON public.report_schedules TO ${quoteIdentifier(restrictedRole)}`);
      const restricted = await pool.connect();
      try {
        await restricted.query("begin");
        await restricted.query(`set local role ${quoteIdentifier(restrictedRole)}`);
        await restricted.query(
          "select set_config('app.organization_id', $1, true), set_config('app.workspace_id', $2, true), set_config('app.actor_id', $3, true)",
          [organizationId, workspaceId, ownerId],
        );
        assert.equal((await restricted.query("select id from report_schedules")).rowCount, 1);
        await restricted.query("select set_config('app.actor_id', $1, true)", [recipientId]);
        assert.equal((await restricted.query("select id from report_schedules")).rowCount, 0);
        await restricted.query("rollback");
      } finally {
        restricted.release();
      }

      assert.deepEqual(await owner.delete(created.id), { ok: true });
      assert.equal((await owner.list()).length, 0);
    } finally {
      if (roleCreated) {
        await pool.query(`DROP OWNED BY ${quoteIdentifier(restrictedRole)}`);
        await pool.query(`DROP ROLE ${quoteIdentifier(restrictedRole)}`);
      }
      await db
        .delete(reportSchedules)
        .where(eq(reportSchedules.organizationId, organizationId))
        .catch(() => undefined);
      await db
        .delete(organizations)
        .where(eq(organizations.id, organizationId))
        .catch(() => undefined);
      await db
        .delete(users)
        .where(inArray(users.id, [ownerId, recipientId, outsiderId]))
        .catch(() => undefined);
    }
  });
});
