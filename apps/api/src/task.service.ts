import {
  createCommentsRepository,
  createNotificationsRepository,
  createTaskWorkflowsRepository,
  createTasksRepository,
  dispatchWatcherNotifications,
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

function instantValue(value: Date | string | null | undefined): number | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

export function createTaskService(context: DatabaseTenantContext) {
  const tasksRepository = createTasksRepository(context);
  const workflowsRepository = createTaskWorkflowsRepository(context);

  return {
    async list(filters: TaskListFilters = {}) {
      return tasksRepository.list(filters);
    },
    async listPage(filters: Parameters<typeof tasksRepository.listPage>[0]) {
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
    async create(input: CreateTaskInput) {
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
            serial: task.serial,
            status: task.status,
            priority: task.priority,
            assigneeId: task.assigneeId,
            assigneeIds: task.assigneeIds,
          },
        });
      }
      const assignees =
        task.assigneeIds && task.assigneeIds.length > 0 ? task.assigneeIds : task.assigneeId ? [task.assigneeId] : [];
      if (assignees.length > 0) {
        await tasksRepository.createAssignmentNotifications(task, assignees, actorId);
      }
      return task;
    },
    async importTasks(inputs: CreateTaskInput[]) {
      const createTask = async (input: CreateTaskInput) => {
        const task = await tasksRepository.create(input);
        const assigneesToNotify =
          task.assigneeIds && task.assigneeIds.length > 0 ? task.assigneeIds : task.assigneeId ? [task.assigneeId] : [];
        if (assigneesToNotify.length > 0) {
          await tasksRepository.createAssignmentNotifications(task, assigneesToNotify, context.actorId);
        }
        return task;
      };
      const imported = [];
      for (const input of inputs) imported.push(await createTask(input));
      return imported;
    },
    async update(taskId: string, input: UpdateTaskInput) {
      const { before, task } = await tasksRepository.update(taskId, input);
      const actorId = context.actorId;
      const followersChanged =
        input.followerIds !== undefined &&
        JSON.stringify(before.followerIds ? [...before.followerIds].sort() : []) !==
          JSON.stringify(task.followerIds ? [...task.followerIds].sort() : []);

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
            ...(followersChanged ? { followerIds: before.followerIds } : {}),
          },
          newValues: {
            status: task.status,
            priority: task.priority,
            assigneeId: task.assigneeId,
            assigneeIds: task.assigneeIds,
            ...(followersChanged ? { followerIds: task.followerIds } : {}),
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

      const statusChanged = task.status !== before.status;
      const priorityChanged = task.priority !== before.priority;
      const scheduleChanged =
        instantValue(task.startDate) !== instantValue(before.startDate) ||
        instantValue(task.dueDate) !== instantValue(before.dueDate);
      const primaryChanged = (before.assigneeId ?? null) !== (task.assigneeId ?? null);
      const executionAssigneesChanged =
        beforeAssignees.length !== afterAssignees.length ||
        beforeAssignees.some((id) => !afterAssignees.includes(id)) ||
        afterAssignees.some((id) => !beforeAssignees.includes(id));
      const assigneesChanged = primaryChanged || executionAssigneesChanged;

      if (statusChanged || priorityChanged || scheduleChanged || assigneesChanged) {
        let event = "task_updated";
        let body = `تم تحديث المهمة ${task.serial}`;
        if (statusChanged) {
          event = "status_changed";
          body = `تم تغيير حالة المهمة إلى ${task.status}`;
        } else if (priorityChanged) {
          event = "priority_changed";
          body = `تم تغيير أولوية المهمة إلى ${task.priority}`;
        } else if (scheduleChanged) {
          event = "schedule_changed";
          body = `تم تحديث الموعد للمهمة ${task.serial}`;
        } else if (assigneesChanged) {
          event = "assignees_changed";
          body = `تم تحديث المكلفين بالمهمة ${task.serial}`;
        }

        try {
          await dispatchWatcherNotifications(context, {
            taskId: task.id,
            actorId,
            excludedUserIds: addedAssigneeIds,
            type: "task_watch_update",
            title: `تحديث في المهمة ${task.serial}`,
            body,
            deduplicationKeyTemplate: (watcherId) => `task-watch/${task.id}/${event}/v${task.version}/${watcherId}`,
            actionPath: `/?taskId=${encodeURIComponent(task.id)}`,
          });
        } catch (error) {
          console.error("Failed to dispatch task update watcher notifications:", error);
        }
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
      if (task.status !== before.status) {
        try {
          await dispatchWatcherNotifications(context, {
            taskId: task.id,
            actorId: context.actorId,
            type: "task_watch_update",
            title: `تحديث في المهمة ${task.serial}`,
            body: `تم تغيير حالة المهمة إلى ${task.status}`,
            deduplicationKeyTemplate: (watcherId) =>
              `task-watch/${task.id}/status_changed/v${task.version}/${watcherId}`,
            actionPath: `/?taskId=${encodeURIComponent(task.id)}`,
          });
        } catch (error) {
          console.error("Failed to dispatch task move watcher notifications:", error);
        }
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
