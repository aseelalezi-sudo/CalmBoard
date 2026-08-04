import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import {
  createProjectBaselinesRepository,
  createTasksRepository,
  db,
  organizations,
  pool,
  projectBaselineTasks,
  projects,
  workspaces,
} from "../src/index";

after(async () => pool.end());

describe("immutable project baselines", () => {
  it("captures every project task and preserves its original schedule", async () => {
    const organizationId = randomUUID();
    const workspaceId = randomUUID();
    const projectId = randomUUID();
    try {
      await db
        .insert(organizations)
        .values({ id: organizationId, name: "Baseline org", slug: `baseline-${organizationId}` });
      await db
        .insert(workspaces)
        .values({ id: workspaceId, organizationId, name: "Baseline workspace", slug: `baseline-${workspaceId}` });
      await db.insert(projects).values({ id: projectId, organizationId, workspaceId, name: "Baseline project" });
      const tasks = createTasksRepository({ organizationId, workspaceId });
      const scheduled = await tasks.create({
        projectId,
        title: "Release",
        startDate: new Date("2026-08-01T00:00:00Z"),
        dueDate: new Date("2026-08-03T00:00:00Z"),
      });
      await tasks.create({ projectId, title: "Backlog item" });
      const repository = createProjectBaselinesRepository({ organizationId, workspaceId });
      const baseline = await repository.create(projectId, "Initial");
      assert.equal(baseline.taskCount, 2);
      assert.equal(baseline.tasks.length, 2);
      await tasks.update(scheduled.id, { expectedVersion: 1, dueDate: new Date("2026-08-05T00:00:00Z") });
      const [loaded] = await repository.list(projectId);
      assert.equal(
        loaded!.tasks.find((task) => task.sourceTaskId === scheduled.id)!.dueDate!.toISOString(),
        "2026-08-03T00:00:00.000Z",
      );
      await assert.rejects(
        () =>
          db
            .update(projectBaselineTasks)
            .set({ title: "Changed" })
            .where(eq(projectBaselineTasks.baselineId, baseline.id)),
        (error: unknown) => (error as { cause?: { code?: string } }).cause?.code === "55000",
      );
    } finally {
      await db
        .delete(organizations)
        .where(eq(organizations.id, organizationId))
        .catch(() => undefined);
    }
  });
});
