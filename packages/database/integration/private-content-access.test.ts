import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import {
  assertExportProjectAccess,
  createExportJobsRepository,
  createOrganizationExportJobsRepository,
  createSearchRepository,
  createAuthorizationRepository,
  pool,
  TenantPermissionDeniedError,
  withDatabaseContext,
} from "../src/index.js";
import { processWorkspaceExports } from "../../../apps/worker/src/workspace-exports.js";
import { deliverNotificationEmails } from "../../../apps/worker/src/notification-email.js";

after(async () => pool.end());

async function fixture() {
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

async function cleanup(f: Awaited<ReturnType<typeof fixture>>) {
  for (const table of [
    "notification_email_outbox",
    "notifications",
    "export_jobs",
    "report_schedules",
    "attachments",
    "comments",
    "docs",
    "tasks",
    "projects",
    "memberships",
    "workspaces",
  ]) {
    await pool.query(`delete from ${table} where organization_id = $1`, [f.organizationId]);
  }
  await pool.query("delete from organizations where id=$1", [f.organizationId]);
  await pool.query("delete from users where id=any($1::uuid[])", [[f.ownerId, f.memberId]]);
}

describe("private project content across search and full exports", () => {
  it("filters every project-backed search category before its limit and honors assignment changes", async () => {
    const f = await fixture();
    try {
      const publicTaskId = randomUUID();
      await pool.query(
        "insert into tasks (id,organization_id,workspace_id,project_id,title,serial) values ($1,$2,$3,$4,'Needle public task','PUBLIC-1')",
        [publicTaskId, f.organizationId, f.workspaceId, f.publicId],
      );
      await pool.query(
        "insert into tasks (organization_id,workspace_id,project_id,title,serial) select $1,$2,$3,'Needle','PRIVATE-'||n from generate_series(1,25) n",
        [f.organizationId, f.workspaceId, f.privateId],
      );
      const privateTasks = await pool.query<{ id: string }>("select id from tasks where project_id=$1 order by id", [
        f.privateId,
      ]);
      for (const [index, taskId] of [publicTaskId, ...privateTasks.rows.slice(0, 12).map((r) => r.id)].entries()) {
        await pool.query(
          "insert into comments (organization_id,workspace_id,task_id,user_id,content) values ($1,$2,$3,$4,'Needle')",
          [f.organizationId, f.workspaceId, taskId, f.ownerId],
        );
        // A task-only attachment has no project_id; it must inherit the task's access.
        await pool.query(
          "insert into attachments (organization_id,workspace_id,task_id,uploader_id,file_name,file_size,url) values ($1,$2,$3,$4,'Needle.txt',1,'s3://test/fixture')",
          [f.organizationId, f.workspaceId, taskId, f.ownerId],
        );
        await pool.query(
          "insert into docs (organization_id,workspace_id,project_id,author_id,title,content,workspace_access) values ($1,$2,$3,$4,'Needle','Needle','viewer')",
          [f.organizationId, f.workspaceId, index === 0 ? f.publicId : f.privateId, f.ownerId],
        );
      }
      const result = await withDatabaseContext(f.member, () => createSearchRepository(f.member).search("Needle"));
      assert.deepEqual(
        result.projects.map((r) => r.id),
        [f.publicId],
      );
      assert.deepEqual(
        result.tasks.map((r) => r.id),
        [publicTaskId],
      );
      assert.equal(result.docs.length, 1);
      assert.equal(result.docs[0].projectId, f.publicId);
      assert.equal(result.comments.length, 1);
      assert.equal(result.comments[0].taskId, publicTaskId);
      assert.equal(result.attachments.length, 1);
      assert.equal(result.attachments[0].taskId, publicTaskId);
      const owner = await withDatabaseContext(f.owner, () => createSearchRepository(f.owner).search("Needle"));
      assert.ok(owner.projects.some((r) => r.id === f.privateId));
      assert.ok(owner.tasks.some((r) => r.projectId === f.privateId));
      const assigned = await pool.query<{ id: string }>(
        "insert into project_members (organization_id,workspace_id,project_id,user_id) values ($1,$2,$3,$4) returning id",
        [f.organizationId, f.workspaceId, f.privateId, f.memberId],
      );
      assert.ok(
        (await withDatabaseContext(f.member, () => createSearchRepository(f.member).search("Needle"))).projects.some(
          (r) => r.id === f.privateId,
        ),
      );
      await pool.query("update project_members set deleted_at=now() where id=$1", [assigned.rows[0].id]);
      assert.deepEqual(
        (await withDatabaseContext(f.member, () => createSearchRepository(f.member).search("Needle"))).tasks.map(
          (r) => r.id,
        ),
        [publicTaskId],
      );
    } finally {
      await cleanup(f);
    }
  });

  it("requires current visibility for full exports and old download links, including organization scope and deleted projects", async () => {
    const f = await fixture();
    try {
      // Grant export independently: data.export must not imply private-project visibility.
      await pool.query(
        `insert into membership_permission_overrides (organization_id,workspace_id,membership_id,permission_id,scope,effect,created_by)
        select $1,$2,m.id,p.id,'workspace','allow',$4 from memberships m cross join permissions p
        where m.user_id=$3 and m.organization_id=$1 and p.key='data.export'`,
        [f.organizationId, f.workspaceId, f.memberId, f.ownerId],
      );
      const member = createExportJobsRepository(f.member);
      await assert.rejects(() => member.request(randomUUID(), "pdf"), TenantPermissionDeniedError);
      await assert.rejects(() => assertExportProjectAccess(f.member, false), TenantPermissionDeniedError);
      const assignment = await pool.query<{ id: string }>(
        "insert into project_members (organization_id,workspace_id,project_id,user_id) values ($1,$2,$3,$4) returning id",
        [f.organizationId, f.workspaceId, f.privateId, f.memberId],
      );
      const job = await member.request(randomUUID(), "pdf");
      await pool.query(
        "update export_jobs set status='completed',object_key='test/report.pdf',file_name='report.pdf',content_type='application/pdf',file_size=1,checksum_sha256=repeat('a',64),completed_at=now(),expires_at=now()+interval '1 hour' where id=$1",
        [job.id],
      );
      assert.equal((await member.getDownload(job.id)).fileName, "report.pdf");
      await pool.query("update project_members set deleted_at=now() where id=$1", [assignment.rows[0].id]);
      await assert.rejects(() => member.getDownload(job.id), TenantPermissionDeniedError);
      const org = { organizationId: f.organizationId, actorId: f.ownerId };
      await withDatabaseContext(org, () => createOrganizationExportJobsRepository(org).request(randomUUID()));
      const denied = await pool.query<{ id: string }>(
        `insert into membership_permission_overrides (organization_id,workspace_id,membership_id,permission_id,scope,effect,created_by)
        select $1,$2,m.id,p.id,'workspace','deny',$3 from memberships m cross join permissions p
        where m.user_id=$3 and m.organization_id=$1 and p.key='data.export' returning id`,
        [f.organizationId, f.workspaceId, f.ownerId],
      );
      await assert.rejects(
        () => withDatabaseContext(org, () => assertExportProjectAccess(org)),
        TenantPermissionDeniedError,
      );
      await pool.query("delete from membership_permission_overrides where id=$1", [denied.rows[0].id]);
      await assert.rejects(
        () =>
          withDatabaseContext(f.owner, () =>
            createAuthorizationRepository().resolve(f.ownerId, {
              organizationId: f.organizationId,
              workspaceId: randomUUID(),
            }),
          ),
        /Cannot change tenant context/,
      );
      await pool.query("update projects set deleted_at=now() where id=$1", [f.privateId]);
      await assert.rejects(() => assertExportProjectAccess(f.member), TenantPermissionDeniedError);
      await withDatabaseContext(org, () => assertExportProjectAccess(org));
    } finally {
      await cleanup(f);
    }
  });

  it("does not generate or email a full report after access is revoked", async () => {
    const f = await fixture();
    try {
      const scheduleId = randomUUID(),
        jobId = randomUUID();
      await pool.query(
        "insert into report_schedules (id,organization_id,workspace_id,created_by,name,format,cadence,timezone,minute_of_day,next_run_at) values ($1,$2,$3,$4,'Privacy report','pdf','daily','UTC',480,now()+interval '1 day')",
        [scheduleId, f.organizationId, f.workspaceId, f.ownerId],
      );
      await pool.query(
        "insert into report_schedule_recipients (organization_id,workspace_id,schedule_id,user_id) values ($1,$2,$3,$4),($1,$2,$3,$5)",
        [f.organizationId, f.workspaceId, scheduleId, f.ownerId, f.memberId],
      );
      await pool.query(
        "insert into export_jobs (id,organization_id,workspace_id,requested_by,format,report_schedule_id,scheduled_for,idempotency_key) values ($1,$2,$3,$4,'pdf',$5,now(),$6)",
        [jobId, f.organizationId, f.workspaceId, f.ownerId, scheduleId, `job-${jobId}`],
      );
      let puts = 0,
        storageReads = 0,
        sends = 0;
      const storage = {
        putObject: async () => {
          puts++;
        },
      };
      assert.deepEqual(await processWorkspaceExports(pool, storage), { claimed: 1, completed: 1, failed: 0 });
      const queued = await pool.query<{ user_id: string }>(
        "select user_id from notification_email_outbox where organization_id=$1",
        [f.organizationId],
      );
      assert.deepEqual(
        queued.rows.map((r) => r.user_id),
        [f.ownerId],
      );
      await pool.query("update memberships set role='viewer' where organization_id=$1 and user_id=$2", [
        f.organizationId,
        f.ownerId,
      ]);
      assert.deepEqual(
        await deliverNotificationEmails(
          pool,
          {
            send: async () => {
              sends++;
              return { providerMessageId: "unexpected" };
            },
          },
          undefined,
          {
            getObject: async () => {
              storageReads++;
              return Buffer.from("unexpected");
            },
          },
        ),
        { claimed: 1, sent: 0, skipped: 1, failed: 0 },
      );
      assert.equal(sends, 0);
      assert.equal(storageReads, 0);
      await pool.query("update memberships set role='owner' where organization_id=$1 and user_id=$2", [
        f.organizationId,
        f.ownerId,
      ]);
      const assignment = await pool.query<{ id: string }>(
        "insert into project_members (organization_id,workspace_id,project_id,user_id) values ($1,$2,$3,$4) returning id",
        [f.organizationId, f.workspaceId, f.privateId, f.memberId],
      );
      await pool.query(
        "insert into export_jobs (organization_id,workspace_id,requested_by,format,report_schedule_id,scheduled_for,idempotency_key) values ($1,$2,$3,'pdf',$4,now()+interval '1 minute',$5)",
        [f.organizationId, f.workspaceId, f.ownerId, scheduleId, randomUUID()],
      );
      assert.deepEqual(await processWorkspaceExports(pool, storage), { claimed: 1, completed: 1, failed: 0 });
      await pool.query("update project_members set deleted_at=now() where id=$1", [assignment.rows[0].id]);
      assert.deepEqual(
        await deliverNotificationEmails(
          pool,
          {
            send: async (candidate) => {
              assert.equal(candidate.userId, f.ownerId);
              sends++;
              return { providerMessageId: "authorized-owner" };
            },
          },
          undefined,
          {
            getObject: async () => {
              storageReads++;
              return Buffer.from("authorized-report");
            },
          },
        ),
        { claimed: 2, sent: 1, skipped: 1, failed: 0 },
      );
      assert.equal(sends, 1);
      assert.equal(storageReads, 1);
      await pool.query("update memberships set role='viewer' where organization_id=$1 and user_id=$2", [
        f.organizationId,
        f.ownerId,
      ]);
      await pool.query(
        "insert into export_jobs (organization_id,workspace_id,requested_by,format,idempotency_key) values ($1,$2,$3,'xlsx',$4)",
        [f.organizationId, f.workspaceId, f.ownerId, randomUUID()],
      );
      assert.deepEqual(await processWorkspaceExports(pool, storage), { claimed: 1, completed: 0, failed: 1 });
      assert.equal(puts, 2);
    } finally {
      await cleanup(f);
    }
  });
});
