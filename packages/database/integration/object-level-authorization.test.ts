import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import {
  createCustomFieldsRepository,
  createNotificationsRepository,
  createProjectsRepository,
  createTasksRepository,
  db,
  memberships,
  organizations,
  pool,
  projectSections,
  projects,
  tasks,
  TenantConflictError,
  TenantResourceNotFoundError,
  users,
  workspaces,
} from "../src/index.js";

after(async () => {
  await pool.end();
});

describe("object-level authorization and tenant isolation (integration)", () => {
  it("enforces cross-organization, cross-workspace, project scope, custom field scope, and notification isolation", async () => {
    // Setup Tenant A: Org A, Workspace A1, Workspace A2, User A1 (owner), User A2 (member)
    const orgAId = randomUUID();
    const wsA1Id = randomUUID();
    const wsA2Id = randomUUID();
    const userA1Id = randomUUID();
    const userA2Id = randomUUID();

    // Setup Tenant B: Org B, Workspace B1, User B1 (owner)
    const orgBId = randomUUID();
    const wsB1Id = randomUUID();
    const userB1Id = randomUUID();

    try {
      // 1. Seed Users
      await db.insert(users).values([
        { id: userA1Id, email: `user-a1-${userA1Id.slice(0, 8)}@example.com`, name: "User A1" },
        { id: userA2Id, email: `user-a2-${userA2Id.slice(0, 8)}@example.com`, name: "User A2" },
        { id: userB1Id, email: `user-b1-${userB1Id.slice(0, 8)}@example.com`, name: "User B1" },
      ]);

      // 2. Seed Organizations
      await db.insert(organizations).values([
        { id: orgAId, name: "Tenant A Org", slug: `org-a-${orgAId.slice(0, 8)}` },
        { id: orgBId, name: "Tenant B Org", slug: `org-b-${orgBId.slice(0, 8)}` },
      ]);

      // 3. Seed Workspaces
      await db.insert(workspaces).values([
        { id: wsA1Id, organizationId: orgAId, name: "Workspace A1", slug: `ws-a1-${wsA1Id.slice(0, 8)}` },
        { id: wsA2Id, organizationId: orgAId, name: "Workspace A2", slug: `ws-a2-${wsA2Id.slice(0, 8)}` },
        { id: wsB1Id, organizationId: orgBId, name: "Workspace B1", slug: `ws-b1-${wsB1Id.slice(0, 8)}` },
      ]);

      // 4. Seed Memberships
      await db.insert(memberships).values([
        { organizationId: orgAId, workspaceId: wsA1Id, userId: userA1Id, role: "owner", status: "active" },
        { organizationId: orgAId, workspaceId: wsA1Id, userId: userA2Id, role: "member", status: "active" },
        { organizationId: orgAId, workspaceId: wsA2Id, userId: userA1Id, role: "owner", status: "active" },
        { organizationId: orgBId, workspaceId: wsB1Id, userId: userB1Id, role: "owner", status: "active" },
      ]);

      // Repositories for different tenant contexts
      const taskRepoA1 = createTasksRepository({ organizationId: orgAId, workspaceId: wsA1Id, actorId: userA1Id });
      const taskRepoA2 = createTasksRepository({ organizationId: orgAId, workspaceId: wsA2Id, actorId: userA1Id });
      const taskRepoB1 = createTasksRepository({ organizationId: orgBId, workspaceId: wsB1Id, actorId: userB1Id });

      const projectRepoA1 = createProjectsRepository({
        organizationId: orgAId,
        workspaceId: wsA1Id,
        actorId: userA1Id,
      });
      const projectRepoA2 = createProjectsRepository({
        organizationId: orgAId,
        workspaceId: wsA2Id,
        actorId: userA1Id,
      });
      const projectRepoB1 = createProjectsRepository({
        organizationId: orgBId,
        workspaceId: wsB1Id,
        actorId: userB1Id,
      });

      const customFieldsRepoA1 = createCustomFieldsRepository({
        organizationId: orgAId,
        workspaceId: wsA1Id,
        actorId: userA1Id,
      });

      const notifRepoA1User1 = createNotificationsRepository({
        organizationId: orgAId,
        workspaceId: wsA1Id,
        actorId: userA1Id,
      });
      const notifRepoA1User2 = createNotificationsRepository({
        organizationId: orgAId,
        workspaceId: wsA1Id,
        actorId: userA2Id,
      });

      // Create Projects in Workspace A1
      const projectA1 = await projectRepoA1.create({
        name: "Project A1",
        ownerId: userA1Id,
      });
      const projectA2 = await projectRepoA1.create({
        name: "Project A2",
        ownerId: userA1Id,
      });

      // Create Project in Workspace B1
      const projectB1 = await projectRepoB1.create({
        name: "Project B1",
        ownerId: userB1Id,
      });

      // Create Tasks
      const taskA1 = await taskRepoA1.create({
        projectId: projectA1.id,
        title: "Task in A1",
      });

      const taskB1 = await taskRepoB1.create({
        projectId: projectB1.id,
        title: "Task in B1",
      });

      // =========================================================================
      // A. CROSS-ORGANIZATION ISOLATION
      // =========================================================================
      // User in Org A attempts to access/mutate Org B resources with known IDs
      await assert.rejects(
        () => taskRepoA1.getById(taskB1.id),
        (err: unknown) => err instanceof TenantResourceNotFoundError && err.message.includes("task"),
        "Must reject reading task from another organization",
      );

      await assert.rejects(
        () => taskRepoA1.update(taskB1.id, { expectedVersion: 1, title: "Hacked title" }),
        (err: unknown) => err instanceof TenantResourceNotFoundError && err.message.includes("task"),
        "Must reject updating task from another organization",
      );

      await assert.rejects(
        () => taskRepoA1.softDelete(taskB1.id),
        (err: unknown) => err instanceof TenantResourceNotFoundError && err.message.includes("task"),
        "Must reject deleting task from another organization",
      );

      await assert.rejects(
        () => projectRepoA1.getById(projectB1.id),
        (err: unknown) => err instanceof TenantResourceNotFoundError && err.message.includes("project"),
        "Must reject getting project from another organization",
      );

      await assert.rejects(
        () => projectRepoA1.update(projectB1.id, projectB1.version, { name: "Hacked project" }),
        (err: unknown) => err instanceof TenantResourceNotFoundError && err.message.includes("project"),
        "Must reject updating project from another organization",
      );

      // =========================================================================
      // B. CROSS-WORKSPACE ISOLATION (Same Organization)
      // =========================================================================
      // User in Workspace A2 attempts to access Workspace A1 task/project using known IDs
      await assert.rejects(
        () => taskRepoA2.getById(taskA1.id),
        (err: unknown) => err instanceof TenantResourceNotFoundError && err.message.includes("task"),
        "Must reject reading task from another workspace in same org",
      );

      await assert.rejects(
        () => taskRepoA2.update(taskA1.id, { expectedVersion: taskA1.version, title: "Cross-ws title" }),
        (err: unknown) => err instanceof TenantResourceNotFoundError && err.message.includes("task"),
        "Must reject updating task from another workspace in same org",
      );

      await assert.rejects(
        () => taskRepoA2.softDelete(taskA1.id),
        (err: unknown) => err instanceof TenantResourceNotFoundError && err.message.includes("task"),
        "Must reject deleting task from another workspace in same org",
      );

      await assert.rejects(
        () => projectRepoA2.getById(projectA1.id),
        (err: unknown) => err instanceof TenantResourceNotFoundError && err.message.includes("project"),
        "Must reject getting project from another workspace in same org",
      );

      // =========================================================================
      // C. PARENT / SUBTASK & SECTION CROSS-PROJECT BOUNDARY
      // =========================================================================
      // Attempt to create subtask in Project A2 with parent in Project A1
      await assert.rejects(
        () =>
          taskRepoA1.create({
            projectId: projectA2.id,
            parentId: taskA1.id, // belongs to projectA1
            title: "Cross-project subtask",
          }),
        (err: unknown) => err instanceof TenantResourceNotFoundError && err.message.includes("parent task"),
        "Must reject parent task from different project",
      );

      // Section in Project A1
      const sectionA1Id = randomUUID();
      await db.insert(projectSections).values({
        id: sectionA1Id,
        organizationId: orgAId,
        workspaceId: wsA1Id,
        projectId: projectA1.id,
        name: "Section A1",
        order: 0,
      });

      // Attempt to create task in Project A2 using section from Project A1
      await assert.rejects(
        () =>
          taskRepoA1.create({
            projectId: projectA2.id,
            sectionId: sectionA1Id, // belongs to projectA1
            title: "Task in A2 with A1 section",
          }),
        (err: unknown) => err instanceof TenantResourceNotFoundError && err.message.includes("project section"),
        "Must reject project section from different project",
      );

      // =========================================================================
      // D. CUSTOM FIELDS PROJECT SCOPING
      // =========================================================================
      // Create custom field scoped specifically to Project A1
      const cfProjA1 = await customFieldsRepoA1.create({
        name: "Project A1 Field",
        key: "cf_proj_a1",
        type: "text",
        projectId: projectA1.id,
      });

      // 1. Attempt to create task in Project A2 with Project A1 custom field -> REJECTED
      await assert.rejects(
        () =>
          taskRepoA1.create({
            projectId: projectA2.id,
            title: "Task in A2 with A1 custom field",
            customFields: { [cfProjA1.key]: "Disallowed value" },
          }),
        (err: unknown) =>
          err instanceof TenantConflictError &&
          /Custom field 'cf_proj_a1' belongs to another project/.test(err.message),
        "Must reject creating task with custom field scoped to another project",
      );

      // 2. Attempt to update task in Project A2 with Project A1 custom field -> REJECTED
      const taskA2 = await taskRepoA1.create({
        projectId: projectA2.id,
        title: "Task in A2",
      });

      await assert.rejects(
        () =>
          taskRepoA1.update(taskA2.id, {
            expectedVersion: taskA2.version,
            customFields: { [cfProjA1.key]: "Disallowed update" },
          }),
        (err: unknown) =>
          err instanceof TenantConflictError &&
          /Custom field 'cf_proj_a1' belongs to another project/.test(err.message),
        "Must reject updating task with custom field scoped to another project",
      );

      // 3. Create task in Project A1 with Project A1 custom field -> SUCCESS
      const taskA1WithCF = await taskRepoA1.create({
        projectId: projectA1.id,
        title: "Task in A1 with A1 custom field",
        customFields: { [cfProjA1.key]: "Allowed project value" },
      });
      assert.equal(taskA1WithCF.customFields?.[cfProjA1.key], "Allowed project value");

      // 4. Create Workspace-wide Custom Field (projectId = null)
      const cfGlobal = await customFieldsRepoA1.create({
        name: "Workspace Field",
        key: "cf_global",
        type: "text",
        projectId: null,
      });

      // 5. Use workspace-wide custom field on task in Project A2 -> SUCCESS
      const taskA2WithGlobalCF = await taskRepoA1.create({
        projectId: projectA2.id,
        title: "Task in A2 with Global custom field",
        customFields: { [cfGlobal.key]: "Allowed workspace value" },
      });
      assert.equal(taskA2WithGlobalCF.customFields?.[cfGlobal.key], "Allowed workspace value");

      // =========================================================================
      // E. NOTIFICATIONS USER ISOLATION
      // =========================================================================
      // Create notification for User A2
      const notifForUser2 = await notifRepoA1User1.create({
        userId: userA2Id,
        type: "task_assigned",
        title: "You were assigned to task",
      });

      // User A1 attempts to mark User A2's notification read -> REJECTED
      await assert.rejects(
        () => notifRepoA1User1.markRead(notifForUser2.id, userA1Id),
        (err: unknown) => err instanceof TenantResourceNotFoundError && err.message.includes("notification"),
        "User A1 cannot mark User A2's notification as read",
      );

      // User A2 marks their own notification read -> SUCCESS
      const markedNotification = await notifRepoA1User2.markRead(notifForUser2.id, userA2Id);
      assert.equal(markedNotification.isRead, true);

      // =========================================================================
      // F. DELETED OBJECTS ACCESS SEMANTICS
      // =========================================================================
      // Soft-delete taskA1
      await taskRepoA1.softDelete(taskA1.id);

      // Regular getById on deleted task must throw TenantResourceNotFoundError
      await assert.rejects(
        () => taskRepoA1.getById(taskA1.id),
        (err: unknown) => err instanceof TenantResourceNotFoundError && err.message.includes("task"),
        "Deleted task cannot be accessed by standard details query",
      );

      // Regular update on deleted task must throw TenantResourceNotFoundError
      await assert.rejects(
        () => taskRepoA1.update(taskA1.id, { expectedVersion: taskA1.version, title: "Updated deleted task" }),
        (err: unknown) => err instanceof TenantResourceNotFoundError && err.message.includes("task"),
        "Deleted task cannot be updated",
      );

      // Control: Project A1 operations by authorized User A1 succeed
      const updatedProjectA1 = await projectRepoA1.update(projectA1.id, projectA1.version, {
        description: "Valid authorized update",
      });
      assert.equal(updatedProjectA1.description, "Valid authorized update");
    } finally {
      // Clean up test data
      await db
        .delete(tasks)
        .where(eq(tasks.organizationId, orgAId))
        .catch(() => undefined);
      await db
        .delete(tasks)
        .where(eq(tasks.organizationId, orgBId))
        .catch(() => undefined);
      await db
        .delete(projects)
        .where(eq(projects.organizationId, orgAId))
        .catch(() => undefined);
      await db
        .delete(projects)
        .where(eq(projects.organizationId, orgBId))
        .catch(() => undefined);
      await db
        .delete(workspaces)
        .where(eq(workspaces.organizationId, orgAId))
        .catch(() => undefined);
      await db
        .delete(workspaces)
        .where(eq(workspaces.organizationId, orgBId))
        .catch(() => undefined);
      await db
        .delete(organizations)
        .where(eq(organizations.id, orgAId))
        .catch(() => undefined);
      await db
        .delete(organizations)
        .where(eq(organizations.id, orgBId))
        .catch(() => undefined);
      await db
        .delete(users)
        .where(eq(users.id, userA1Id))
        .catch(() => undefined);
      await db
        .delete(users)
        .where(eq(users.id, userA2Id))
        .catch(() => undefined);
      await db
        .delete(users)
        .where(eq(users.id, userB1Id))
        .catch(() => undefined);
    }
  });
});
