import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, it } from "node:test";
import {
  assertExportProjectAccess,
  createAuthorizationRepository,
  createAutomationsRepository,
  createDocumentsRepository,
  createExportJobsRepository,
  createOrganizationExportJobsRepository,
  createTasksRepository,
  pool,
  TenantPermissionDeniedError,
  withDatabaseContext,
} from "../src/index.js";
import { processWorkspaceExports } from "../../../apps/worker/src/workspace-exports.js";
import {
  executeRule,
  enqueueDailyAutomationEvents,
  processAutomationEvents,
  readScheduledAutomationActors,
  type AutomationEventCandidate,
} from "../../../apps/worker/src/automation-events.js";
import { deliverNotificationEmails } from "../../../apps/worker/src/notification-email.js";
import { fixture, cleanup } from "./testing/private-project-fixture.js";

after(async () => pool.end());

it("runs daily private automation as the configured identity and rechecks grants, membership and account state", async () => {
  const f = await fixture();
  try {
    await allowProjects(f);
    await override(f, f.memberId, "automations.manage", "allow");
    const task = await createTasksRepository(f.owner).create({
      projectId: f.privateId,
      title: "Daily private task",
      reporterId: f.ownerId,
    });
    const ruleId = randomUUID();
    await pool.query(
      "insert into automations (id,organization_id,workspace_id,name,trigger,conditions,actions) values ($1,$2,$3,'Daily delegated rule','schedule_daily',$4,$5)",
      [
        ruleId,
        f.organizationId,
        f.workspaceId,
        { projectId: f.privateId },
        { addTag: "scheduled", addComment: "Daily service action", notify: "reporter" },
      ],
    );
    const identities = readScheduledAutomationActors({
      AUTOMATION_SCHEDULED_ACTORS: JSON.stringify([
        { organizationId: f.organizationId, workspaceId: f.workspaceId, actorId: f.memberId },
      ]),
    });
    let day = 0;
    async function runDaily(expected: "success" | "skipped", configured = identities, spoofedActor?: string) {
      day += 1;
      const date = `2041-01-${String(day).padStart(2, "0")}`;
      if (spoofedActor) {
        await pool.query(
          `insert into automation_events (organization_id,workspace_id,task_id,trigger,task_version,actor_id,current,deduplication_key)
           select organization_id,workspace_id,id,'schedule_daily',version,$2,
             jsonb_build_object('status',status,'priority',priority,'projectId',project_id,'assigneeId',assignee_id,'tags',tags,'version',version),$3
           from tasks where id=$1`,
          [task.id, spoofedActor, `schedule-daily/${date}/task/${task.id}`],
        );
      } else
        assert.equal(
          (
            await enqueueDailyAutomationEvents(pool, {
              date,
              organizationId: f.organizationId,
              workspaceId: f.workspaceId,
            })
          ).enqueued,
          1,
        );
      const before = (await pool.query("select version from tasks where id=$1", [task.id])).rows[0].version;
      const result = await processAutomationEvents(pool, {
        batchSize: 250,
        claimTimeoutMinutes: 15,
        scheduledActors: configured,
      });
      assert.equal(result.failed, 0);
      const event = (
        await pool.query("select * from automation_events where task_id=$1 and deduplication_key=$2", [
          task.id,
          `schedule-daily/${date}/task/${task.id}`,
        ])
      ).rows[0];
      const run = (
        await pool.query("select * from automation_runs where event_id=$1 and automation_id=$2", [event.id, ruleId])
      ).rows[0];
      assert.equal(run.status, expected);
      if (expected === "skipped") {
        assert.equal((await pool.query("select version from tasks where id=$1", [task.id])).rows[0].version, before);
        assert.equal(
          (
            await pool.query("select count(*)::int as count from comments where deduplication_key=$1", [
              `automation-comment/${event.id}/${ruleId}/comment`,
            ])
          ).rows[0].count,
          0,
        );
        assert.equal(
          (
            await pool.query("select count(*)::int as count from notifications where deduplication_key like $1", [
              `automation-run/${event.id}/${ruleId}/%`,
            ])
          ).rows[0].count,
          0,
        );
      }
      return event;
    }
    // Neither a queued owner ID nor another tenant's configuration authorizes this task.
    await runDaily("skipped", [], f.ownerId);
    await runDaily("skipped", [{ ...identities[0], organizationId: randomUUID() }], f.ownerId);
    await runDaily("skipped", [{ ...identities[0], workspaceId: randomUUID() }], f.ownerId);
    const authorized = await runDaily("success", identities, f.ownerId);
    const comments = await pool.query("select user_id from comments where task_id=$1", [task.id]);
    assert.deepEqual(
      comments.rows.map((row) => row.user_id),
      [f.memberId],
    );
    assert.ok(
      (
        await pool.query("select id from automation_events where parent_event_id=$1 and actor_id=$2", [
          authorized.id,
          f.memberId,
        ])
      ).rowCount,
    );
    assert.equal(
      (await pool.query("select count(*)::int as count from comments where task_id=$1", [task.id])).rows[0].count,
      1,
    );
    for (const permission of ["automations.manage", "tasks.update", "comments.manage"]) {
      await pool.query(
        "delete from membership_permission_overrides where organization_id=$1 and membership_id in (select id from memberships where user_id=$2) and permission_id in (select id from permissions where key=$3)",
        [f.organizationId, f.memberId, permission],
      );
      await override(f, f.memberId, permission, "deny");
      await runDaily("skipped", identities, f.ownerId);
      await pool.query(
        "delete from membership_permission_overrides where organization_id=$1 and membership_id in (select id from memberships where user_id=$2) and permission_id in (select id from permissions where key=$3)",
        [f.organizationId, f.memberId, permission],
      );
      if (permission === "automations.manage") await override(f, f.memberId, permission, "allow");
    }
    await pool.query("update project_members set deleted_at=now() where project_id=$1 and user_id=$2", [
      f.privateId,
      f.memberId,
    ]);
    await runDaily("skipped", identities, f.ownerId);
    await pool.query("update project_members set deleted_at=null where project_id=$1 and user_id=$2", [
      f.privateId,
      f.memberId,
    ]);
    await pool.query("update memberships set status='suspended' where organization_id=$1 and user_id=$2", [
      f.organizationId,
      f.memberId,
    ]);
    await runDaily("skipped", identities, f.ownerId);
    await pool.query("update memberships set status='active' where organization_id=$1 and user_id=$2", [
      f.organizationId,
      f.memberId,
    ]);
    await pool.query("update users set lifecycle_state='auth_disabled',auth_disabled_at=now() where id=$1", [
      f.memberId,
    ]);
    await runDaily("skipped", identities, f.ownerId);
    await pool.query("update projects set privacy='workspace' where id=$1", [f.privateId]);
    await runDaily("skipped", identities, f.ownerId);
    await pool.query("update projects set privacy='private' where id=$1", [f.privateId]);
    await pool.query("update users set lifecycle_state='active',auth_disabled_at=null where id=$1", [f.memberId]);
    await runDaily("success");
    assert.equal((await pool.query("select runs from automations where id=$1", [ruleId])).rows[0].runs, 2);
    assert.equal(
      (
        await pool.query("select count(*)::int as count from comments where task_id=$1 and user_id=$2", [
          task.id,
          f.memberId,
        ])
      ).rows[0].count,
      2,
    );
  } finally {
    await cleanup(f);
  }
});

