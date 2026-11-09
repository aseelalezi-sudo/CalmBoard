import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import {
  canReadNotification,
  createActivitiesRepository,
  createNotificationsRepository,
  createTasksRepository,
  createTaskDependenciesRepository,
  pool,
  TenantPermissionDeniedError,
  TenantResourceNotFoundError,
  withDatabaseContext,
} from "../src/index.js";
import { deliverNotificationEmails } from "../../../apps/worker/src/notification-email.js";
import { fixture, cleanup } from "./testing/private-project-fixture.js";

after(async () => pool.end());

async function seedTasks(f: Awaited<ReturnType<typeof fixture>>) {
  const publicTask = randomUUID(),
    privateTask = randomUUID();
  await pool.query(
    "insert into tasks (id,organization_id,workspace_id,project_id,title,serial) values ($1,$2,$3,$4,'Public task','PUBLIC-1'),($5,$2,$3,$6,'Hidden task','SECRET-1')",
    [publicTask, f.organizationId, f.workspaceId, f.publicId, privateTask, f.privateId],
  );
  return { publicTask, privateTask };
}

describe("private activity, notifications and dependencies", () => {
  it("filters before stream limits, hides direct notification reads and rechecks mail delivery", async () => {
    const f = await fixture();
    try {
      const { publicTask, privateTask } = await seedTasks(f);
      await pool.query(
        "insert into activities (organization_id,workspace_id,actor_id,action,entity_type,entity_id,new_values) values ($1,$2,$3,'task.created','task',$4,'{\"title\":\"Public task\"}')",
        [f.organizationId, f.workspaceId, f.ownerId, publicTask],
      );
      await pool.query(
        "insert into activities (organization_id,workspace_id,actor_id,action,entity_type,entity_id,new_values) select $1,$2,$3,'task.updated','task',$4,'{\"title\":\"Hidden task\"}' from generate_series(1,25)",
        [f.organizationId, f.workspaceId, f.ownerId, privateTask],
      );
      const rows = await withDatabaseContext(f.member, () => createActivitiesRepository(f.member).list(1));
      assert.equal(rows.length, 1);
      assert.equal(rows[0].entityId, publicTask);
      assert.equal(rows[0].entityLabel, "Public task");
      const sender = createNotificationsRepository(f.owner);
      const publicNotice = await sender.create({
        userId: f.memberId,
        type: "task_update",
        title: "Public task",
        entityType: "task",
        entityId: publicTask,
      });
      const privateNotice = await sender.create({
        userId: f.memberId,
        type: "task_update",
        title: "Hidden task",
        entityType: "task",
        entityId: privateTask,
      });
      const legacy = await sender.create({
        userId: f.memberId,
        type: "legacy_digest",
        title: "Hidden task",
        body: "No recorded entity",
      });
      const recipient = createNotificationsRepository(f.member);
      const visible = await withDatabaseContext(f.member, () => recipient.listForUser(f.memberId, 1));
      assert.deepEqual(
        visible.map((n) => n.id),
        [publicNotice.id],
      );
      await assert.rejects(
        () => withDatabaseContext(f.member, () => recipient.markRead(privateNotice.id, f.memberId)),
        TenantResourceNotFoundError,
      );
      await withDatabaseContext(f.member, () => recipient.markAllRead(f.memberId));
      const unread = await pool.query<{ is_read: boolean }>("select is_read from notifications where id=$1", [
        privateNotice.id,
      ]);
      assert.equal(unread.rows[0].is_read, false);
      assert.equal(await canReadNotification(f.member, privateNotice.id), false);
      assert.equal(await canReadNotification(f.member, legacy.id), false);
      await sender.enqueueEmail({ userId: f.memberId, type: "task_update", title: "Public task" }, publicNotice.id);
      await sender.enqueueEmail({ userId: f.memberId, type: "task_update", title: "Hidden task" }, privateNotice.id);
      await sender.enqueueEmail({ userId: f.memberId, type: "legacy_digest", title: "Hidden task" });
      const sent: string[] = [];
      assert.deepEqual(
        await deliverNotificationEmails(pool, {
          send: async (candidate) => {
            sent.push(candidate.subject);
            return { providerMessageId: "test-only" };
          },
        }),
        { claimed: 3, sent: 1, skipped: 2, failed: 0 },
      );
      assert.deepEqual(sent, ["Public task"]);
      const assignment = await pool.query<{ id: string }>(
        "insert into project_members (organization_id,workspace_id,project_id,user_id) values ($1,$2,$3,$4) returning id",
        [f.organizationId, f.workspaceId, f.privateId, f.memberId],
      );
      assert.equal(await canReadNotification(f.member, privateNotice.id), true);
      await pool.query("update project_members set deleted_at=now() where id=$1", [assignment.rows[0].id]);
      assert.equal(await canReadNotification(f.member, privateNotice.id), false);
    } finally {
      await cleanup(f);
    }
  });

  it("hides private dependency endpoints and preserves hidden edges when replacing public dependencies", async () => {
    const f = await fixture();
    try {
      const { publicTask, privateTask } = await seedTasks(f);
      const owner = createTaskDependenciesRepository(f.owner),
        member = createTaskDependenciesRepository(f.member);
      const edge = await owner.create({ blockingTaskId: privateTask, dependentTaskId: publicTask }, f.ownerId);
      await pool.query('update tasks set custom_fields=\'{"dependencies":["SECRET-1"]}\' where id=$1', [publicTask]);
      const task = await withDatabaseContext(f.member, () => createTasksRepository(f.member).getById(publicTask));
      assert.deepEqual(task.dependencies, []);
      assert.deepEqual(task.dependencyLinks, []);
      assert.deepEqual(task.customFields?.dependencies, []);
      assert.equal(JSON.stringify(task).includes("SECRET-1"), false);
      assert.deepEqual(await member.listWorkspaceDependencies(), []);
      assert.deepEqual(await member.listByTaskId(publicTask), { incoming: [], outgoing: [] });
      await assert.rejects(() => member.getById(edge.id), TenantResourceNotFoundError);
      assert.equal(await member.delete(edge.id), false);
      await assert.rejects(
        () => member.create({ blockingTaskSerial: "SECRET-1", dependentTaskId: publicTask }),
        TenantResourceNotFoundError,
      );
      await assert.rejects(() => member.replaceTaskDependencies(publicTask, []), TenantPermissionDeniedError);
      const preserved = await pool.query<{ deleted_at: Date | null }>(
        "select deleted_at from task_dependencies where id=$1",
        [edge.id],
      );
      assert.equal(preserved.rows[0].deleted_at, null);
      await withDatabaseContext(f.member, () =>
        createTasksRepository(f.member).update(publicTask, { title: "Visible edit", expectedVersion: task.version }),
      );
      assert.equal((await owner.getById(edge.id)).id, edge.id);
      await pool.query(
        "insert into project_members (organization_id,workspace_id,project_id,user_id) values ($1,$2,$3,$4)",
        [f.organizationId, f.workspaceId, f.privateId, f.memberId],
      );
      assert.equal((await member.listByTaskId(publicTask)).incoming[0].blockingTaskSerial, "SECRET-1");
      assert.equal(await member.delete(edge.id), true);
    } finally {
      await cleanup(f);
    }
  });
});
