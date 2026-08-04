import { and, asc, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "../client.js";
import { TenantConflictError, TenantPermissionDeniedError, TenantResourceNotFoundError } from "../errors.js";
import {
  memberships,
  taskApprovalRequests,
  taskApprovalReviewers,
  taskChecklistItems,
  taskChecklists,
  tasks,
  users,
} from "../schema.js";
import { assertWorkspaceTenantContext, type DatabaseTenantContext } from "../tenant-context.js";

export type TaskChecklistInput = {
  title: string;
  order?: number;
  items?: Array<{ title: string; order?: number; isCompleted?: boolean }>;
};

export type CreateTaskApprovalInput = {
  taskId: string;
  reviewerIds: string[];
  mode?: (typeof taskApprovalRequests.$inferInsert)["mode"];
  message?: string | null;
  dueAt?: Date | null;
};

export type TaskApprovalDecision = "approved" | "rejected";

export function createTaskWorkflowsRepository(context: DatabaseTenantContext) {
  assertWorkspaceTenantContext(context);
  const { organizationId, workspaceId, actorId } = context;
  const taskScope = and(
    eq(tasks.organizationId, organizationId),
    eq(tasks.workspaceId, workspaceId),
    isNull(tasks.deletedAt),
  )!;
  const checklistScope = and(
    eq(taskChecklists.organizationId, organizationId),
    eq(taskChecklists.workspaceId, workspaceId),
    isNull(taskChecklists.deletedAt),
  )!;
  const approvalScope = and(
    eq(taskApprovalRequests.organizationId, organizationId),
    eq(taskApprovalRequests.workspaceId, workspaceId),
    isNull(taskApprovalRequests.deletedAt),
  )!;

  async function requireTask(taskId: string) {
    const [task] = await db
      .select({ id: tasks.id, projectId: tasks.projectId })
      .from(tasks)
      .where(and(eq(tasks.id, taskId), taskScope))
      .limit(1);
    if (!task) throw new TenantResourceNotFoundError("task");
    return task;
  }

  async function listChecklists(taskId: string) {
    await requireTask(taskId);
    const checklists = await db
      .select()
      .from(taskChecklists)
      .where(and(eq(taskChecklists.taskId, taskId), checklistScope))
      .orderBy(asc(taskChecklists.order), asc(taskChecklists.createdAt));
    const items = checklists.length
      ? await db
          .select()
          .from(taskChecklistItems)
          .where(
            and(
              eq(taskChecklistItems.organizationId, organizationId),
              eq(taskChecklistItems.workspaceId, workspaceId),
              inArray(
                taskChecklistItems.checklistId,
                checklists.map((checklist) => checklist.id),
              ),
              isNull(taskChecklistItems.deletedAt),
            ),
          )
          .orderBy(asc(taskChecklistItems.order), asc(taskChecklistItems.createdAt))
      : [];
    const itemsByChecklist = new Map<string, typeof items>();
    for (const item of items) {
      const rows = itemsByChecklist.get(item.checklistId) ?? [];
      rows.push(item);
      itemsByChecklist.set(item.checklistId, rows);
    }
    return checklists.map((checklist) => {
      const checklistItems = itemsByChecklist.get(checklist.id) ?? [];
      return {
        ...checklist,
        items: checklistItems,
        completedItems: checklistItems.filter((item) => item.isCompleted).length,
        totalItems: checklistItems.length,
      };
    });
  }

  async function listApprovals(taskId: string) {
    await requireTask(taskId);
    const requests = await db
      .select()
      .from(taskApprovalRequests)
      .where(and(eq(taskApprovalRequests.taskId, taskId), approvalScope))
      .orderBy(desc(taskApprovalRequests.createdAt));
    const reviewerRows = requests.length
      ? await db
          .select({ reviewer: taskApprovalReviewers, user: users })
          .from(taskApprovalReviewers)
          .innerJoin(users, eq(users.id, taskApprovalReviewers.reviewerId))
          .where(
            and(
              eq(taskApprovalReviewers.organizationId, organizationId),
              eq(taskApprovalReviewers.workspaceId, workspaceId),
              inArray(
                taskApprovalReviewers.approvalRequestId,
                requests.map((request) => request.id),
              ),
              isNull(taskApprovalReviewers.deletedAt),
            ),
          )
          .orderBy(asc(taskApprovalReviewers.sequence))
      : [];
    const reviewersByRequest = new Map<string, typeof reviewerRows>();
    for (const reviewer of reviewerRows) {
      const rows = reviewersByRequest.get(reviewer.reviewer.approvalRequestId) ?? [];
      rows.push(reviewer);
      reviewersByRequest.set(reviewer.reviewer.approvalRequestId, rows);
    }
    return requests.map((request) => ({
      ...request,
      reviewers: (reviewersByRequest.get(request.id) ?? []).map(({ reviewer, user }) => ({
        ...reviewer,
        user,
      })),
    }));
  }

  function validateChecklists(inputs: TaskChecklistInput[]) {
    if (inputs.length > 20) throw new TenantConflictError("A task cannot contain more than 20 checklists");
    let itemCount = 0;
    for (const checklist of inputs) {
      if (!checklist.title.trim() || checklist.title.trim().length > 255) {
        throw new TenantConflictError("Task checklist title is invalid");
      }
      itemCount += checklist.items?.length ?? 0;
      for (const item of checklist.items ?? []) {
        if (!item.title.trim() || item.title.trim().length > 500) {
          throw new TenantConflictError("Task checklist item title is invalid");
        }
      }
    }
    if (itemCount > 200) throw new TenantConflictError("A task cannot contain more than 200 checklist items");
  }

  async function requireActiveMembers(userIds: string[]) {
    const uniqueIds = [...new Set(userIds)];
    const rows = await db
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(
        and(
          eq(memberships.organizationId, organizationId),
          eq(memberships.status, "active"),
          inArray(memberships.userId, uniqueIds),
          or(isNull(memberships.workspaceId), eq(memberships.workspaceId, workspaceId)),
        ),
      );
    if (new Set(rows.map((row) => row.userId)).size !== uniqueIds.length) {
      throw new TenantResourceNotFoundError("approval reviewer");
    }
    return uniqueIds;
  }

  return {
    listChecklists,
    listApprovals,

    async replaceChecklists(taskId: string, inputs: TaskChecklistInput[]) {
      const task = await requireTask(taskId);
      validateChecklists(inputs);
      await db.transaction(async (transaction) => {
        const now = new Date();
        await transaction
          .update(taskChecklists)
          .set({ deletedAt: now, updatedAt: now })
          .where(and(eq(taskChecklists.taskId, taskId), checklistScope));

        for (const [checklistIndex, input] of inputs.entries()) {
          const [checklist] = await transaction
            .insert(taskChecklists)
            .values({
              organizationId,
              workspaceId,
              projectId: task.projectId,
              taskId,
              title: input.title.trim(),
              order: input.order ?? checklistIndex,
              createdBy: actorId ?? null,
            })
            .returning({ id: taskChecklists.id });
          if (input.items?.length) {
            await transaction.insert(taskChecklistItems).values(
              input.items.map((item, itemIndex) => ({
                organizationId,
                workspaceId,
                projectId: task.projectId,
                taskId,
                checklistId: checklist.id,
                title: item.title.trim(),
                order: item.order ?? itemIndex,
                isCompleted: item.isCompleted ?? false,
                completedBy: item.isCompleted ? (actorId ?? null) : null,
                completedAt: item.isCompleted ? now : null,
                createdBy: actorId ?? null,
              })),
            );
          }
        }
      });
      return listChecklists(taskId);
    },

    async setChecklistItemCompletion(itemId: string, isCompleted: boolean) {
      const [item] = await db
        .update(taskChecklistItems)
        .set({
          isCompleted,
          completedBy: isCompleted ? (actorId ?? null) : null,
          completedAt: isCompleted ? new Date() : null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(taskChecklistItems.id, itemId),
            eq(taskChecklistItems.organizationId, organizationId),
            eq(taskChecklistItems.workspaceId, workspaceId),
            isNull(taskChecklistItems.deletedAt),
          ),
        )
        .returning();
      if (!item) throw new TenantResourceNotFoundError("checklist item");
      return item;
    },

    async requestApproval(input: CreateTaskApprovalInput) {
      if (!actorId) throw new TenantPermissionDeniedError("An actor is required to request task approval");
      if (!input.reviewerIds.length || input.reviewerIds.length > 20) {
        throw new TenantConflictError("Task approval requires between 1 and 20 reviewers");
      }
      const task = await requireTask(input.taskId);
      await requireActiveMembers([actorId]);
      const reviewerIds = await requireActiveMembers(input.reviewerIds);
      try {
        const requestId = await db.transaction(async (transaction) => {
          const [request] = await transaction
            .insert(taskApprovalRequests)
            .values({
              organizationId,
              workspaceId,
              projectId: task.projectId,
              taskId: input.taskId,
              requestedBy: actorId,
              mode: input.mode ?? "all",
              message: input.message?.trim() || null,
              dueAt: input.dueAt ?? null,
            })
            .returning({ id: taskApprovalRequests.id });
          await transaction.insert(taskApprovalReviewers).values(
            reviewerIds.map((reviewerId, sequence) => ({
              organizationId,
              workspaceId,
              projectId: task.projectId,
              taskId: input.taskId,
              approvalRequestId: request.id,
              reviewerId,
              sequence,
            })),
          );
          return request.id;
        });
        return (await listApprovals(input.taskId)).find((request) => request.id === requestId)!;
      } catch (error) {
        if ((error as { cause?: { code?: string } }).cause?.code === "23505") {
          throw new TenantConflictError("Task already has a pending approval request");
        }
        throw error;
      }
    },

    async decideApproval(approvalRequestId: string, decision: TaskApprovalDecision, comment?: string | null) {
      if (!actorId) throw new TenantPermissionDeniedError("An actor is required to decide task approval");
      const [reviewer] = await db
        .select({ id: taskApprovalReviewers.id, taskId: taskApprovalReviewers.taskId })
        .from(taskApprovalReviewers)
        .innerJoin(taskApprovalRequests, eq(taskApprovalRequests.id, taskApprovalReviewers.approvalRequestId))
        .where(
          and(
            eq(taskApprovalReviewers.approvalRequestId, approvalRequestId),
            eq(taskApprovalReviewers.reviewerId, actorId),
            eq(taskApprovalReviewers.status, "pending"),
            eq(taskApprovalReviewers.organizationId, organizationId),
            eq(taskApprovalReviewers.workspaceId, workspaceId),
            isNull(taskApprovalReviewers.deletedAt),
            eq(taskApprovalRequests.status, "pending"),
            approvalScope,
          ),
        )
        .limit(1);
      if (!reviewer) throw new TenantResourceNotFoundError("pending approval review");
      try {
        await db
          .update(taskApprovalReviewers)
          .set({ status: decision, comment: comment?.trim() || null, decidedAt: new Date(), updatedAt: new Date() })
          .where(eq(taskApprovalReviewers.id, reviewer.id));
      } catch (error) {
        const message = (error as { cause?: { message?: string } }).cause?.message;
        if (message?.startsWith("Task approval")) throw new TenantConflictError(message);
        throw error;
      }
      return (await listApprovals(reviewer.taskId)).find((request) => request.id === approvalRequestId)!;
    },

    async cancelApproval(approvalRequestId: string) {
      if (!actorId) throw new TenantPermissionDeniedError("An actor is required to cancel task approval");
      const now = new Date();
      const [request] = await db
        .update(taskApprovalRequests)
        .set({ status: "canceled", resolvedAt: now, updatedAt: now })
        .where(
          and(
            eq(taskApprovalRequests.id, approvalRequestId),
            eq(taskApprovalRequests.requestedBy, actorId),
            eq(taskApprovalRequests.status, "pending"),
            approvalScope,
          ),
        )
        .returning();
      if (!request) throw new TenantResourceNotFoundError("pending approval request");
      return request;
    },
  };
}
