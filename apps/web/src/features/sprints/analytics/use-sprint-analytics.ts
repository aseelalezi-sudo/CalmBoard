import { useQuery } from "@tanstack/react-query";
import type { Project } from "@/lib/types";
import { getProjectSprintAnalyticsOverview, getVelocitySeries, getSprintSummary, getSprintTimeline } from "./api";
import { sprintAnalyticsQueryKeys } from "./query-keys";
import type { SprintScope } from "../api";

function scopeFor(project: Project | null | undefined, actorId?: string): SprintScope | null {
  if (!project) return null;
  return {
    organizationId: project.organizationId,
    workspaceId: project.workspaceId,
    projectId: project.id,
    actorId,
  };
}

export function useSprintAnalyticsOverview(project: Project | null | undefined, actorId?: string) {
  const scope = scopeFor(project, actorId);
  return useQuery({
    queryKey: scope ? sprintAnalyticsQueryKeys.overview(scope, project!.id) : ["sprint_analytics", "unscoped_overview"],
    queryFn: () => getProjectSprintAnalyticsOverview(project!.id, scope!),
    enabled: Boolean(scope && project?.id),
    staleTime: 5 * 60 * 1000,
  });
}

export function useVelocitySeries(project: Project | null | undefined, limit: number, actorId?: string) {
  const scope = scopeFor(project, actorId);
  return useQuery({
    queryKey: scope
      ? sprintAnalyticsQueryKeys.velocity(scope, project!.id, limit)
      : ["sprint_analytics", "unscoped_velocity"],
    queryFn: () => getVelocitySeries(project!.id, limit, scope!),
    enabled: Boolean(scope && project?.id),
    staleTime: 5 * 60 * 1000,
  });
}

export function useSprintSummary(
  project: Project | null | undefined,
  sprintId: string | null | undefined,
  actorId?: string,
) {
  const scope = scopeFor(project, actorId);
  return useQuery({
    queryKey:
      scope && sprintId
        ? sprintAnalyticsQueryKeys.summary(scope, project!.id, sprintId)
        : ["sprint_analytics", "unscoped_summary"],
    queryFn: () => getSprintSummary(project!.id, sprintId!, scope!),
    enabled: Boolean(scope && project?.id && sprintId),
    staleTime: 5 * 60 * 1000,
  });
}

export function useSprintTimeline(
  project: Project | null | undefined,
  sprintId: string | null | undefined,
  timezone: string,
  actorId?: string,
) {
  const scope = scopeFor(project, actorId);
  return useQuery({
    queryKey:
      scope && sprintId
        ? sprintAnalyticsQueryKeys.timeline(scope, project!.id, sprintId, timezone)
        : ["sprint_analytics", "unscoped_timeline"],
    queryFn: () => getSprintTimeline(project!.id, sprintId!, timezone, scope!),
    enabled: Boolean(scope && project?.id && sprintId && timezone),
    staleTime: 5 * 60 * 1000,
  });
}