async function override(
  f: Awaited<ReturnType<typeof fixture>>,
  userId: string,
  permission: string,
  effect: "allow" | "deny",
  projectId?: string,
) {
  await pool.query(
    `insert into membership_permission_overrides (organization_id,workspace_id,project_id,membership_id,permission_id,scope,effect,created_by)
     select $1,$2,$6,m.id,p.id,$7,$5,$3 from memberships m cross join permissions p
     where m.organization_id=$1 and m.user_id=$3 and p.key=$4`,
    [
      f.organizationId,
      f.workspaceId,
      userId,
      permission,
      effect,
      projectId ?? null,
      projectId ? "project" : "workspace",
    ],
  );
}

async function allowProjects(f: Awaited<ReturnType<typeof fixture>>) {
  await pool.query(
    "insert into project_members (organization_id,workspace_id,project_id,user_id) values ($1,$2,$3,$4)",
    [f.organizationId, f.workspaceId, f.privateId, f.memberId],
  );
}

it("enforces document manager access, inheritance and historical ACL for workspace and organization archives", async () => {
  const f = await fixture();
  try {
    await allowProjects(f);
    await override(f, f.memberId, "data.export", "allow");
    await override(f, f.memberId, "documents.manage", "deny");
    const documents = createDocumentsRepository(f.owner, { canManageWorkspaceDocuments: true });
    const root = await documents.create({
      title: "Restricted root",
      workspaceAccess: "none",
      inheritPermissions: false,
    });
    const child = await documents.create({
      title: "Inherited content",
      parentId: root.id,
      workspaceAccess: "none",
      inheritPermissions: true,
    });
    await documents.saveSnapshot(child.id);
    const member = createExportJobsRepository(f.member);
    for (const format of ["json", "pdf", "xlsx"] as const) {
      await assert.rejects(() => member.request(randomUUID(), format), TenantPermissionDeniedError);
    }
    await documents.setPermission(root.id, f.memberId, "viewer");
    await assert.rejects(() => assertExportProjectAccess(f.member), TenantPermissionDeniedError);
    await documents.setPermission(root.id, f.memberId, "manager");
    await assertExportProjectAccess(f.member);
    await documents.update(child.id, { inheritPermissions: false });
    await assert.rejects(() => assertExportProjectAccess(f.member), TenantPermissionDeniedError);
    await documents.setPermission(child.id, f.memberId, "manager");
    await pool.query("update docs set deleted_at=now() where id=$1", [child.id]);
    await pool.query("delete from document_permissions where doc_id=$1 and user_id=$2", [child.id, f.memberId]);
    await assert.rejects(() => assertExportProjectAccess(f.member), TenantPermissionDeniedError);
    await pool.query("update docs set deleted_at=null where id=$1", [child.id]);
    await documents.setPermission(child.id, f.memberId, "manager");
    await pool.query("update docs set deleted_at=now() where id=$1", [child.id]);
    await assertExportProjectAccess(f.member);
    const job = await member.request(randomUUID(), "json");
    let puts = 0;
    assert.deepEqual(
      await processWorkspaceExports(pool, {
        putObject: async () => {
          puts++;
        },
        getReference: async () => Buffer.from("fixture"),
      }),
      { claimed: 1, completed: 1, failed: 0 },
    );
    assert.equal(puts, 1);
    assert.ok((await member.getDownload(job.id)).objectKey.endsWith(".zip"));
    await documents.removePermission(root.id, f.memberId);
    await assert.rejects(() => member.getDownload(job.id), TenantPermissionDeniedError);

    const memberDocument = await createDocumentsRepository(f.member).create({
      title: "Member owned",
      workspaceAccess: "none",
      inheritPermissions: false,
    });
    await override(f, f.ownerId, "documents.manage", "deny");
    const organization = { organizationId: f.organizationId, actorId: f.ownerId };
    await assert.rejects(
      () =>
        withDatabaseContext(organization, () =>
          createOrganizationExportJobsRepository(organization).request(randomUUID()),
        ),
      TenantPermissionDeniedError,
    );
    await createDocumentsRepository(f.member).setPermission(memberDocument.id, f.ownerId, "manager");
    await withDatabaseContext(organization, () =>
      createOrganizationExportJobsRepository(organization).request(randomUUID()),
    );
  } finally {
    await cleanup(f);
  }
});

