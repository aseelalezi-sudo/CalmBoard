import type { SprintScope } from "../api";

export const sprintAnalyticsQueryKeys = {
  all: (scope: SprintScope) => ["sprint_analytics", scope.organizationId, scope.workspaceId] as const,
  project: (scope: SprintScope, projectId: string) => [...sprintAnalyticsQueryKeys.all(scope), projectId] as const,
  overview: (scope: SprintScope, projectId: string) =>
    [...sprintAnalyticsQueryKeys.project(scope, projectId), "overview"] as const,
  velocity: (scope: SprintScope, projectId: string, limit: number) =>
    [...sprintAnalyticsQueryKeys.project(scope, projectId), "velocity", limit] as const,
  sprint: (scope: SprintScope, projectId: string, sprintId: string) =>
    [...sprintAnalyticsQueryKeys.project(scope, projectId), "sprint", sprintId] as const,
  summary: (scope: SprintScope, projectId: string, sprintId: string) =>
    [...sprintAnalyticsQueryKeys.sprint(scope, projectId, sprintId), "summary"] as const,
  timeline: (scope: SprintScope, projectId: string, sprintId: string, timezone: string) =>
    [...sprintAnalyticsQueryKeys.sprint(scope, projectId, sprintId), "timeline", timezone] as const,
};
