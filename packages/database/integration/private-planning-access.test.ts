import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, it } from "node:test";
import {
  createAttachmentsRepository,
  createGoalsRepository,
  createTimeLogsRepository,
  pool,
  TenantResourceNotFoundError,
  withDatabaseContext,
} from "../src/index.js";
import { fixture, cleanup } from "./testing/private-project-fixture.js";

after(async () => pool.end());

async function seedTasks(f: Awaited<ReturnType<typeof fixture>>) {
  const publicTask = randomUUID();
  const privateTask = randomUUID();
  await pool.query(
    "insert into tasks (id,organization_id,workspace_id,project_id,title,serial,progress) values ($1,$2,$3,$4,'Public task','PUBLIC-1',20),($5,$2,$3,$6,'Hidden task','SECRET-1',80)",
    [publicTask, f.organizationId, f.workspaceId, f.publicId, privateTask, f.privateId],
  );
  return { publicTask, privateTask };
}

async function assign(f: Awaited<ReturnType<typeof fixture>>) {
  await pool.query(
    "insert into project_members (organization_id,workspace_id,project_id,user_id) values ($1,$2,$3,$4)",
    [f.organizationId, f.workspaceId, f.privateId, f.memberId],
  );
}

async function revoke(f: Awaited<ReturnType<typeof fixture>>) {
  await pool.query("update project_members set deleted_at=now() where project_id=$1 and user_id=$2", [
    f.privateId,
    f.memberId,
  ]);
}

it("hides complete goal families and mutations when a linked private task is inaccessible", async () => {
  const f = await fixture();
  try {
    const { publicTask, privateTask } = await seedTasks(f);
    const owner = createGoalsRepository(f.owner);
    const member = createGoalsRepository(f.member);
    const objective = await owner.create({ type: "objective", title: "Hidden aggregate" });
    const result = await owner.create({ type: "key_result", parentId: objective.id, title: "Hidden result" });
    const sibling = await owner.create({ type: "key_result", parentId: objective.id, title: "Sibling" });
    await owner.linkTask(result.id, privateTask);
    await owner.checkIn(result.id, { note: "Historical secret progress" });
    const publicObjective = await owner.create({ type: "objective", title: "Public aggregate" });
    const publicResult = await owner.create({
      type: "key_result",
      parentId: publicObjective.id,
      title: "Public result",
    });
    await owner.linkTask(publicResult.id, publicTask);
    assert.deepEqual(
      new Set((await member.list()).map((goal) => goal.id)),
      new Set([publicObjective.id, publicResult.id]),
    );
    await assert.rejects(() => member.update(objective.id, { title: "Overwrite" }), TenantResourceNotFoundError);
    await assert.rejects(() => member.checkIn(sibling.id, { note: "Guess" }), TenantResourceNotFoundError);
    await assert.rejects(() => member.unlinkTask(result.id, privateTask), TenantResourceNotFoundError);
    await assert.rejects(() => member.linkTask(publicResult.id, privateTask), TenantResourceNotFoundError);
    await assert.rejects(
      () => member.create({ type: "key_result", parentId: objective.id, title: "Guess" }),
      TenantResourceNotFoundError,
    );
    await assign(f);
    assert.equal((await member.list()).find((goal) => goal.id === result.id)?.linkedTasks[0]?.serial, "SECRET-1");
    await revoke(f);
    await pool.query("update tasks set deleted_at=now() where id=$1", [privateTask]);
    assert.equal(JSON.stringify(await member.list()).includes("Hidden"), false);
    assert.equal(
      (await owner.list()).find((goal) => goal.id === result.id)?.checkins[0]?.note,
      "Historical secret progress",
    );
  } finally {
    await cleanup(f);
  }
});