it("rechecks document grants before export execution and completion", async () => {
  const f = await fixture();
  try {
    await allowProjects(f);
    await override(f, f.memberId, "data.export", "allow");
    await override(f, f.memberId, "documents.manage", "deny");
    const documents = createDocumentsRepository(f.owner);
    const document = await documents.create({ title: "Controlled report", workspaceAccess: "none" });
    await documents.setPermission(document.id, f.memberId, "manager");
    const member = createExportJobsRepository(f.member);
    await member.request(randomUUID(), "pdf");
    await documents.removePermission(document.id, f.memberId);
    let puts = 0;
    assert.deepEqual(
      await processWorkspaceExports(pool, {
        putObject: async () => {
          puts++;
        },
      }),
      { claimed: 1, completed: 0, failed: 1 },
    );
    assert.equal(puts, 0);
    await documents.setPermission(document.id, f.memberId, "manager");
    await member.request(randomUUID(), "xlsx");
    assert.deepEqual(
      await processWorkspaceExports(pool, {
        putObject: async () => {
          puts++;
          await documents.removePermission(document.id, f.memberId);
        },
      }),
      { claimed: 1, completed: 0, failed: 1 },
    );
    const completed = await pool.query("select id from export_jobs where organization_id=$1 and status='completed'", [
      f.organizationId,
    ]);
    assert.equal(completed.rowCount, 0);
  } finally {
    await cleanup(f);
  }
});

