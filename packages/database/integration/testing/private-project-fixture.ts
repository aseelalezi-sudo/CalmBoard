import { randomUUID } from "node:crypto";
import { pool } from "../../src/index.js";

export async function fixture() {
  const organizationId = randomUUID(),
    workspaceId = randomUUID(),
    ownerId = randomUUID(),
    memberId = randomUUID();
  const publicId = randomUUID(),
    privateId = randomUUID();
  await pool.query("insert into users (id,email,name) values ($1,$2,'Owner'),($3,$4,'Member')", [
    ownerId,
    `${ownerId}@example.test`,
    memberId,
    `${memberId}@example.test`,
  ]);
  await pool.query("insert into organizations (id,name,slug,owner_id) values ($1,'Privacy test',$3,$2)", [
    organizationId,
    ownerId,
    `privacy-${organizationId}`,
  ]);
  await pool.query("insert into workspaces (id,organization_id,name,slug) values ($1,$2,'Privacy workspace',$3)", [
    workspaceId,
    organizationId,
    `privacy-${workspaceId}`,
  ]);
  await pool.query(
    "insert into memberships (user_id,organization_id,workspace_id,role,status) values ($1,$2,null,'owner','active'),($3,$2,$4,'member','active')",
    [ownerId, organizationId, memberId, workspaceId],
  );
  await pool.query(
    "insert into projects (id,organization_id,workspace_id,name,privacy) values ($1,$2,$3,'Needle public','workspace'),($4,$2,$3,'Needle','private')",
    [publicId, organizationId, workspaceId, privateId],
  );
  return {
    organizationId,
    workspaceId,
    ownerId,
    memberId,
    publicId,
    privateId,
    owner: { organizationId, workspaceId, actorId: ownerId },
    member: { organizationId, workspaceId, actorId: memberId },
  };
}

export async function cleanup(f: Awaited<ReturnType<typeof fixture>>) {
  // Return this fixture's pending sheets before deleting their entries. Submitted
  // periods reject entry deletion, and approved periods remain immutable.
  await pool.query(
    "update timesheets set status='rejected',reviewed_by_id=case when user_id=$2 then $3::uuid else $2::uuid end,reviewed_at=now(),rejection_reason='Fixture cleanup' where organization_id=$1 and status='submitted'",
    [f.organizationId, f.memberId, f.ownerId],
  );
  await pool.query("delete from goal_checkins where organization_id=$1", [f.organizationId]);
  await pool.query("delete from goal_task_links where organization_id=$1", [f.organizationId]);
  await pool.query("delete from goals where organization_id=$1 and type='key_result'", [f.organizationId]);
  await pool.query("delete from goals where organization_id=$1", [f.organizationId]);
  for (const table of [
    "activities",
    "automation_runs",
    "automation_events",
    "automations",
    "notification_email_outbox",
    "notifications",
    "export_jobs",
    "report_schedules",
    "attachments",
    "comments",
    "docs",
    "time_logs",
    "timesheets",
    "tasks",
    "projects",
    "memberships",
    "teams",
    "workspaces",
  ]) {
    await pool.query(`delete from ${table} where organization_id = $1`, [f.organizationId]);
  }
  await pool.query("delete from organizations where id=$1", [f.organizationId]);
  await pool.query("delete from users where id=any($1::uuid[])", [[f.ownerId, f.memberId]]);
}
