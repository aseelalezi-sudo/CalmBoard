import { requestJson, apiServiceUrl } from "@/lib/client-api";
import type { SprintScope } from "../api";

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
  dataQuality: "exact" | "reconstructed" | null;
  availability?: { timeline: boolean };
  isFinalized?: boolean;
  series: Array<{
    date: string;
    remainingPoints: number;
    completedPoints: number;
    totalScopePoints: number;
    idealRemainingPoints: number | null;
  }>;
};

export function isAnalyticsIntegrityError(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    "status" in error &&
    (error as { status?: number }).status === 500 &&
    "payload" in error &&
    (error as { payload?: { code?: string } }).payload?.code === "ANALYTICS_INTEGRITY_ERROR",
  );
}

export function normalizeSprintTimeline(raw: unknown, sprintId: string): SprintTimelineDTO {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  if (!obj) {
    return {
      sprintId,
      dataQuality: null,
      availability: { timeline: false },
      isFinalized: false,
      series: [],
    };
  }

  const availability =
    typeof obj.availability === "object" && obj.availability !== null
      ? (obj.availability as { timeline: boolean })
      : { timeline: true };
  const isFinalized = Boolean(obj.isFinalized);
  const dataQuality =
    availability.timeline === false ? null : ((obj.dataQuality as SprintTimelineDTO["dataQuality"]) ?? "exact");

  const series: SprintTimelineDTO["series"] = [];
  if (Array.isArray(obj.series)) {
    for (const point of obj.series) {
      if (!point || typeof point !== "object" || typeof point.date !== "string") continue;
      const remainingPoints = Number(point.remainingPoints ?? point.remainingStoryPoints);
      const completedPoints = Number(point.completedPoints ?? point.completedStoryPoints ?? 0);
      const totalScopePoints = Number(point.totalScopePoints ?? point.scopeStoryPoints);
      if (isNaN(remainingPoints) || isNaN(totalScopePoints)) continue;
      const idealRemainingPoints =
        point.idealRemainingPoints != null && !isNaN(Number(point.idealRemainingPoints))
          ? Number(point.idealRemainingPoints)
          : null;

      series.push({
        date: point.date,
        remainingPoints: Math.max(0, remainingPoints),
        completedPoints: Math.max(0, completedPoints),
        totalScopePoints: Math.max(0, totalScopePoints),
        idealRemainingPoints,
      });
    }
  }

  return {
    sprintId,
    dataQuality,
    availability,
    isFinalized,
    series,
  };
}

export function normalizeSprintAnalyticsOverview(raw: unknown): SprintAnalyticsOverviewDTO {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  if (!obj) {
    return {
      averageVelocity: null,
      averageThroughput: null,
      completedSprints: 0,
      latestVelocity: null,
      latestSprintSummary: null,
    };
  }
  const num = (v: unknown) => (v != null && !isNaN(Number(v)) ? Number(v) : null);
  return {
    averageVelocity: num(obj.averageVelocity),
    averageThroughput: num(obj.averageThroughput),
    completedSprints: num(obj.completedSprints) ?? 0,
    latestVelocity: num(obj.latestVelocity),
    latestSprintSummary: obj.latestSprintSummary ? normalizeSprintAnalytics(obj.latestSprintSummary) : null,
  };
}

export function normalizeVelocitySeries(raw: unknown): VelocitySeriesDTO {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  if (!obj) {
    return {
      series: [],
      averageStoryPoints: null,
      sprintCount: 0,
    };
  }
  const num = (v: unknown) => (v != null && !isNaN(Number(v)) ? Number(v) : null);
  const series: VelocitySeriesDTO["series"] = [];
  if (Array.isArray(obj.series)) {
    for (const row of obj.series) {
      if (!row || typeof row !== "object" || typeof row.sprintId !== "string") continue;
      const completedAt =
        typeof row.completedAt === "string" && !isNaN(Date.parse(row.completedAt)) ? row.completedAt : null;
      const completedStoryPoints = Math.max(0, num(row.completedStoryPoints) ?? 0);
      const completedTaskCount = Math.max(0, num(row.completedTaskCount) ?? 0);
      series.push({
        sprintId: row.sprintId,
        name: String(row.name ?? ""),
        completedAt,
        completedStoryPoints,
        completedTaskCount,
      });
    }
  }
  return {
    series,
    averageStoryPoints: num(obj.averageStoryPoints),
    sprintCount: series.length,
  };
}

export function normalizeSprintAnalytics(raw: unknown): SprintAnalyticsDTO | null {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  if (!obj) return null;
  const num = (v: unknown) => (v != null && !isNaN(Number(v)) ? Number(v) : null);
  const count = (v: unknown) => Math.max(0, num(v) ?? 0);

  let completionRatio: number | null = num(obj.completionRatio);
  if (completionRatio !== null) {
    completionRatio = Math.max(0, Math.min(1, completionRatio));
  }

  const commitment = (obj.commitment ?? {}) as Record<string, unknown>;
  const finalScope = (obj.finalScope ?? {}) as Record<string, unknown>;
  const completed = (obj.completed ?? {}) as Record<string, unknown>;
  const remaining = (obj.remaining ?? {}) as Record<string, unknown>;
  const netScopeChange = (obj.netScopeChange ?? {}) as Record<string, unknown>;

  return {
    sprintId: String(obj.sprintId ?? ""),
    name: String(obj.name ?? ""),
    dataQuality: (obj.dataQuality as SprintAnalyticsDTO["dataQuality"]) ?? "exact",
    commitment: {
      storyPoints: num(commitment.storyPoints),
      taskCount: num(commitment.taskCount),
    },
    finalScope: {
      storyPoints: num(finalScope.storyPoints),
      taskCount: count(finalScope.taskCount),
    },
    completed: {
      storyPoints: num(completed.storyPoints),
      taskCount: count(completed.taskCount),
    },
    remaining: {
      storyPoints: num(remaining.storyPoints),
      taskCount: count(remaining.taskCount),
    },
    netScopeChange: {
      storyPoints: num(netScopeChange.storyPoints),
      taskCount: num(netScopeChange.taskCount),
    },
    completionRatio,
  };
}

export async function getProjectSprintAnalyticsOverview(
  projectId: string,
  scope: SprintScope,
): Promise<SprintAnalyticsOverviewDTO> {
  const qs = new URLSearchParams({
    organizationId: scope.organizationId,
    workspaceId: scope.workspaceId,
    ...(scope.actorId ? { actorId: scope.actorId } : {}),
  });
  const res = await requestJson<{ ok: boolean; data: unknown }>(
    apiServiceUrl(`/api/projects/${projectId}/sprint-analytics/overview?${qs}`),
  );
  return normalizeSprintAnalyticsOverview(res.data);
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
  const res = await requestJson<{ ok: boolean; data: unknown }>(
    apiServiceUrl(`/api/projects/${projectId}/sprint-analytics/velocity?${qs}`),
  );
  return normalizeVelocitySeries(res.data);
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
  const res = await requestJson<{ ok: boolean; data: unknown }>(
    apiServiceUrl(`/api/projects/${projectId}/sprints/${sprintId}/analytics?${qs}`),
  );
  const normalized = normalizeSprintAnalytics(res.data);
  if (!normalized) throw new Error("sprint_analytics_not_found");
  return normalized;
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
  const res = await requestJson<{ ok: boolean; data: unknown }>(
    apiServiceUrl(`/api/projects/${projectId}/sprints/${sprintId}/analytics/timeline?${qs}`),
  );
  return normalizeSprintTimeline(res.data, sprintId);
}