it("keeps scoped document denies and inherited ACL grants distinct from role capabilities", async () => {
  const f = await fixture();
  try {
    await allowProjects(f);
    await override(f, f.memberId, "data.export", "allow");
    const documents = createDocumentsRepository(f.owner, { canManageWorkspaceDocuments: true });
    const root = await documents.create({ title: "Workspace role root", workspaceAccess: "none" });
    const child = await documents.create({
      title: "Project denied child",
      projectId: f.publicId,
      parentId: root.id,
      workspaceAccess: "none",
      inheritPermissions: true,
    });
    await override(f, f.memberId, "documents.manage", "deny", f.publicId);
    const workspaceManager = createDocumentsRepository(f.member, { canManageWorkspaceDocuments: true });
    assert.equal(
      (await workspaceManager.list()).some((document) => document.id === root.id),
      true,
    );
    assert.equal(
      (await workspaceManager.list()).some((document) => document.id === child.id),
      false,
    );
    await assert.rejects(() => workspaceManager.update(child.id, { title: "Overwrite" }), TenantPermissionDeniedError);
    await assert.rejects(() => assertExportProjectAccess(f.member), TenantPermissionDeniedError);
    await documents.setPermission(root.id, f.memberId, "manager");
    assert.equal((await workspaceManager.list()).find((document) => document.id === child.id)?.accessLevel, "manager");
    await assertExportProjectAccess(f.member);
    await documents.removePermission(root.id, f.memberId);
    await pool.query("delete from membership_permission_overrides where organization_id=$1", [f.organizationId]);
    await override(f, f.memberId, "documents.manage", "deny");
    await override(f, f.memberId, "documents.manage", "allow", f.publicId);
    const scopedParent = await documents.create({
      title: "Project role parent",
      projectId: f.publicId,
      workspaceAccess: "none",
    });
    const otherChild = await documents.create({
      title: "Other project child",
      projectId: f.privateId,
      parentId: scopedParent.id,
      workspaceAccess: "none",
      inheritPermissions: true,
    });
    const projectManager = createDocumentsRepository(f.member, { managedProjectIds: [f.publicId] });
    assert.equal(
      (await projectManager.list()).find((document) => document.id === scopedParent.id)?.accessLevel,
      "manager",
    );
    assert.equal(
      (await projectManager.list()).some((document) => document.id === otherChild.id),
      false,
    );
    await documents.setPermission(scopedParent.id, f.memberId, "manager");
    assert.equal(
      (await projectManager.list()).find((document) => document.id === otherChild.id)?.accessLevel,
      "manager",
    );
  } finally {
    await cleanup(f);
  }
});

it("checks document read access for report recipients before storage reads or email delivery", async () => {
  const f = await fixture();
  try {
    await allowProjects(f);
    await override(f, f.memberId, "documents.manage", "deny");
    const documents = createDocumentsRepository(f.owner);
    const document = await documents.create({ title: "Report recipient access", workspaceAccess: "none" });
    await documents.setPermission(document.id, f.memberId, "viewer");
    // Read-only recipients can receive the content report. Permission metadata
    // remains protected by manager access when requesting a complete archive.
    await assertExportProjectAccess(f.member, false);
    const scheduleId = randomUUID();
    await pool.query(
      "insert into report_schedules (id,organization_id,workspace_id,created_by,name,format,cadence,timezone,minute_of_day,next_run_at) values ($1,$2,$3,$4,'Document report','pdf','daily','UTC',480,now()+interval '1 day')",
      [scheduleId, f.organizationId, f.workspaceId, f.ownerId],
    );
    await pool.query(
      "insert into report_schedule_recipients (organization_id,workspace_id,schedule_id,user_id) values ($1,$2,$3,$4)",
      [f.organizationId, f.workspaceId, scheduleId, f.memberId],
    );
    const jobId = randomUUID();
    await pool.query(
      "insert into export_jobs (id,organization_id,workspace_id,requested_by,format,report_schedule_id,scheduled_for,idempotency_key) values ($1,$2,$3,$4,'pdf',$5,now(),$6)",
      [jobId, f.organizationId, f.workspaceId, f.ownerId, scheduleId, jobId],
    );
    assert.deepEqual(await processWorkspaceExports(pool, { putObject: async () => {} }), {
      claimed: 1,
      completed: 1,
      failed: 0,
    });
    let reads = 0;
    let sends = 0;
    const transport = {
      send: async () => {
        sends++;
        return { providerMessageId: "fixture" };
      },
    };
    const storage = {
      getObject: async () => {
        reads++;
        return Buffer.from("fixture");
      },
    };
    await documents.removePermission(document.id, f.memberId);
    assert.deepEqual(await deliverNotificationEmails(pool, transport, undefined, storage), {
      claimed: 1,
      sent: 0,
      skipped: 1,
      failed: 0,
    });
    assert.equal(reads, 0);
    assert.equal(sends, 0);
    await documents.setPermission(document.id, f.memberId, "viewer");
    const nextJobId = randomUUID();
    await pool.query(
      "insert into export_jobs (id,organization_id,workspace_id,requested_by,format,report_schedule_id,scheduled_for,idempotency_key) values ($1,$2,$3,$4,'pdf',$5,now()+interval '1 day',$6)",
      [nextJobId, f.organizationId, f.workspaceId, f.ownerId, scheduleId, nextJobId],
    );
    assert.deepEqual(await processWorkspaceExports(pool, { putObject: async () => {} }), {
      claimed: 1,
      completed: 1,
      failed: 0,
    });
    assert.deepEqual(await deliverNotificationEmails(pool, transport, undefined, storage), {
      claimed: 1,
      sent: 1,
      skipped: 0,
      failed: 0,
    });
    assert.equal(reads, 1);
    assert.equal(sends, 1);
  } finally {
    await cleanup(f);
  }
});

