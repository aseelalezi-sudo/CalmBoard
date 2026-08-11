import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import {
  createSprintRepository,
  createTasksRepository,
  db,
  memberships,
  organizations,
  pool,
  projects,
  tasks,
  TenantConflictError,
  users,
  workspaces,
  taskSprintAssignments,
  sprints,
  sprintAnalyticsEvents,
  sprintSnapshots,
} from "../src/index.js";

after(async () => pool.end());

describe("Sprint database integration tests", () => {
  it("manages full sprint lifecycle, concurrency, assignments, completion and cancellation", async () => {
    const organizationId = randomUUID();
    const workspaceId = randomUUID();
    const projectId = randomUUID();
    const actorId = randomUUID();

    try {
      // 1. Setup Tenant and Project
      await db.insert(users).values({ id: actorId, email: `${actorId}@sprint.test`, name: "Sprint Master" });
      await db.insert(organizations).values({
        id: organizationId,
        name: "Sprint tenant",
        slug: `sprint-${organizationId}`,
        ownerId: actorId,
      });
      await db.insert(workspaces).values({
        id: workspaceId,
        organizationId,
        name: "Sprint workspace",
        slug: `sprint-${workspaceId}`,
      });
      await db.insert(memberships).values({
        organizationId,
        workspaceId,
        userId: actorId,
        status: "active",
      });
      await db.insert(projects).values({ id: projectId, organizationId, workspaceId, name: "Sprint Project" });

      const sprintRepo = createSprintRepository({ organizationId, workspaceId, actorId });
      const taskRepo = createTasksRepository({ organizationId, workspaceId, actorId });

      // 2. Create Sprints
      const sprintA = await sprintRepo.createSprint({
        projectId,
        name: "Sprint A",
        status: "planned",
        createdBy: actorId,
      });

      const sprintB = await sprintRepo.createSprint({
        projectId,
        name: "Sprint B",
        status: "planned",
        createdBy: actorId,
      });

      assert.equal(sprintA.status, "planned");
      assert.equal(sprintB.status, "planned");

      // 3. Create Tasks
      const task1 = await taskRepo.create({ projectId, title: "Task 1", status: "todo" });
      const task2 = await taskRepo.create({ projectId, title: "Task 2", status: "in_progress" });
      const task3 = await taskRepo.create({ projectId, title: "Task 3", status: "done" });

      // 4. Assign Tasks to Backlog -> Sprint A
      await sprintRepo.assignTaskToSprint(task1.id, sprintA.id);
      await sprintRepo.assignTaskToSprint(task2.id, sprintA.id);

      let t1 = await taskRepo.getById(task1.id);
      assert.equal(t1.sprintId, sprintA.id);

      // Verify assignment history exists and is open
      let historyA1 = await db.select().from(taskSprintAssignments).where(eq(taskSprintAssignments.taskId, task1.id));
      assert.equal(historyA1.length, 1);
      assert.equal(historyA1[0].removedAt, null);
      assert.equal(historyA1[0].sprintId, sprintA.id);

      // 5. Lifecycle and Concurrency
      const startedSprintA = await sprintRepo.startSprint(sprintA.id, projectId);
      assert.equal(startedSprintA.status, "active");

      // Try starting Sprint B concurrently (should throw 409 Conflict due to active index)
      await assert.rejects(
        () => sprintRepo.startSprint(sprintB.id, projectId),
        (error: unknown) => error instanceof TenantConflictError && /already an active sprint/i.test(error.message),
      );

      // 6. Move task between sprints
      // Move task 2 to sprint B
      await sprintRepo.moveTaskBetweenSprints(task2.id, sprintB.id);
      let t2 = await taskRepo.getById(task2.id);
      assert.equal(t2.sprintId, sprintB.id);

      let historyA2 = await db.select().from(taskSprintAssignments).where(eq(taskSprintAssignments.taskId, task2.id));
      assert.equal(historyA2.length, 2);
      const oldAssignment = historyA2.find((h) => h.sprintId === sprintA.id);
      const newAssignment = historyA2.find((h) => h.sprintId === sprintB.id);
      assert.notEqual(oldAssignment?.removedAt, null);
      assert.equal(newAssignment?.removedAt, null);

      // Move task 2 to backlog
      await sprintRepo.moveTaskBetweenSprints(task2.id, null);
      t2 = await taskRepo.getById(task2.id);
      assert.equal(t2.sprintId, null);

      // 7. Complete Sprint A
      // Task 1 is 'todo' (unfinished) -> move to Backlog
      await sprintRepo.completeSprint(sprintA.id, projectId, { type: "backlog" });

      const completedA = await sprintRepo.getSprint(sprintA.id);
      assert.equal(completedA?.status, "completed");
      assert.notEqual(completedA?.completedAt, null);

      t1 = await taskRepo.getById(task1.id);
      assert.equal(t1.sprintId, null); // Unfinished task moved to backlog

      historyA1 = await db.select().from(taskSprintAssignments).where(eq(taskSprintAssignments.taskId, task1.id));
      assert.notEqual(historyA1[0].removedAt, null); // Assignment closed

      // 8. Start Sprint B and test Sprint-to-Sprint completion
      await sprintRepo.startSprint(sprintB.id, projectId);

      // Assign task1 and task3 to Sprint B
      await sprintRepo.assignTaskToSprint(task1.id, sprintB.id);
      await sprintRepo.assignTaskToSprint(task3.id, sprintB.id); // task3 is 'done'

      const sprintC = await sprintRepo.createSprint({
        projectId,
        name: "Sprint C",
        status: "planned",
        createdBy: actorId,
      });

      // Complete B -> move unfinished to C
      await sprintRepo.completeSprint(sprintB.id, projectId, { type: "sprint", sprintId: sprintC.id });

      const completedB = await sprintRepo.getSprint(sprintB.id);
      assert.equal(completedB?.status, "completed");

      // Task1 (todo) should be in Sprint C
      t1 = await taskRepo.getById(task1.id);
      assert.equal(t1.sprintId, sprintC.id);

      // Task3 (done) should REMAIN in Sprint B (since it was finished)
      let t3 = await taskRepo.getById(task3.id);
      assert.equal(t3.sprintId, sprintB.id);

      // 9. Cancel Sprint C
      await sprintRepo.startSprint(sprintC.id, projectId);
      await sprintRepo.cancelSprint(sprintC.id, projectId);

      const cancelledC = await sprintRepo.getSprint(sprintC.id);
      assert.equal(cancelledC?.status, "cancelled");
      assert.notEqual(cancelledC?.cancelledAt, null);

      // Task1 should be removed from C
      t1 = await taskRepo.getById(task1.id);
      assert.equal(t1.sprintId, null);

      // 10. Soft Delete
      await db.update(sprints).set({ deletedAt: new Date() }).where(eq(sprints.id, cancelledC.id));
      const getDeleted = await sprintRepo.getSprint(cancelledC.id);
      assert.equal(getDeleted, undefined);

      const listAll = await sprintRepo.listSprints(projectId);
      assert.equal(listAll.length, 2); // Only A and B
      assert.equal(
        listAll.find((s) => s.id === cancelledC.id),
        undefined,
      );
    } finally {
      // Production task deletion is soft-delete and intentionally preserves
      // immutable analytics history. This test owns its tenant fixture and
      // hard-deletes it, so historical dependants must be removed explicitly
      // before their RESTRICT-protected task and sprint records.
      await db.delete(sprintAnalyticsEvents).where(eq(sprintAnalyticsEvents.organizationId, organizationId));
      await db.delete(sprintSnapshots).where(eq(sprintSnapshots.organizationId, organizationId));
      await db.delete(taskSprintAssignments).where(eq(taskSprintAssignments.organizationId, organizationId));
      await db.delete(tasks).where(eq(tasks.organizationId, organizationId));
      await db.delete(sprints).where(eq(sprints.organizationId, organizationId));
      await db.delete(projects).where(eq(projects.organizationId, organizationId));
      await db.delete(memberships).where(eq(memberships.organizationId, organizationId));
      await db.delete(workspaces).where(eq(workspaces.organizationId, organizationId));
      await db.delete(organizations).where(eq(organizations.id, organizationId));
      await db.delete(users).where(eq(users.id, actorId));
    }
  });
});
