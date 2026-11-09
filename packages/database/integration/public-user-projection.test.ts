import assert from "node:assert/strict";
import { after, it } from "node:test";
import {
  createActivitiesRepository,
  createCommentsRepository,
  createDocumentsRepository,
  createMembershipsRepository,
  createTasksRepository,
  createTaskWorkflowsRepository,
  createUserSkillsRepository,
  pool,
  withDatabaseContext,
} from "../src/index.js";
import { fixture, cleanup } from "./testing/private-project-fixture.js";

after(async () => pool.end());

it("never returns account security fields in collaboration users, including mutation responses", async () => {
  const f = await fixture();
  const sentinel = "synthetic-password-hash-not-a-credential";
  try {
    await pool.query("update users set password_hash=$1, last_login_at=now() where id=any($2::uuid[])", [
      sentinel,
      [f.ownerId, f.memberId],
    ]);
    await withDatabaseContext(f.owner, async () => {
      const task = await createTasksRepository(f.owner).create({
        projectId: f.publicId,
        title: "Public collaboration",
        assigneeIds: [f.memberId],
        followerIds: [f.ownerId],
      });
      const comments = createCommentsRepository(f.owner);
      await comments.create({ taskId: task.id, userId: f.ownerId, content: "Hello" });
      const documents = createDocumentsRepository(f.owner);
      const document = await documents.create({ title: "Public document", projectId: f.publicId });
      await documents.saveSnapshot(document.id);
      const approvals = await createTaskWorkflowsRepository(f.owner).requestApproval({
        taskId: task.id,
        reviewerIds: [f.memberId],
      });
      const activities = createActivitiesRepository(f.owner);
      await activities.create({ actorId: f.ownerId, action: "task.updated", entityType: "task", entityId: task.id });
      const members = await createMembershipsRepository(f.owner).list();
      const skills = await createUserSkillsRepository(f.owner).update(f.memberId, ["testing"]);
      const embeddedUsers = [
        task.assignee,
        ...task.assignees,
        ...task.followers,
        ...(await comments.listByTask(task.id)).map((row) => row.user),
        ...(await documents.list()).map((row) => row.author),
        ...(await documents.listVersions(document.id)).map((row) => row.savedBy),
        ...approvals.reviewers.map((row) => row.user),
        ...(await activities.list()).map((row) => row.actor),
        ...members.members.map((row) => row.user),
        skills,
      ];
      assert.ok(embeddedUsers.length >= 10);
      for (const user of embeddedUsers) {
        assert.ok(user);
        assert.deepEqual(Object.keys(user).sort(), ["avatarUrl", "email", "id", "locale", "name", "skills"]);
        assert.ok(user.email.endsWith("@example.test"));
        assert.equal(JSON.stringify(user).includes(sentinel), false);
      }
      assert.deepEqual(skills.skills, ["testing"]);
    });
  } finally {
    await cleanup(f);
  }
});
