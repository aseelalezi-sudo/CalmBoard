import {
  createCommentsRepository,
  createNotificationsRepository,
  createTaskWorkflowsRepository,
  createTasksRepository,
  type CreateTaskApprovalInput,
  type CreateTaskInput,
  type DatabaseTenantContext,
  type MoveTaskInput,
  type TaskListFilters,
  type TaskApprovalDecision,
  type TaskChecklistInput,
  type UpdateTaskInput,
} from "@calmboard/database";
import { logActivity } from "./automation-engine.js";
import { createAttachmentService } from "./attachment.service.js";

export function createTaskService(context: DatabaseTenantContext) {
  const tasksRepository = createTasksRepository(context);
  const workflowsRepository = createTaskWorkflowsRepository(context);

  async function createTask(input: CreateTaskInput) {
    const task = await tasksRepository.create(input);
    const actorId = context.actorId ?? input.reporterId ?? undefined;
    if (actorId) {
      await logActivity({
        organizationId: task.organizationId,
        workspaceId: task.workspaceId,
        actorId,
        action: "task.created",
        entityType: "task",
        entityId: task.id,
        newValues: {
          title: task.title,
          status: task.status,
          priority: task.priority,
          assigneeId: task.assigneeId,
          assigneeIds: task.assigneeIds,
        },
      });
    }
    if (task.assigneeIds && task.assigneeIds.length > 0) {
      await tasksRepository.createAssignmentNotifications(task, task.assigneeIds, actorId);
    }
    return task;
  }

  return {
    list(filters: TaskListFilters) {
      return tasksRepository.list(filters);
    },
    listPage(filters: TaskListFilters & { cursor?: string; limit: number }) {
      return tasksRepository.listPage(filters);
    },
    async getDetails(taskId: string) {
      const task = await tasksRepository.getById(taskId);
      const comments = await createCommentsRepository(context).listByTask(taskId);
      const attachments = await createAttachmentService(context).list({ taskId });
      const checklists = await workflowsRepository.listChecklists(taskId);
      const approvals = await workflowsRepository.listApprovals(taskId);
      return { task, comments, attachments, checklists, approvals };
    },
    create: createTask,
    async importTasks(inputs: CreateTaskInput[]) {
      const imported = [];
      for (const input of inputs) imported.push(await createTask(input));
      return imported;
    },
    async update(taskId: string, input: UpdateTaskInput) {
      const { before, task } = await tasksRepository.update(taskId, input);
      const actorId = context.actorId;
      if (actorId) {
        await logActivity({
          organizationId: task.organizationId,
          workspaceId: task.workspaceId,
          actorId,
          action: "task.updated",
          entityType: "task",
          entityId: task.id,
          oldValues: {
            status: before.status,
            priority: before.priority,
            assigneeId: before.assigneeId,
            assigneeIds: before.assigneeIds,
          },
          newValues: {
            status: task.status,
            priority: task.priority,
            assigneeId: task.assigneeId,
            assigneeIds: task.assigneeIds,
          },
        });
      }
      const beforeAssignees =
        before.assigneeIds && before.assigneeIds.length > 0
          ? before.assigneeIds
          : before.assigneeId
            ? [before.assigneeId]
            : [];
      const afterAssignees =
        task.assigneeIds && task.assigneeIds.length > 0 ? task.assigneeIds : task.assigneeId ? [task.assigneeId] : [];
      const addedAssigneeIds = afterAssignees.filter((id) => !beforeAssignees.includes(id));
      if (addedAssigneeIds.length > 0) {
        await tasksRepository.createAssignmentNotifications(task, addedAssigneeIds, actorId);
      }
      return task;
    },
    async move(taskId: string, input: MoveTaskInput) {
      const { before, task } = await tasksRepository.move(taskId, input);
      if (context.actorId) {
        await logActivity({
          organizationId: task.organizationId,
          workspaceId: task.workspaceId,
          actorId: context.actorId,
          action: "task.moved",
          entityType: "task",
          entityId: task.id,
          oldValues: { status: before.status, order: before.order },
          newValues: { status: task.status, order: task.order },
        });
      }
      return task;
    },
    async delete(taskId: string) {
      const task = await tasksRepository.softDelete(taskId);
      if (context.actorId) {
        await logActivity({
          organizationId: task.organizationId,
          workspaceId: task.workspaceId,
          actorId: context.actorId,
          action: "task.deleted",
          entityType: "task",
          entityId: task.id,
          oldValues: { title: task.title, serial: task.serial },
        });
      }
    },
    async replaceChecklists(taskId: string, inputs: TaskChecklistInput[]) {
      const result = await workflowsRepository.replaceChecklists(taskId, inputs);
      if (context.actorId) {
        await logActivity({
          organizationId: context.organizationId,
          workspaceId: context.workspaceId!,
          actorId: context.actorId,
          action: "task.checklists.replaced",
          entityType: "task",
          entityId: taskId,
          newValues: { checklistCount: inputs.length },
        });
      }
      return result;
    },
    async requestApproval(input: CreateTaskApprovalInput) {
      const request = await workflowsRepository.requestApproval(input);
      for (const reviewer of request.reviewers) {
        await createNotificationsRepository(context).create({
          userId: reviewer.reviewerId,
          type: "approval_requested",
          title: "طلب موافقة على مهمة",
          body: request.message,
          entityType: "task",
          entityId: request.taskId,
        });
      }
      if (context.actorId) {
        await logActivity({
          organizationId: context.organizationId,
          workspaceId: context.workspaceId!,
          actorId: context.actorId,
          action: "task.approval.requested",
          entityType: "task",
          entityId: input.taskId,
          newValues: { approvalRequestId: request.id, reviewerCount: request.reviewers.length },
        });
      }
      return request;
    },
    async decideApproval(approvalRequestId: string, decision: TaskApprovalDecision, comment?: string | null) {
      const result = await workflowsRepository.decideApproval(approvalRequestId, decision, comment);
      if (context.actorId) {
        await logActivity({
          organizationId: context.organizationId,
          workspaceId: context.workspaceId!,
          actorId: context.actorId,
          action: "task.approval.decided",
          entityType: "task_approval",
          entityId: approvalRequestId,
          newValues: { decision },
        });
      }
      return result;
    },
    async cancelApproval(approvalRequestId: string) {
      const result = await workflowsRepository.cancelApproval(approvalRequestId);
      if (context.actorId) {
        await logActivity({
          organizationId: context.organizationId,
          workspaceId: context.workspaceId!,
          actorId: context.actorId,
          action: "task.approval.canceled",
          entityType: "task_approval",
          entityId: approvalRequestId,
        });
      }
      return result;
    },
    async setChecklistItemCompletion(itemId: string, isCompleted: boolean) {
      const result = await workflowsRepository.setChecklistItemCompletion(itemId, isCompleted);
      if (context.actorId) {
        await logActivity({
          organizationId: context.organizationId,
          workspaceId: context.workspaceId!,
          actorId: context.actorId,
          action: "task.checklist_item.updated",
          entityType: "task_checklist_item",
          entityId: itemId,
          newValues: { isCompleted },
        });
      }
      return result;
    },
  };
}
