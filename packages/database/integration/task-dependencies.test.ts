import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import { and, eq, isNull } from "drizzle-orm";
import {
  createTaskDependenciesRepository,
  createTasksRepository,
  db,
  organizations,
  pool,
  projects,
  taskDependencies,
  taskRelations,
  tasks,
  TenantConflictError,
  TenantResourceNotFoundError,
  workspaces,
} from "../src/index";

after(async () => {
  await pool.end();
});

describe("task dependencies domain and repository integration", () => {
  it("supports direct CRUD, directional links, and lag minutes", async () => {
    const orgId = randomUUID();
    const wsId = randomUUID();
    const projId = randomUUID();

    try {
      await db.insert(organizations).values({ id: orgId, name: "Dep CRUD Org", slug: `dep-crud-${orgId}` });
      await db
        .insert(workspaces)
        .values({ id: wsId, organizationId: orgId, name: "Dep CRUD WS", slug: `dep-crud-${wsId}` });
      await db.insert(projects).values({ id: projId, organizationId: orgId, workspaceId: wsId, name: "Dep CRUD Proj" });

      const taskRepo = createTasksRepository({ organizationId: orgId, workspaceId: wsId });
      const depRepo = createTaskDependenciesRepository({ organizationId: orgId, workspaceId: wsId });

      const taskA = await taskRepo.create({ projectId: projId, title: "Task A (Predecessor)" });
      const taskB = await taskRepo.create({ projectId: projId, title: "Task B (Successor)" });

      // 1. Create dependency: A blocks B (finish_to_start, default lag 0)
      const dep1 = await depRepo.create({
        blockingTaskId: taskA.id,
        dependentTaskId: taskB.id,
      });

      assert.ok(dep1.id);
      assert.equal(dep1.blockingTaskId, taskA.id);
      assert.equal(dep1.dependentTaskId, taskB.id);
      assert.equal(dep1.type, "finish_to_start");
      assert.equal(dep1.lagMinutes, 0);

      // 2. getById
      const fetched = await depRepo.getById(dep1.id);
      assert.equal(fetched.id, dep1.id);

      // 3. listByTaskId for taskB (incoming) and taskA (outgoing)
      const listB = await depRepo.listByTaskId(taskB.id);
      assert.equal(listB.incoming.length, 1);
      assert.equal(listB.incoming[0]!.blockingTaskId, taskA.id);
      assert.equal(listB.incoming[0]!.blockingTaskSerial, taskA.serial);
      assert.equal(listB.outgoing.length, 0);

      const listA = await depRepo.listByTaskId(taskA.id);
      assert.equal(listA.incoming.length, 0);
      assert.equal(listA.outgoing.length, 1);
      assert.equal(listA.outgoing[0]!.dependentTaskId, taskB.id);
      assert.equal(listA.outgoing[0]!.dependentTaskSerial, taskB.serial);

      // 4. Idempotent creation: exact same relationship returns existing
      const duplicate = await depRepo.create({
        blockingTaskId: taskA.id,
        dependentTaskId: taskB.id,
        type: "finish_to_start",
        lagMinutes: 0,
      });
      assert.equal(duplicate.id, dep1.id);

      // 5. Update lag on same endpoints
      const updatedLag = await depRepo.create({
        blockingTaskId: taskA.id,
        dependentTaskId: taskB.id,
        type: "finish_to_start",
        lagMinutes: -120, // 2 hours lead time
      });
      assert.equal(updatedLag.id, dep1.id);
      assert.equal(updatedLag.lagMinutes, -120);

      // 6. Delete dependency
      const deleted = await depRepo.delete(dep1.id);
      assert.equal(deleted, true);

      // Verify no longer active
      const listAfterDelete = await depRepo.listByTaskId(taskB.id);
      assert.equal(listAfterDelete.incoming.length, 0);

      // Idempotent delete
      const deleteAgain = await depRepo.delete(dep1.id);
      assert.equal(deleteAgain, false);
    } finally {
      await db
        .delete(tasks)
        .where(eq(tasks.organizationId, orgId))
        .catch(() => undefined);
      await db
        .delete(projects)
        .where(eq(projects.organizationId, orgId))
        .catch(() => undefined);
      await db
        .delete(workspaces)
        .where(eq(workspaces.id, wsId))
        .catch(() => undefined);
      await db
        .delete(organizations)
        .where(eq(organizations.id, orgId))
        .catch(() => undefined);
    }
  });

  it("permits cross-project dependencies within the same workspace, but rejects cross-workspace/cross-org", async () => {
    const org1Id = randomUUID();
    const org2Id = randomUUID();
    const ws1Id = randomUUID();
    const ws2Id = randomUUID();
    const proj1Id = randomUUID();
    const proj2Id = randomUUID();

    try {
      await db.insert(organizations).values([
        { id: org1Id, name: "Org 1", slug: `org-1-${org1Id}` },
        { id: org2Id, name: "Org 2", slug: `org-2-${org2Id}` },
      ]);
      await db.insert(workspaces).values([
        { id: ws1Id, organizationId: org1Id, name: "WS 1", slug: `ws-1-${ws1Id}` },
        { id: ws2Id, organizationId: org1Id, name: "WS 2", slug: `ws-2-${ws2Id}` },
      ]);
      await db.insert(projects).values([
        { id: proj1Id, organizationId: org1Id, workspaceId: ws1Id, name: "Project Alpha" },
        { id: proj2Id, organizationId: org1Id, workspaceId: ws1Id, name: "Project Beta" },
      ]);

      const taskRepo1 = createTasksRepository({ organizationId: org1Id, workspaceId: ws1Id });
      const depRepo1 = createTaskDependenciesRepository({ organizationId: org1Id, workspaceId: ws1Id });
      const taskRepo2 = createTasksRepository({ organizationId: org1Id, workspaceId: ws2Id });

      // Task 1 in Project Alpha, Task 2 in Project Beta (both in WS 1)
      const taskInProj1 = await taskRepo1.create({ projectId: proj1Id, title: "Alpha Task" });
      const taskInProj2 = await taskRepo1.create({ projectId: proj2Id, title: "Beta Task" });

      // A. Cross-Project inside same workspace: VALID
      const crossProjDep = await depRepo1.create({
        blockingTaskId: taskInProj1.id,
        dependentTaskId: taskInProj2.id,
      });
      assert.ok(crossProjDep.id);

      const hydratedBeta = await taskRepo1.getById(taskInProj2.id);
      assert.deepEqual(hydratedBeta.dependencies, [taskInProj1.serial]);

      // B. Cross-Workspace (Task in WS 2): REJECTED
      // Create project in WS 2 and task in WS 2
      const projWs2Id = randomUUID();
      await db
        .insert(projects)
        .values({ id: projWs2Id, organizationId: org1Id, workspaceId: ws2Id, name: "Proj in WS 2" });
      const taskInWs2 = await taskRepo2.create({ projectId: projWs2Id, title: "WS 2 Task" });

      await assert.rejects(
        () =>
          depRepo1.create({
            blockingTaskId: taskInWs2.id,
            dependentTaskId: taskInProj1.id,
          }),
        (err: unknown) => err instanceof TenantResourceNotFoundError,
      );

      // C. Cross-Organization: REJECTED
      const wsOrg2Id = randomUUID();
      const projOrg2Id = randomUUID();
      await db
        .insert(workspaces)
        .values({ id: wsOrg2Id, organizationId: org2Id, name: "WS Org 2", slug: `ws-org2-${wsOrg2Id}` });
      await db
        .insert(projects)
        .values({ id: projOrg2Id, organizationId: org2Id, workspaceId: wsOrg2Id, name: "Proj Org 2" });
      const taskRepoOrg2 = createTasksRepository({ organizationId: org2Id, workspaceId: wsOrg2Id });
      const taskInOrg2 = await taskRepoOrg2.create({ projectId: projOrg2Id, title: "Org 2 Task" });

      await assert.rejects(
        () =>
          depRepo1.create({
            blockingTaskId: taskInOrg2.id,
            dependentTaskId: taskInProj1.id,
          }),
        (err: unknown) => err instanceof TenantResourceNotFoundError,
      );
    } finally {
      await db
        .delete(tasks)
        .where(eq(tasks.organizationId, org1Id))
        .catch(() => undefined);
      await db
        .delete(tasks)
        .where(eq(tasks.organizationId, org2Id))
        .catch(() => undefined);
      await db
        .delete(projects)
        .where(eq(projects.organizationId, org1Id))
        .catch(() => undefined);
      await db
        .delete(projects)
        .where(eq(projects.organizationId, org2Id))
        .catch(() => undefined);
      await db
        .delete(workspaces)
        .where(eq(workspaces.organizationId, org1Id))
        .catch(() => undefined);
      await db
        .delete(workspaces)
        .where(eq(workspaces.organizationId, org2Id))
        .catch(() => undefined);
      await db
        .delete(organizations)
        .where(eq(organizations.id, org1Id))
        .catch(() => undefined);
      await db
        .delete(organizations)
        .where(eq(organizations.id, org2Id))
        .catch(() => undefined);
    }
  });

  it("strictly prevents self-dependencies and multi-hop cycles through real database paths", async () => {
    const orgId = randomUUID();
    const wsId = randomUUID();
    const projId = randomUUID();

    try {
      await db.insert(organizations).values({ id: orgId, name: "Cycle Org", slug: `cycle-${orgId}` });
      await db.insert(workspaces).values({ id: wsId, organizationId: orgId, name: "Cycle WS", slug: `cycle-${wsId}` });
      await db.insert(projects).values({ id: projId, organizationId: orgId, workspaceId: wsId, name: "Cycle Proj" });

      const taskRepo = createTasksRepository({ organizationId: orgId, workspaceId: wsId });
      const depRepo = createTaskDependenciesRepository({ organizationId: orgId, workspaceId: wsId });

      const taskA = await taskRepo.create({ projectId: projId, title: "Task A" });
      const taskB = await taskRepo.create({ projectId: projId, title: "Task B" });
      const taskC = await taskRepo.create({ projectId: projId, title: "Task C" });
      const taskD = await taskRepo.create({ projectId: projId, title: "Task D" });

      // 1. Self dependency A -> A
      await assert.rejects(
        () => depRepo.create({ blockingTaskId: taskA.id, dependentTaskId: taskA.id }),
        (err: unknown) => err instanceof TenantConflictError && err.message === "A task cannot depend on itself",
      );

      // Build chain: A -> B -> C -> D
      await depRepo.create({ blockingTaskId: taskA.id, dependentTaskId: taskB.id });
      await depRepo.create({ blockingTaskId: taskB.id, dependentTaskId: taskC.id });
      await depRepo.create({ blockingTaskId: taskC.id, dependentTaskId: taskD.id });

      // 2. Direct 2-node cycle: B -> A
      await assert.rejects(
        () => depRepo.create({ blockingTaskId: taskB.id, dependentTaskId: taskA.id }),
        (err: unknown) => err instanceof TenantConflictError,
      );

      // 3. 3-node cycle: C -> A
      await assert.rejects(
        () => depRepo.create({ blockingTaskId: taskC.id, dependentTaskId: taskA.id }),
        (err: unknown) => err instanceof TenantConflictError,
      );

      // 4. 4-node cycle: D -> A
      await assert.rejects(
        () => depRepo.create({ blockingTaskId: taskD.id, dependentTaskId: taskA.id }),
        (err: unknown) => err instanceof TenantConflictError,
      );

      // 5. Diamond DAG is allowed: A -> C (already exists via A->B->C, but adding direct edge A->D is valid DAG)
      const diamondEdge = await depRepo.create({ blockingTaskId: taskA.id, dependentTaskId: taskD.id });
      assert.ok(diamondEdge.id);
    } finally {
      await db
        .delete(tasks)
        .where(eq(tasks.organizationId, orgId))
        .catch(() => undefined);
      await db
        .delete(projects)
        .where(eq(projects.organizationId, orgId))
        .catch(() => undefined);
      await db
        .delete(workspaces)
        .where(eq(workspaces.id, wsId))
        .catch(() => undefined);
      await db
        .delete(organizations)
        .where(eq(organizations.id, orgId))
        .catch(() => undefined);
    }
  });

  it("integrates with task create/update, enforces true no-op semantics, and preserves atomicity", async () => {
    const orgId = randomUUID();
    const wsId = randomUUID();
    const projId = randomUUID();

    try {
      await db.insert(organizations).values({ id: orgId, name: "Task Mut Org", slug: `task-mut-${orgId}` });
      await db
        .insert(workspaces)
        .values({ id: wsId, organizationId: orgId, name: "Task Mut WS", slug: `task-mut-${wsId}` });
      await db.insert(projects).values({ id: projId, organizationId: orgId, workspaceId: wsId, name: "Task Mut Proj" });

      const taskRepo = createTasksRepository({ organizationId: orgId, workspaceId: wsId });

      const taskPre1 = await taskRepo.create({ projectId: projId, title: "Predecessor 1" });
      const taskPre2 = await taskRepo.create({ projectId: projId, title: "Predecessor 2" });

      // 1. Create task with initial dependencies
      const taskMain = await taskRepo.create({
        projectId: projId,
        title: "Main Task with initial dependencies",
        dependencies: [taskPre1.serial],
      });

      assert.deepEqual(taskMain.dependencies, [taskPre1.serial]);
      assert.equal(taskMain.dependencyLinks?.length, 1);
      assert.equal(taskMain.dependencyLinks[0]!.blockingTaskId, taskPre1.id);

      // 2. Update dependencies to [taskPre1.serial, taskPre2.serial]
      const { task: taskUpdated } = await taskRepo.update(taskMain.id, {
        expectedVersion: taskMain.version,
        metadata: { dependencies: [taskPre1.serial, taskPre2.serial] },
      });

      assert.equal(taskUpdated.version, taskMain.version + 1);
      assert.deepEqual(taskUpdated.dependencies?.sort(), [taskPre1.serial, taskPre2.serial].sort());

      // 3. True NO-OP update: passing the exact same dependencies in different order
      const { before: noOpBefore, task: noOpTask } = await taskRepo.update(taskMain.id, {
        expectedVersion: taskUpdated.version,
        metadata: { dependencies: [taskPre2.serial, taskPre1.serial] },
      });

      assert.equal(noOpTask.version, taskUpdated.version, "Version must not increment on no-op dependency update");
      assert.equal(
        noOpTask.updatedAt.toISOString(),
        taskUpdated.updatedAt.toISOString(),
        "updatedAt must not change on no-op",
      );

      // 4. Failed update due to cycle leaves task and existing dependencies completely untouched
      await assert.rejects(
        () =>
          taskRepo.update(taskPre1.id, {
            expectedVersion: taskPre1.version,
            metadata: { dependencies: [taskMain.serial] }, // taskMain already depends on taskPre1 => cycle!
          }),
        (err: unknown) => err instanceof TenantConflictError,
      );

      const reloadedPre1 = await taskRepo.getById(taskPre1.id);
      assert.equal(reloadedPre1.version, taskPre1.version);
      assert.deepEqual(reloadedPre1.dependencies, []);

      // 5. Soft-deleting task automatically cleans up active dependency links
      await taskRepo.softDelete(taskPre2.id);

      const reloadedMain = await taskRepo.getById(taskMain.id);
      // Soft-deleted task is excluded from active dependencies
      assert.deepEqual(reloadedMain.dependencies, [taskPre1.serial]);
    } finally {
      await db
        .delete(tasks)
        .where(eq(tasks.organizationId, orgId))
        .catch(() => undefined);
      await db
        .delete(projects)
        .where(eq(projects.organizationId, orgId))
        .catch(() => undefined);
      await db
        .delete(workspaces)
        .where(eq(workspaces.id, wsId))
        .catch(() => undefined);
      await db
        .delete(organizations)
        .where(eq(organizations.id, orgId))
        .catch(() => undefined);
    }
  });

  it("synchronizes legacy dependency input and maintains relation constraints", async () => {
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
