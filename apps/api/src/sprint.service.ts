import { BadRequestException } from "@nestjs/common";
import {
  createSprintRepository,
  type CreateSprintInput,
  type DatabaseTenantContext,
  type UpdateSprintInput,
} from "@calmboard/database";
import { logActivity } from "./automation-engine.js";

export function createSprintService(context: DatabaseTenantContext) {
  const sprintsRepository = createSprintRepository(context);

  async function createSprint(input: CreateSprintInput) {
    const sprint = await sprintsRepository.createSprint(input);
    const actorId = context.actorId;
    if (actorId) {
      await logActivity({
        organizationId: sprint.organizationId,
        workspaceId: sprint.workspaceId,
        actorId,
        action: "sprint.created",
        entityType: "sprint",
        entityId: sprint.id,
        newValues: { name: sprint.name, status: sprint.status },
      });
    }
    return sprint;
  }

  async function getSprint(id: string) {
    return sprintsRepository.getSprint(id);
  }

  async function listSprints(projectId: string) {
    return sprintsRepository.listSprints(projectId);
  }

  async function updateSprint(id: string, input: UpdateSprintInput, projectId: string) {
    const sprint = await sprintsRepository.getSprint(id);
    if (!sprint || sprint.projectId !== projectId) throw new BadRequestException("Sprint not found");

    if (sprint.status === "completed" || sprint.status === "cancelled") {
      if ("startsAt" in input || "endsAt" in input) {
        throw new BadRequestException("Cannot edit dates on a completed or cancelled sprint");
      }
    }

    const updated = await sprintsRepository.updateSprint(id, input);
    const actorId = context.actorId;
    if (updated && actorId) {
      await logActivity({
        organizationId: updated.organizationId,
        workspaceId: updated.workspaceId,
        actorId,
        action: "sprint.updated",
        entityType: "sprint",
        entityId: updated.id,
        newValues: { name: updated.name },
      });
    }
    return updated;
  }

  async function startSprint(id: string, projectId: string) {
    const sprint = await sprintsRepository.startSprint(id, projectId);
    const actorId = context.actorId;
    if (actorId) {
      await logActivity({
        organizationId: sprint.organizationId,
        workspaceId: sprint.workspaceId,
        actorId,
        action: "sprint.started",
        entityType: "sprint",
        entityId: sprint.id,
        newValues: { status: sprint.status },
      });
    }
    return sprint;
  }

  async function completeSprint(
    id: string,
    projectId: string,
    destination: { type: "backlog" } | { type: "sprint"; sprintId: string },
  ) {
    const sprint = await sprintsRepository.completeSprint(id, projectId, destination);
    const actorId = context.actorId;
    if (actorId) {
      await logActivity({
        organizationId: sprint.organizationId,
        workspaceId: sprint.workspaceId,
        actorId,
        action: "sprint.completed",
        entityType: "sprint",
        entityId: sprint.id,
        newValues: { status: sprint.status },
      });
    }
    return sprint;
  }

  async function cancelSprint(id: string, projectId: string) {
    const sprint = await sprintsRepository.cancelSprint(id, projectId);
    const actorId = context.actorId;
    if (actorId) {
      await logActivity({
        organizationId: sprint.organizationId,
        workspaceId: sprint.workspaceId,
        actorId,
        action: "sprint.cancelled",
        entityType: "sprint",
        entityId: sprint.id,
        newValues: { status: sprint.status },
      });
    }
    return sprint;
  }

  async function assignTaskToSprint(taskId: string, sprintId: string) {
    await sprintsRepository.assignTaskToSprint(taskId, sprintId);
    const actorId = context.actorId;
    if (actorId) {
      await logActivity({
        organizationId: context.organizationId,
        workspaceId: context.workspaceId as string,
        actorId,
        action: "task.sprint_assigned",
        entityType: "task",
        entityId: taskId,
        newValues: { sprintId },
      });
    }
  }

  async function removeTaskFromSprint(taskId: string) {
    await sprintsRepository.removeTaskFromSprint(taskId);
    const actorId = context.actorId;
    if (actorId) {
      await logActivity({
        organizationId: context.organizationId,
        workspaceId: context.workspaceId as string,
        actorId,
        action: "task.sprint_removed",
        entityType: "task",
        entityId: taskId,
        newValues: { sprintId: null },
      });
    }
  }

  async function moveTaskBetweenSprints(
    taskId: string,
    targetSprintId: string | null,
    expectedFromSprintId?: string | null,
  ) {
    await sprintsRepository.moveTaskBetweenSprints(taskId, targetSprintId, expectedFromSprintId);
    const actorId = context.actorId;
    if (actorId) {
      await logActivity({
        organizationId: context.organizationId,
        workspaceId: context.workspaceId as string,
        actorId,
        action: targetSprintId ? "task.sprint_moved" : "task.sprint_removed",
        entityType: "task",
        entityId: taskId,
        newValues: { sprintId: targetSprintId },
      });
    }
  }

  return {
    createSprint,
    getSprint,
    listSprints,
    updateSprint,
    startSprint,
    completeSprint,
    cancelSprint,
    assignTaskToSprint,
    removeTaskFromSprint,
    moveTaskBetweenSprints,
  };
}
