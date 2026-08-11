"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Project } from "@/lib/types";
import {
  cancelSprint,
  completeSprint,
  createSprint,
  getSprint,
  listSprints,
  moveTaskToSprint,
  startSprint,
  updateSprint,
  type CompleteSprintDestination,
  type SprintFormInput,
  type SprintScope,
} from "./api";
import { sprintQueryKeys } from "./query-keys";

function scopeFor(project: Project | null | undefined, actorId?: string): SprintScope | null {
  if (!project?.organizationId || !project.workspaceId || !project.id) return null;
  return {
    organizationId: project.organizationId,
    workspaceId: project.workspaceId,
    projectId: project.id,
    actorId,
  };
}

export function useSprints(project: Project | null | undefined, actorId?: string) {
  const scope = scopeFor(project, actorId);
  return useQuery({
    queryKey: scope ? sprintQueryKeys.project(scope) : ["sprints", "unscoped"],
    queryFn: () => listSprints(scope!),
    enabled: Boolean(scope),
  });
}

export function useSprint(project: Project | null | undefined, sprintId: string, actorId?: string) {
  const scope = scopeFor(project, actorId);
  return useQuery({
    queryKey: scope ? sprintQueryKeys.detail(scope, sprintId) : ["sprints", "unscoped", sprintId],
    queryFn: () => getSprint(sprintId, scope!),
    enabled: Boolean(scope && sprintId),
  });
}

type OperationOptions = {
  onTasksChanged?: () => Promise<void>;
};

export function useSprintOperations(
  project: Project | null | undefined,
  actorId?: string,
  options: OperationOptions = {},
) {
  const queryClient = useQueryClient();
  const currentScope = () => {
    const scope = scopeFor(project, actorId);
    if (!scope) throw new Error("Missing Sprint project context");
    return scope;
  };
  const invalidateSprints = async (sprintId?: string) => {
    const scope = currentScope();
    await queryClient.invalidateQueries({ queryKey: sprintQueryKeys.project(scope) });
    if (sprintId) await queryClient.invalidateQueries({ queryKey: sprintQueryKeys.detail(scope, sprintId) });
  };
  const reconcileTasks = async () => {
    const scope = currentScope();
    await queryClient.invalidateQueries({ queryKey: sprintQueryKeys.tasks(scope) });
    await options.onTasksChanged?.();
  };

  const create = useMutation({
    mutationFn: (input: SprintFormInput) => createSprint(currentScope(), input),
    onSuccess: () => invalidateSprints(),
  });
  const update = useMutation({
    mutationFn: ({ sprintId, input }: { sprintId: string; input: SprintFormInput }) =>
      updateSprint(sprintId, currentScope(), input),
    onSuccess: (_, { sprintId }) => invalidateSprints(sprintId),
  });
  const start = useMutation({
    mutationFn: (sprintId: string) => startSprint(sprintId, currentScope()),
    onSuccess: (_, sprintId) => invalidateSprints(sprintId),
  });
  const complete = useMutation({
    mutationFn: ({ sprintId, destination }: { sprintId: string; destination: CompleteSprintDestination }) =>
      completeSprint(sprintId, destination, currentScope()),
    onSuccess: async (_, { sprintId }) => {
      await invalidateSprints(sprintId);
      await reconcileTasks();
    },
  });
  const cancel = useMutation({
    mutationFn: (sprintId: string) => cancelSprint(sprintId, currentScope()),
    onSuccess: async (_, sprintId) => {
      await invalidateSprints(sprintId);
      await reconcileTasks();
    },
  });
  const moveTask = useMutation({
    mutationFn: ({
      taskId,
      targetSprintId,
      expectedFromSprintId,
    }: {
      taskId: string;
      targetSprintId: string | null;
      expectedFromSprintId: string | null;
    }) => moveTaskToSprint(taskId, targetSprintId, expectedFromSprintId, currentScope()),
    onSuccess: async () => {
      await invalidateSprints();
      await reconcileTasks();
    },
  });

  return {
    create: create.mutateAsync,
    update: update.mutateAsync,
    start: start.mutateAsync,
    complete: complete.mutateAsync,
    cancel: cancel.mutateAsync,
    moveTask: moveTask.mutateAsync,
    pendingAction:
      create.isPending ||
      update.isPending ||
      start.isPending ||
      complete.isPending ||
      cancel.isPending ||
      moveTask.isPending,
  };
}
