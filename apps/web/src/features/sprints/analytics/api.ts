import { requestJson, apiServiceUrl } from "@/lib/client-api";
import type { SprintScope } from "../api";

// Note: Ensure the API response is unwrapped from `{ ok: true, data: ... }` via the standard apiClient implementation.

export type SprintAnalyticsOverviewDTO = {
  averageVelocity: number | null;
  averageThroughput: number | null;
  completedSprints: number;
  latestVelocity: number | null;
  latestSprintSummary: SprintAnalyticsDTO | null;
};

export type VelocitySeriesDTO = {
  series: Array<{
    sprintId: string;
    name: string;
    completedAt: string | null;
    completedStoryPoints: number;
    completedTaskCount: number;
  }>;
  averageStoryPoints: number | null;
  sprintCount: number;
};

export type SprintAnalyticsDTO = {
  sprintId: string;
  name: string;
  dataQuality: "exact" | "reconstructed" | "partial";
  commitment: {
    storyPoints: number | null;
    taskCount: number | null;
  };
  finalScope: {
    storyPoints: number | null;
    taskCount: number;
  };
  completed: {
    storyPoints: number | null;
    taskCount: number;
  };
  remaining: {
    storyPoints: number | null;
    taskCount: number;
  };
  netScopeChange: {
    storyPoints: number | null;
    taskCount: number | null;
  };
  completionRatio: number | null;
};

export type SprintTimelineDTO = {
  sprintId: string;
  dataQuality: "exact" | "reconstructed";
  series: Array<{
    date: string; // YYYY-MM-DD string formatted in the requested timezone
    remainingPoints: number;
    completedPoints: number;
    totalScopePoints: number;
    idealRemainingPoints: number | null;
  }>;
};

export async function getProjectSprintAnalyticsOverview(
  projectId: string,
  scope: SprintScope,
): Promise<SprintAnalyticsOverviewDTO> {
  const qs = new URLSearchParams({
    organizationId: scope.organizationId,
    workspaceId: scope.workspaceId,
    ...(scope.actorId ? { actorId: scope.actorId } : {}),
  });
  const res = await requestJson<{ ok: boolean; data: SprintAnalyticsOverviewDTO }>(
    apiServiceUrl(`/api/projects/${projectId}/sprint-analytics/overview?${qs}`),
  );
  return res.data;
}

export async function getVelocitySeries(
  projectId: string,
  limit: number,
  scope: SprintScope,
): Promise<VelocitySeriesDTO> {
  const qs = new URLSearchParams({
    limit: String(limit),
    organizationId: scope.organizationId,
    workspaceId: scope.workspaceId,
    ...(scope.actorId ? { actorId: scope.actorId } : {}),
  });
  const res = await requestJson<{ ok: boolean; data: VelocitySeriesDTO }>(
    apiServiceUrl(`/api/projects/${projectId}/sprint-analytics/velocity?${qs}`),
  );
  return res.data;
}

export async function getSprintSummary(
  projectId: string,
  sprintId: string,
  scope: SprintScope,
): Promise<SprintAnalyticsDTO> {
  const qs = new URLSearchParams({
    organizationId: scope.organizationId,
    workspaceId: scope.workspaceId,
    ...(scope.actorId ? { actorId: scope.actorId } : {}),
  });
  const res = await requestJson<{ ok: boolean; data: SprintAnalyticsDTO }>(
    apiServiceUrl(`/api/projects/${projectId}/sprints/${sprintId}/analytics?${qs}`),
  );
  return res.data;
}

export async function getSprintTimeline(
  projectId: string,
  sprintId: string,
  timezone: string,
  scope: SprintScope,
): Promise<SprintTimelineDTO> {
  const qs = new URLSearchParams({
    timezone,
    organizationId: scope.organizationId,
    workspaceId: scope.workspaceId,
    ...(scope.actorId ? { actorId: scope.actorId } : {}),
  });
  const res = await requestJson<{ ok: boolean; data: SprintTimelineDTO }>(
    apiServiceUrl(`/api/projects/${projectId}/sprints/${sprintId}/analytics/timeline?${qs}`),
  );
  return res.data;
}
