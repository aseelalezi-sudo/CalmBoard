import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import {
  createGoalsRepository,
  createTasksRepository,
  db,
  goals,
  memberships,
  organizations,
  pool,
  projects,
  tasks,
  TenantConflictError,
  users,
  workspaces,
} from "../src/index";

after(async () => pool.end());

describe("weighted objectives and key results", () => {
  it("aggregates measurements and linked task progress with trusted relational check-ins", async () => {
    const organizationId = randomUUID();
    const workspaceId = randomUUID();
    const projectId = randomUUID();
    const actorId = randomUUID();

    try {
      await db.insert(users).values({ id: actorId, email: `${actorId}@example.test`, name: "OKR owner" });
      await db.insert(organizations).values({
        id: organizationId,
        name: "OKR tenant",
        slug: `okr-${organizationId}`,
        ownerId: actorId,
      });
      await db.insert(workspaces).values({
        id: workspaceId,
        organizationId,
        name: "OKR workspace",
        slug: `okr-${workspaceId}`,
      });
      await db.insert(memberships).values({
        organizationId,
        workspaceId,
        userId: actorId,
        status: "active",
      });
      await db.insert(projects).values({ id: projectId, organizationId, workspaceId, name: "OKR project" });

      const repository = createGoalsRepository({ organizationId, workspaceId, actorId });
      const objective = await repository.create({
        type: "objective",
        title: "Improve delivery",
        ownerId: actorId,
      });
      await assert.rejects(
        () => repository.create({ type: "key_result", title: "Orphan result", ownerId: actorId }),
        (error: unknown) => error instanceof TenantConflictError && /requires an objective/.test(error.message),
      );

      const measured = await repository.create({
        type: "key_result",
        parentId: objective.id,
        title: "Raise predictability",
        progressMode: "measurement",
        startValue: 0,
        currentValue: 25,
        targetValue: 100,
        weight: 1,
        ownerId: actorId,
      });
      assert.equal(measured.progress, 25);
      const measuredCheckin = await repository.checkIn(measured.id, {
        currentValue: 60,
        note: "Forecast accuracy improved",
      });
      assert.equal(measuredCheckin.progress, 60);
      assert.equal(measuredCheckin.checkins[0]?.author, "OKR owner");

      const manual = await repository.create({
        type: "key_result",
        parentId: objective.id,
        title: "Adopt release review",
        progressMode: "manual",
        weight: 3,
        ownerId: actorId,
      });
      await repository.checkIn(manual.id, { progress: 100, note: "Review adopted" });
      assert.equal((await repository.list()).find((goal) => goal.id === objective.id)?.progress, 90);

      const taskRepository = createTasksRepository({ organizationId, workspaceId, actorId });
      const task = await taskRepository.create({ projectId, title: "Automate release report" });
      await assert.rejects(
        () => repository.linkTask(objective.id, task.id),
        (error: unknown) => error instanceof TenantConflictError && /only to key results/.test(error.message),
      );
      await repository.linkTask(measured.id, task.id, 2);
      await taskRepository.update(task.id, { expectedVersion: 1, progress: 80 });

      const afterTask = await repository.list();
      assert.equal(afterTask.find((goal) => goal.id === measured.id)?.progress, 80);
      assert.equal(afterTask.find((goal) => goal.id === objective.id)?.progress, 95);
      assert.equal(afterTask.find((goal) => goal.id === measured.id)?.linkedTasks[0]?.serial, task.serial);

      await repository.unlinkTask(measured.id, task.id);
      const afterUnlink = await repository.list();
      assert.equal(afterUnlink.find((goal) => goal.id === measured.id)?.progress, 0);
      assert.equal(afterUnlink.find((goal) => goal.id === objective.id)?.progress, 75);
    } finally {
      await db
        .update(goals)
        .set({ parentId: null })
        .where(eq(goals.organizationId, organizationId))
        .catch(() => undefined);
      await db
        .delete(goals)
        .where(eq(goals.organizationId, organizationId))
        .catch(() => undefined);
      await db
        .delete(tasks)
        .where(eq(tasks.organizationId, organizationId))
        .catch(() => undefined);
      await db
        .delete(projects)
        .where(eq(projects.id, projectId))
        .catch(() => undefined);
      await db
        .delete(memberships)
        .where(eq(memberships.organizationId, organizationId))
        .catch(() => undefined);
      await db
        .delete(workspaces)
        .where(eq(workspaces.id, workspaceId))
        .catch(() => undefined);
      await db
        .delete(organizations)
        .where(eq(organizations.id, organizationId))
        .catch(() => undefined);
      await db
        .delete(users)
        .where(eq(users.id, actorId))
        .catch(() => undefined);
    }
  });
});
