import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  createTaskWorkflowsRepository,
  createTasksRepository,
  db,
  memberships,
  organizations,
  pool,
  projects,
  taskApprovalRequests,
  taskChecklists,
  tasks,
  TenantConflictError,
  users,
  workspaces,
} from "../src/index";

after(async () => {
  await pool.end();
});

describe("task checklists and approvals", () => {
  it("enforces checklist scope and multi-reviewer approval lifecycle", async () => {
    const organizationId = randomUUID();
    const workspaceId = randomUUID();
    const projectId = randomUUID();
    const otherWorkspaceId = randomUUID();
    const otherProjectId = randomUUID();
    const requesterId = randomUUID();
    const firstReviewerId = randomUUID();
    const secondReviewerId = randomUUID();

    try {
      await db.insert(users).values([
        { id: requesterId, email: `requester-${requesterId}@example.test`, name: "Requester" },
        { id: firstReviewerId, email: `reviewer-${firstReviewerId}@example.test`, name: "First reviewer" },
        { id: secondReviewerId, email: `reviewer-${secondReviewerId}@example.test`, name: "Second reviewer" },
      ]);
      await db.insert(organizations).values({
        id: organizationId,
        name: "Task workflow tenant",
        slug: `task-workflow-${organizationId}`,
      });
      await db.insert(workspaces).values([
        { id: workspaceId, organizationId, name: "Workflow workspace", slug: `workflow-${workspaceId}` },
        {
          id: otherWorkspaceId,
          organizationId,
          name: "Other workflow workspace",
          slug: `workflow-${otherWorkspaceId}`,
        },
      ]);
      await db
        .insert(memberships)
        .values([requesterId, firstReviewerId, secondReviewerId].map((userId) => ({ userId, organizationId })));
      await db.insert(projects).values([
        { id: projectId, organizationId, workspaceId, name: "Workflow project" },
        { id: otherProjectId, organizationId, workspaceId: otherWorkspaceId, name: "Other workflow project" },
      ]);

      const taskRepository = createTasksRepository({ organizationId, workspaceId, actorId: requesterId });
      const otherTaskRepository = createTasksRepository({
        organizationId,
        workspaceId: otherWorkspaceId,
        actorId: requesterId,
      });
      const task = await taskRepository.create({ projectId, title: "Release candidate" });
      const otherTask = await otherTaskRepository.create({ projectId: otherProjectId, title: "Other workspace task" });
      const requesterWorkflows = createTaskWorkflowsRepository({ organizationId, workspaceId, actorId: requesterId });

      const [checklist] = await requesterWorkflows.replaceChecklists(task.id, [
        {
          title: "Release readiness",
          items: [{ title: "Tests pass" }, { title: "Documentation updated", isCompleted: true }],
        },
      ]);
      assert.equal(checklist.totalItems, 2);
      assert.equal(checklist.completedItems, 1);
      const firstItem = checklist.items[0]!;
      await createTaskWorkflowsRepository({
        organizationId,
        workspaceId,
        actorId: firstReviewerId,
      }).setChecklistItemCompletion(firstItem.id, true);
      assert.equal((await requesterWorkflows.listChecklists(task.id))[0]?.completedItems, 2);

      await assert.rejects(
        () =>
          db.insert(taskChecklists).values({
            organizationId,
            workspaceId,
            projectId,
            taskId: otherTask.id,
            title: "Cross-workspace checklist",
          }),
        (error: unknown) =>
          (error as { cause?: { message?: string } }).cause?.message ===
          "Task workflow does not belong to the task tenant and project scope",
      );

      const sequential = await requesterWorkflows.requestApproval({
        taskId: task.id,
        reviewerIds: [firstReviewerId, secondReviewerId],
        mode: "sequential",
      });
      await assert.rejects(
        () =>
          createTaskWorkflowsRepository({ organizationId, workspaceId, actorId: secondReviewerId }).decideApproval(
            sequential.id,
            "approved",
          ),
        (error: unknown) => error instanceof TenantConflictError,
      );
      const firstDecision = await createTaskWorkflowsRepository({
        organizationId,
        workspaceId,
        actorId: firstReviewerId,
      }).decideApproval(sequential.id, "approved", "Ready");
      assert.equal(firstDecision.status, "pending");
      const rejected = await createTaskWorkflowsRepository({
        organizationId,
        workspaceId,
        actorId: secondReviewerId,
      }).decideApproval(sequential.id, "rejected", "Needs changes");
      assert.equal(rejected.status, "rejected");

      const anyRequest = await requesterWorkflows.requestApproval({
        taskId: task.id,
        reviewerIds: [firstReviewerId, secondReviewerId],
        mode: "any",
      });
      const approved = await createTaskWorkflowsRepository({
        organizationId,
        workspaceId,
        actorId: secondReviewerId,
      }).decideApproval(anyRequest.id, "approved");
      assert.equal(approved.status, "approved");
      assert.equal(approved.reviewers.find((reviewer) => reviewer.reviewerId === firstReviewerId)?.status, "skipped");

      await requesterWorkflows.requestApproval({ taskId: task.id, reviewerIds: [firstReviewerId] });
      await assert.rejects(
        () => requesterWorkflows.requestApproval({ taskId: task.id, reviewerIds: [secondReviewerId] }),
        (error: unknown) => error instanceof TenantConflictError,
      );

      await taskRepository.softDelete(task.id);
      const activeChecklists = await db
        .select({ id: taskChecklists.id })
        .from(taskChecklists)
        .where(and(eq(taskChecklists.taskId, task.id), isNull(taskChecklists.deletedAt)));
      const pendingApprovals = await db
        .select({ id: taskApprovalRequests.id })
        .from(taskApprovalRequests)
        .where(and(eq(taskApprovalRequests.taskId, task.id), eq(taskApprovalRequests.status, "pending")));
      assert.equal(activeChecklists.length, 0);
      assert.equal(pendingApprovals.length, 0);
    } finally {
      await db
        .delete(tasks)
        .where(eq(tasks.organizationId, organizationId))
        .catch(() => undefined);
      await db
        .delete(projects)
        .where(eq(projects.organizationId, organizationId))
        .catch(() => undefined);
      await db
        .delete(memberships)
        .where(eq(memberships.organizationId, organizationId))
        .catch(() => undefined);
      await db
        .delete(workspaces)
        .where(eq(workspaces.organizationId, organizationId))
        .catch(() => undefined);
      await db
        .delete(organizations)
        .where(eq(organizations.id, organizationId))
        .catch(() => undefined);
      await db
        .delete(users)
        .where(inArray(users.id, [requesterId, firstReviewerId, secondReviewerId]))
        .catch(() => undefined);
    }
  });
});