it("filters own log limits and hides whole sheets from submitters and reviewers after access revocation", async () => {
  const f = await fixture();
  try {
    const { publicTask, privateTask } = await seedTasks(f);
    const member = createTimeLogsRepository(f.member);
    const startedAt = new Date("2026-01-07T12:00:00.000Z");
    await pool.query('update tasks set custom_fields=\'{"dependencies":["SECRET-1"]}\' where id=$1', [publicTask]);
    await assert.rejects(
      () => member.create({ taskId: privateTask, durationMinutes: 30 }),
      TenantResourceNotFoundError,
    );
    await assign(f);
    const publicLog = await member.create({ taskId: publicTask, durationMinutes: 10, startedAt });
    const privateLog = await member.create({ taskId: privateTask, durationMinutes: 90, startedAt });
    const own = await member.list();
    assert.equal(own.timesheets[0]?.totalMinutes, 100);
    const submitted = await member.submit(own.timesheets[0]!.id, own.timesheets[0]!.version);
    assert.equal(submitted?.status, "submitted");
    const owner = createTimeLogsRepository(f.owner);
    const ownerLog = await owner.create({ taskId: privateTask, durationMinutes: 20, startedAt });
    const ownerSheet = (await owner.list()).timesheets[0]!;
    await owner.submit(ownerSheet.id, ownerSheet.version);
    const before = await member.list({ includeReviewQueue: true });
    assert.ok(before.reviewQueue.some((sheet) => sheet.id === ownerSheet.id));
    await revoke(f);
    // Hidden recent rows must not consume the list limit ahead of an older visible log.
    const laterSheetId = randomUUID();
    await pool.query(
      "insert into timesheets (id,organization_id,workspace_id,user_id,period_start,period_end) select $1,organization_id,workspace_id,user_id,period_start+7,period_end+7 from timesheets where id=$2",
      [laterSheetId, submitted!.id],
    );
    await pool.query(
      "insert into time_logs (organization_id,workspace_id,task_id,user_id,timesheet_id,duration_minutes,started_at,ended_at) select $1,$2,$3,$4,$5,1,$6::timestamptz+interval '7 days',$6::timestamptz+interval '7 days 1 minute' from generate_series(1,105)",
      [f.organizationId, f.workspaceId, privateTask, f.memberId, laterSheetId, startedAt],
    );
    const after = await member.list({ includeReviewQueue: true });
    assert.deepEqual(
      after.logs.map((log) => log.id),
      [publicLog.id],
    );
    assert.equal(after.logs[0]?.task.serial, "PUBLIC-1");
    assert.equal("customFields" in after.logs[0]!.task, false);
    assert.equal(after.totalMinutes, 10);
    assert.deepEqual(after.timesheets, []);
    assert.deepEqual(after.reviewQueue, []);
    const serialized = JSON.stringify(after);
    assert.equal(serialized.includes(privateLog.id), false);
    assert.equal(serialized.includes(ownerLog.id), false);
    assert.equal(serialized.includes("SECRET-1"), false);
    await assert.rejects(() => member.submit(submitted!.id, submitted!.version), TenantResourceNotFoundError);
    await assert.rejects(
      () => member.review(ownerSheet.id, { decision: "approved", expectedVersion: ownerSheet.version + 1 }),
      TenantResourceNotFoundError,
    );
    const state = await pool.query<{ status: string }>("select status from timesheets where id=$1", [ownerSheet.id]);
    assert.equal(state.rows[0]?.status, "submitted");
    const reviewed = await owner.review(submitted!.id, {
      decision: "rejected",
      expectedVersion: submitted!.version,
      reason: "Add a client reference",
    });
    assert.equal(reviewed?.totalMinutes, 100);
    assert.equal(reviewed?.status, "rejected");
  } finally {
    await cleanup(f);
  }
});

it("rechecks attachment targets for reads, scan/preview updates and deletion by attachment ID", async () => {
  const f = await fixture();
  try {
    const { publicTask, privateTask } = await seedTasks(f);
    const owner = createAttachmentsRepository(f.owner);
    const member = createAttachmentsRepository(f.member);
    const input = {
      uploaderId: f.ownerId,
      fileName: "private.txt",
      fileSize: 4,
      mimeType: "text/plain",
      storageReference: "s3://test/private",
    };
    const taskAttachment = await owner.create({ ...input, taskId: privateTask });
    const projectAttachment = await owner.create({ ...input, projectId: f.privateId });
    for (const attachment of [taskAttachment, projectAttachment]) {
      await assert.rejects(() => member.get(attachment.id), TenantResourceNotFoundError);
      await assert.rejects(
        () => member.setScanResult(attachment.id, { status: "clean", engine: "test" }),
        TenantResourceNotFoundError,
      );
      await assert.rejects(
        () => member.setPreviewResult(attachment.id, { status: "source" }),
        TenantResourceNotFoundError,
      );
      await assert.rejects(() => member.delete(attachment.id), TenantResourceNotFoundError);
    }
    await assert.rejects(() => member.create({ ...input, taskId: privateTask }), TenantResourceNotFoundError);
    await assert.rejects(() => member.list({ projectId: f.privateId }), TenantResourceNotFoundError);
    const publicAttachment = await owner.create({ ...input, taskId: publicTask });
    assert.equal((await member.get(publicAttachment.id)).id, publicAttachment.id);
    await assign(f);
    await member.setScanResult(taskAttachment.id, { status: "clean", engine: "test" });
    await member.setPreviewResult(projectAttachment.id, { status: "source" });
    await revoke(f);
    await assert.rejects(() => member.get(taskAttachment.id), TenantResourceNotFoundError);
    assert.equal((await owner.get(projectAttachment.id)).previewStatus, "source");
    const deleted = await owner.delete(projectAttachment.id);
    assert.equal(deleted.id, projectAttachment.id);
    await pool.query("update tasks set deleted_at=now() where id=$1", [privateTask]);
    await assert.rejects(() => owner.get(taskAttachment.id), TenantResourceNotFoundError);
    await withDatabaseContext(f.owner, () => owner.delete(publicAttachment.id));
  } finally {
    await cleanup(f);
  }
});
