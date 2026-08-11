import type { SprintScope } from "./api";

export const sprintQueryKeys = {
  project: (scope: SprintScope) =>
    [
      "organizations",
      scope.organizationId,
      "workspaces",
      scope.workspaceId,
      "projects",
      scope.projectId,
      "sprints",
    ] as const,
  detail: (scope: SprintScope, sprintId: string) => [...sprintQueryKeys.project(scope), sprintId] as const,
  tasks: (scope: SprintScope) =>
    [
      "organizations",
      scope.organizationId,
      "workspaces",
      scope.workspaceId,
      "projects",
      scope.projectId,
      "tasks",
    ] as const,
};