it("revokes private project access when its assigned team is deleted or membership changes", async () => {
  const f = await fixture();
  try {
    const teamId = randomUUID();
    await pool.query("insert into teams (id,organization_id,workspace_id,name) values ($1,$2,$3,'Access team')", [
      teamId,
      f.organizationId,
      f.workspaceId,
    ]);
    await pool.query("update memberships set team_id=$1 where organization_id=$2 and user_id=$3", [
      teamId,
      f.organizationId,
      f.memberId,
    ]);
    await pool.query(
      "insert into project_teams (organization_id,workspace_id,project_id,team_id) values ($1,$2,$3,$4)",
      [f.organizationId, f.workspaceId, f.privateId, teamId],
    );
    const auth = createAuthorizationRepository();
    const scope = { organizationId: f.organizationId, workspaceId: f.workspaceId, projectId: f.privateId };
    assert.equal((await auth.resolve(f.memberId, scope)).member, true);
    await pool.query("update projects set privacy='private-members' where id=$1", [f.privateId]);
    assert.equal((await auth.resolve(f.memberId, scope)).member, true);
    await pool.query("update teams set deleted_at=now() where id=$1", [teamId]);
    assert.equal((await auth.resolve(f.memberId, scope)).member, false);
    await pool.query("update teams set deleted_at=null where id=$1", [teamId]);
    assert.equal((await auth.resolve(f.memberId, scope)).member, true);
    await pool.query("update memberships set team_id=null where organization_id=$1 and user_id=$2", [
      f.organizationId,
      f.memberId,
    ]);
    assert.equal((await auth.resolve(f.memberId, scope)).member, false);
    await override(f, f.memberId, "tasks.update", "allow");
    assert.equal((await auth.resolve(f.memberId, scope)).member, false);
    await override(f, f.memberId, "projects.view_private", "allow");
    assert.equal((await auth.resolve(f.memberId, scope)).member, true);
  } finally {
    await cleanup(f);
  }
});

