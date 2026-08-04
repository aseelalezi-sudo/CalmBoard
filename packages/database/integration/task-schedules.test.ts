import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import { and, eq, isNull } from "drizzle-orm";
import {
  createTasksRepository,
  db,
  organizations,
  pool,
  projects,
  taskRecurrenceRules,
  taskReminders,
  tasks,
  workspaces,
} from "../src/index";

after(async () => {
  await pool.end();
});

describe("task reminders and recurrence", () => {
  it("persists schedules relationally and enforces their tenant lifecycle", async () => {
    const organizationId = randomUUID();
    const workspaceId = randomUUID();
    const projectId = randomUUID();
    const otherOrganizationId = randomUUID();
    const otherWorkspaceId = randomUUID();
    const otherProjectId = randomUUID();

    try {
      await db.insert(organizations).values([
        { id: organizationId, name: "Schedules tenant", slug: `schedules-${organizationId}` },
        { id: otherOrganizationId, name: "Other schedules tenant", slug: `schedules-${otherOrganizationId}` },
      ]);
      await db.insert(workspaces).values([
        { id: workspaceId, organizationId, name: "Schedules workspace", slug: `schedules-${workspaceId}` },
        {
          id: otherWorkspaceId,
          organizationId: otherOrganizationId,
          name: "Other schedules workspace",
          slug: `schedules-${otherWorkspaceId}`,
        },
      ]);
      await db.insert(projects).values([
        { id: projectId, organizationId, workspaceId, name: "Schedules project" },
        {
          id: otherProjectId,
          organizationId: otherOrganizationId,
          workspaceId: otherWorkspaceId,
          name: "Other schedules project",
        },
      ]);

      const repository = createTasksRepository({ organizationId, workspaceId });
      const otherRepository = createTasksRepository({
        organizationId: otherOrganizationId,
        workspaceId: otherWorkspaceId,
      });
      const startsAt = new Date("2026-08-01T09:00:00.000Z");
      const task = await repository.create({
        projectId,
        title: "Recurring release review",
        reminders: [{ id: "release-review", time: "2026-07-31T09:00:00.000Z", label: "Review release" }],
        recurrence: {
          frequency: "weekly",
          interval: 2,
          timezone: "Asia/Riyadh",
          weekdays: [0, 4],
          startsAt,
          maxOccurrences: 12,
        },
      });
      const otherTask = await otherRepository.create({ projectId: otherProjectId, title: "Other tenant task" });

      assert.equal(task.isRecurring, true);
      assert.deepEqual(task.reminders, [
        {
          id: "release-review",
          time: "2026-07-31T09:00:00.000Z",
          label: "Review release",
          sent: false,
        },
      ]);
      assert.equal(task.recurrence?.frequency, "weekly");
      assert.equal(task.recurrence?.timezone, "Asia/Riyadh");

      await repository.update(task.id, {
        expectedVersion: 1,
        metadata: {
          reminders: [{ id: "go-live", time: "2026-08-14T09:00:00.000Z", label: "Go live", sent: true }],
        },
        recurrence: {
          frequency: "monthly",
          monthDay: 14,
          startsAt: new Date("2026-08-14T09:00:00.000Z"),
          endsAt: new Date("2027-08-14T09:00:00.000Z"),
        },
      });
      const updated = await repository.getById(task.id);
      assert.equal(updated.reminders?.[0]?.id, "go-live");
      assert.equal(updated.reminders?.[0]?.sent, true);
      assert.equal(updated.recurrence?.frequency, "monthly");
      assert.equal(updated.recurrence?.monthDay, 14);

      await assert.rejects(
        () =>
          db.insert(taskReminders).values({
            organizationId,
            workspaceId,
            projectId,
            taskId: otherTask.id,
            externalId: "cross-tenant",
            remindAt: startsAt,
            label: "Must fail",
          }),
        (error: unknown) =>
          (error as { cause?: { message?: string } }).cause?.message ===
          "Task schedule does not belong to the task tenant and project scope",
      );

      await repository.update(task.id, { expectedVersion: 2, isRecurring: false });
      assert.equal((await repository.getById(task.id)).isRecurring, false);
      const activeRecurrences = await db
        .select({ id: taskRecurrenceRules.id })
        .from(taskRecurrenceRules)
        .where(and(eq(taskRecurrenceRules.taskId, task.id), isNull(taskRecurrenceRules.deletedAt)));
      assert.equal(activeRecurrences.length, 0);

      await db.update(tasks).set({ isRecurring: true }).where(eq(tasks.id, task.id));
      assert.equal(
        (
          await db
            .select({ id: taskRecurrenceRules.id })
            .from(taskRecurrenceRules)
            .where(and(eq(taskRecurrenceRules.taskId, task.id), isNull(taskRecurrenceRules.deletedAt)))
        ).length,
        1,
      );

      await repository.softDelete(task.id);
      const activeReminders = await db
        .select({ id: taskReminders.id })
        .from(taskReminders)
        .where(and(eq(taskReminders.taskId, task.id), isNull(taskReminders.deletedAt)));
      assert.equal(activeReminders.length, 0);
    } finally {
      await db
        .delete(tasks)
        .where(eq(tasks.organizationId, organizationId))
        .catch(() => undefined);
      await db
        .delete(tasks)
        .where(eq(tasks.organizationId, otherOrganizationId))
        .catch(() => undefined);
      await db
        .delete(projects)
        .where(eq(projects.id, projectId))
        .catch(() => undefined);
      await db
        .delete(projects)
        .where(eq(projects.id, otherProjectId))
        .catch(() => undefined);
      await db
        .delete(workspaces)
        .where(eq(workspaces.id, workspaceId))
        .catch(() => undefined);
      await db
        .delete(workspaces)
        .where(eq(workspaces.id, otherWorkspaceId))
        .catch(() => undefined);
      await db
        .delete(organizations)
        .where(eq(organizations.id, organizationId))
        .catch(() => undefined);
      await db
        .delete(organizations)
        .where(eq(organizations.id, otherOrganizationId))
        .catch(() => undefined);
    }
  });
});
