import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { createTasksRepository, db, organizations, pool, projects, tasks, workspaces } from "../src/index";

after(async () => {
  await pool.end();
});

describe("task serial allocation", () => {
  it("allocates unique ordered serials under concurrent requests", async () => {
    const organizationId = randomUUID();
    const workspaceId = randomUUID();
    const projectId = randomUUID();

    try {
      await db.insert(organizations).values({
        id: organizationId,
        name: "Concurrent serial tenant",
        slug: `serial-tenant-${organizationId}`,
      });
      await db.insert(workspaces).values({
        id: workspaceId,
        organizationId,
        name: "Concurrent serial workspace",
        slug: `serial-workspace-${workspaceId}`,
      });
      await db.insert(projects).values({
        id: projectId,
        organizationId,
        workspaceId,
        name: "Concurrent serial project",
      });

      const repository = createTasksRepository({ organizationId, workspaceId });
      const createdTasks = await Promise.all(
        Array.from({ length: 24 }, (_, index) =>
          repository.create({ projectId, title: `Concurrent task ${index + 1}` }),
        ),
      );
      const serialNumbers = createdTasks
        .map((task) => Number(task.serial.slice("TASK-".length)))
        .sort((left, right) => left - right);

      assert.equal(new Set(serialNumbers).size, createdTasks.length);
      assert.deepEqual(
        serialNumbers,
        Array.from({ length: 24 }, (_, index) => 1041 + index),
      );
    } finally {
      await db
        .delete(tasks)
        .where(eq(tasks.organizationId, organizationId))
        .catch(() => undefined);
      await db
        .delete(projects)
        .where(eq(projects.id, projectId))
        .catch(() => undefined);
      await db
        .delete(workspaces)
        .where(eq(workspaces.id, workspaceId))
        .catch(() => undefined);
      await db
        .delete(organizations)
        .where(eq(organizations.id, organizationId))
        .catch(() => undefined);
    }
  });
});