it("checks current automation actor permissions and hides private execution history and counters", async () => {
  const f = await fixture();
  try {
    const privateTask = await createTasksRepository(f.owner).create({
      projectId: f.privateId,
      title: "Private automation",
      reporterId: f.ownerId,
    });
    const publicTask = await createTasksRepository(f.owner).create({
      projectId: f.publicId,
      title: "Public automation",
    });
    const ruleId = randomUUID();
    const publicRuleId = randomUUID();
    await pool.query(
      "insert into automations (id,organization_id,workspace_id,name,trigger,conditions,actions) values ($1,$2,$3,'Private rule','task_created','{}',$4),($5,$2,$3,'Public rule','task_created','{}',$6)",
      [
        ruleId,
        f.organizationId,
        f.workspaceId,
        { setPriority: "high", addComment: "Authorized automation", notify: "reporter" },
        publicRuleId,
        { setPriority: "high" },
      ],
    );
    async function event(taskId: string, actorId: string | null): Promise<AutomationEventCandidate> {
      const id = randomUUID();
      const claimToken = randomUUID();
      const task = (await pool.query("select * from tasks where id=$1", [taskId])).rows[0];
      const current = {
        status: task.status,
        priority: task.priority,
        projectId: task.project_id,
        assigneeId: task.assignee_id,
        tags: task.tags,
        version: task.version,
      };
      await pool.query(
        "insert into automation_events (id,organization_id,workspace_id,task_id,trigger,task_version,actor_id,current,deduplication_key,status,claimed_at,claim_token,attempts) values ($1,$2,$3,$4,'task_created',$5,$6,$7,$8,'processing',now(),$9,1)",
        [id, f.organizationId, f.workspaceId, taskId, task.version, actorId, current, id, claimToken],
      );
      return {
        id,
        organizationId: f.organizationId,
        workspaceId: f.workspaceId,
        taskId,
        trigger: "task_created",
        taskVersion: task.version,
        actorId,
        previous: null,
        current,
        depth: 0,
        attempt: 1,
        maxAttempts: 8,
        claimToken,
      };
    }
    assert.equal(await executeRule(pool, await event(privateTask.id, f.memberId), ruleId), "skipped");
    await pool.query("update users set lifecycle_state='auth_disabled',auth_disabled_at=now() where id=$1", [
      f.memberId,
    ]);
    assert.equal((await createAuthorizationRepository().resolve(f.memberId, f.member)).member, false);
    assert.equal(await executeRule(pool, await event(publicTask.id, f.memberId), publicRuleId), "skipped");
    await assert.rejects(() => assertExportProjectAccess(f.member, false), TenantPermissionDeniedError);
    await pool.query("update users set lifecycle_state='deletion_pending',auth_disabled_at=null where id=$1", [
      f.memberId,
    ]);
    assert.equal((await createAuthorizationRepository().resolve(f.memberId, f.member)).member, true);
    await pool.query("update users set lifecycle_state='active' where id=$1", [f.memberId]);
    assert.equal(await executeRule(pool, await event(privateTask.id, null), ruleId), "skipped");
    const authorized = await event(privateTask.id, f.ownerId);
    assert.equal(await executeRule(pool, authorized, ruleId), "success");
    assert.equal(await executeRule(pool, authorized, ruleId), "success");
    await allowProjects(f);
    await pool.query("update memberships set role='viewer' where organization_id=$1 and user_id=$2", [
      f.organizationId,
      f.memberId,
    ]);
    assert.equal(await executeRule(pool, await event(privateTask.id, f.memberId), ruleId), "skipped");
    await pool.query("update memberships set role='member' where organization_id=$1 and user_id=$2", [
      f.organizationId,
      f.memberId,
    ]);
    await pool.query("update project_members set deleted_at=now() where project_id=$1 and user_id=$2", [
      f.privateId,
      f.memberId,
    ]);
    assert.equal(await executeRule(pool, await event(privateTask.id, f.memberId), ruleId), "skipped");
    assert.equal(await executeRule(pool, await event(publicTask.id, null), publicRuleId), "success");
    const limited = await createAutomationsRepository(f.member).list();
    assert.deepEqual(
      limited.automations.map((rule) => rule.id),
      [publicRuleId],
    );
    assert.equal(
      limited.runs.some((run) => run.taskId === privateTask.id),
      false,
    );
    const owner = await createAutomationsRepository(f.owner).list();
    assert.equal(owner.automations.find((rule) => rule.id === ruleId)?.runs, 1);
    const comments = await pool.query("select id from comments where task_id=$1", [privateTask.id]);
    assert.equal(comments.rowCount, 1);
    const legacyId = randomUUID();
    await pool.query(
      "insert into automations (id,organization_id,workspace_id,name,trigger) values ($1,$2,$3,'Legacy','task_created')",
      [legacyId, f.organizationId, f.workspaceId],
    );
    await pool.query(
      "insert into automation_runs (organization_id,workspace_id,automation_id,status,message) values ($1,$2,$3,'success','Legacy private details')",
      [f.organizationId, f.workspaceId, legacyId],
    );
    assert.equal(
      (await createAutomationsRepository(f.member).list()).automations.some((rule) => rule.id === legacyId),
      false,
    );
    assert.equal(
      (await createAutomationsRepository(f.owner).list()).automations.some((rule) => rule.id === legacyId),
      true,
    );
  } finally {
    await cleanup(f);
  }
});
