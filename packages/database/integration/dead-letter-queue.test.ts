import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import { createDeadLetterQueueRepository, pool, withDatabaseContext } from "../src/index";

after(async () => {
  await pool.end();
});

describe("unified durable dead-letter queue", () => {
  it("lists dead work only for platform admins and reopens it through the controlled retry function", async () => {
    const adminId = randomUUID();
    const memberId = randomUUID();
    const organizationId = randomUUID();
    const workspaceId = randomUUID();
    const exportJobId = randomUUID();
    try {
      await pool.query(
        `insert into users (id, email, name, is_platform_admin)
         values ($1, $2, 'DLQ admin', true), ($3, $4, 'DLQ member', false)`,
        [adminId, `dlq-admin-${adminId}@example.test`, memberId, `dlq-member-${memberId}@example.test`],
      );
      await pool.query("insert into organizations (id, name, slug, owner_id) values ($1, 'DLQ tenant', $2, $3)", [
        organizationId,
        `dlq-${organizationId}`,
        adminId,
      ]);
      await pool.query(
        "insert into workspaces (id, organization_id, name, slug) values ($1, $2, 'DLQ workspace', $3)",
        [workspaceId, organizationId, `dlq-${workspaceId}`],
      );
      await pool.query(
        `insert into memberships (user_id, organization_id, workspace_id, status)
         values ($1, $2, $3, 'active')`,
        [adminId, organizationId, workspaceId],
      );
      await pool.query(
        `insert into export_jobs (
           id, organization_id, workspace_id, requested_by, idempotency_key,
           status, attempts, max_attempts, last_error
         ) values ($1, $2, $3, $4, $5, 'dead', 5, 5, 'provider unavailable')`,
        [exportJobId, organizationId, workspaceId, adminId, `dlq-test/${exportJobId}`],
      );

      await assert.rejects(
        () =>
          pool.query(
            "update export_jobs set status = 'pending', available_at = now(), last_error = null where id = $1",
            [exportJobId],
          ),
        (error: unknown) => (error as { code?: string }).code === "P0001",
      );

      await assert.rejects(
        () => withDatabaseContext({ actorId: memberId }, () => createDeadLetterQueueRepository().list()),
        (error: unknown) =>
          (error as { cause?: { message?: string } }).cause?.message === "Platform administrator access is required",
      );

      const listed = await withDatabaseContext({ actorId: adminId }, () => createDeadLetterQueueRepository().list());
      const entry = listed.find((item) => item.sourceId === exportJobId);
      assert.match(entry?.failedAt ?? "", /^\d{4}-\d{2}-\d{2}T/);
      assert.deepEqual(entry, {
        source: "workspace_export",
        sourceId: exportJobId,
        organizationId,
        workspaceId,
        queue: "workspace-exports",
        jobName: "BuildWorkspaceExport",
        attempts: 5,
        maxAttempts: 5,
        error: "provider unavailable",
        failedAt: entry!.failedAt,
      });

      assert.equal(
        await withDatabaseContext({ actorId: adminId }, () =>
          createDeadLetterQueueRepository().retry("workspace_export", exportJobId),
        ),
        true,
      );
      assert.equal(
        await withDatabaseContext({ actorId: adminId }, () =>
          createDeadLetterQueueRepository().retry("workspace_export", exportJobId),
        ),
        false,
      );
      for (const source of ["notification_email", "auth_email", "automation_event"] as const) {
        assert.equal(
          await withDatabaseContext({ actorId: adminId }, () =>
            createDeadLetterQueueRepository().retry(source, randomUUID()),
          ),
          false,
        );
      }

      const state = await pool.query<{
        status: string;
        attempts: number;
        max_attempts: number;
        last_error: string | null;
      }>("select status, attempts, max_attempts, last_error from export_jobs where id = $1", [exportJobId]);
      assert.deepEqual(state.rows, [{ status: "pending", attempts: 5, max_attempts: 10, last_error: null }]);
    } finally {
      await pool.query("delete from export_jobs where id = $1", [exportJobId]);
      await pool.query("delete from memberships where organization_id = $1", [organizationId]);
      await pool.query("delete from workspaces where id = $1", [workspaceId]);
      await pool.query("delete from organizations where id = $1", [organizationId]);
      await pool.query("delete from users where id = any($1::uuid[])", [[adminId, memberId]]);
    }
  });
});
