import type { Project, WorkloadCapacity, WorkloadSettings, WorkloadTimeOff } from "@/lib/types";
import { apiServiceUrl, jsonRequest, requestJson } from "@/lib/client-api";

type WorkloadScope = Pick<Project, "organizationId" | "workspaceId"> & { actorId?: string };

export function getWorkloadSettings(scope: WorkloadScope, rangeStart: string, rangeEnd: string) {
  const query = new URLSearchParams({
    organizationId: scope.organizationId,
    workspaceId: scope.workspaceId,
    rangeStart,
    rangeEnd,
  });
  if (scope.actorId) query.set("actorId", scope.actorId);
  return requestJson<WorkloadSettings>(apiServiceUrl(`/workload?${query.toString()}`));
}

export function updateWorkloadCapacity(
  scope: WorkloadScope,
  userId: string,
  input: { weeklyMinutes: number; workdayMask: number },
) {
  return requestJson<WorkloadCapacity>(
    apiServiceUrl(`/workload/capacities/${encodeURIComponent(userId)}`),
    jsonRequest("PUT", { ...scope, ...input }),
  );
}

export function createWorkloadTimeOff(
  scope: WorkloadScope,
  input: {
    userId?: string | null;
    kind: WorkloadTimeOff["kind"];
    startsOn: string;
    endsOn: string;
    minutesPerDay?: number | null;
    note?: string;
  },
) {
  return requestJson<WorkloadTimeOff>(apiServiceUrl("/workload/time-off"), jsonRequest("POST", { ...scope, ...input }));
}

export function deleteWorkloadTimeOff(scope: WorkloadScope, id: string) {
  return requestJson<{ ok: true }>(
    apiServiceUrl(`/workload/time-off/${encodeURIComponent(id)}`),
    jsonRequest("DELETE", scope),
  );
}
