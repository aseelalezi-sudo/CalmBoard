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
  taskDependencies,
  taskRelations,
  tasks,
  TenantConflictError,
  workspaces,
} from "../src/index";

after(async () => {
  await pool.end();
});

describe("task dependencies and relations", () => {
  it("synchronizes legacy dependency input and rejects dependency cycles", async () => {
    const organizationId = randomUUID();
    const workspaceId = randomUUID();
    const projectId = randomUUID();

    try {
      await db.insert(organizations).values({
        id: organizationId,
        name: "Task links tenant",
        slug: `task-links-${organizationId}`,
      });
      await db.insert(workspaces).values({
        id: workspaceId,
        organizationId,
        name: "Task links workspace",
        slug: `task-links-${workspaceId}`,
      });
      await db.insert(projects).values({ id: projectId, organizationId, workspaceId, name: "Task links project" });

      const repository = createTasksRepository({ organizationId, workspaceId });
      const blocking = await repository.create({ projectId, title: "Blocking task" });
      const dependent = await repository.create({ projectId, title: "Dependent task" });

      await repository.update(dependent.id, {
        expectedVersion: 1,
        metadata: { dependencies: [blocking.serial, blocking.serial] },
      });
      const activeDependencies = await db
        .select()
        .from(taskDependencies)
        .where(
          and(
            eq(taskDependencies.blockingTaskId, blocking.id),
            eq(taskDependencies.dependentTaskId, dependent.id),
            isNull(taskDependencies.deletedAt),
          ),
        );
      assert.equal(activeDependencies.length, 1);
      await db
        .update(taskDependencies)
        .set({ type: "start_to_start", lagMinutes: 90 })
        .where(eq(taskDependencies.id, activeDependencies[0]!.id));
      const hydratedDependent = await repository.getById(dependent.id);
      assert.deepEqual(hydratedDependent.dependencies, [blocking.serial]);
      assert.deepEqual(hydratedDependent.dependencyLinks, [
        {
          blockingTaskId: blocking.id,
          blockingTaskSerial: blocking.serial,
          type: "start_to_start",
          lagMinutes: 90,
        },
      ]);

      await assert.rejects(
        () => repository.update(blocking.id, { expectedVersion: 1, metadata: { dependencies: [dependent.serial] } }),
        (error: unknown) => error instanceof TenantConflictError,
      );

      const relationInput = [blocking.id, dependent.id];
      await db.insert(taskRelations).values({
        organizationId,
        workspaceId,
        sourceTaskId: relationInput[1],
        targetTaskId: relationInput[0],
        type: "related",
      });
      const [relation] = await db
        .select()
        .from(taskRelations)
        .where(and(eq(taskRelations.organizationId, organizationId), isNull(taskRelations.deletedAt)));
      assert.deepEqual([relation.sourceTaskId, relation.targetTaskId], [...relationInput].sort());
      await assert.rejects(
        () =>
          db.insert(taskRelations).values({
            organizationId,
            workspaceId,
            sourceTaskId: relationInput[0],
            targetTaskId: relationInput[1],
            type: "related",
          }),
        (error: unknown) => (error as { cause?: { code?: string } }).cause?.code === "23505",
      );

      await repository.update(dependent.id, { expectedVersion: 2, metadata: { dependencies: [] } });
      const remainingDependencies = await db
        .select({ id: taskDependencies.id })
        .from(taskDependencies)
        .where(and(eq(taskDependencies.dependentTaskId, dependent.id), isNull(taskDependencies.deletedAt)));
      assert.equal(remainingDependencies.length, 0);

      await repository.softDelete(blocking.id);
      const remainingRelations = await db
        .select({ id: taskRelations.id })
        .from(taskRelations)
        .where(and(eq(taskRelations.organizationId, organizationId), isNull(taskRelations.deletedAt)));
      assert.equal(remainingRelations.length, 0);
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
