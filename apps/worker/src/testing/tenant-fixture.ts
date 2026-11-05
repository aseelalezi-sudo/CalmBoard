import { randomUUID } from "node:crypto";
import type { Pool } from "pg";

// Integration tests own their tenant rather than borrowing arbitrary developer
// data. The caller supplies an isolated test database and owns the pool.
export async function createWorkerTenantFixture(pool: Pool) {
  const scope = {
    organization_id: randomUUID(),
    workspace_id: randomUUID(),
    project_id: randomUUID(),
    task_id: randomUUID(),
    user_id: randomUUID(),
  };
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("insert into users (id,email,name) values ($1,$2,'Worker test member')", [
      scope.user_id,
      `worker-${scope.user_id}@example.test`,
    ]);
    await client.query("insert into organizations (id,name,slug,owner_id) values ($1,'Worker test tenant',$2,$3)", [
      scope.organization_id,
      `worker-${scope.organization_id}`,
      scope.user_id,
    ]);
    await client.query(
      "insert into workspaces (id,organization_id,name,slug) values ($1,$2,'Worker test workspace',$3)",
      [scope.workspace_id, scope.organization_id, `worker-${scope.workspace_id}`],
    );
    await client.query(
      "insert into memberships (user_id,organization_id,workspace_id,role,status) values ($1,$2,$3,'member','active')",
      [scope.user_id, scope.organization_id, scope.workspace_id],
    );
    await client.query(
      "insert into projects (id,organization_id,workspace_id,name,owner_id) values ($1,$2,$3,'Worker test project',$4)",
      [scope.project_id, scope.organization_id, scope.workspace_id, scope.user_id],
    );
    await client.query(
      "insert into tasks (id,organization_id,workspace_id,project_id,title,serial,reporter_id) values ($1,$2,$3,$4,'Worker test task',$5,$6)",
      [
        scope.task_id,
        scope.organization_id,
        scope.workspace_id,
        scope.project_id,
        `TEST-${scope.task_id.slice(0, 8)}`,
        scope.user_id,
      ],
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
  return {
    ...scope,
    async cleanup() {
      const client = await pool.connect();
      try {
        await client.query("begin");
        for (const table of [
          "notification_email_outbox",
          "notifications",
          "task_reminders",
          "task_sprint_assignments",
          "tasks",
          "projects",
          "memberships",
          "workspaces",
        ])
          await client.query(`delete from ${table} where organization_id=$1`, [scope.organization_id]);
        await client.query("delete from organizations where id=$1", [scope.organization_id]);
        await client.query("delete from users where id=$1", [scope.user_id]);
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
