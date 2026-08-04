import type { Goal } from "@/lib/types";
import { apiServiceUrl, jsonRequest, requestJson } from "@/lib/client-api";

type GoalScope = { organizationId: string; workspaceId: string; actorId?: string };

export function checkInGoalRecord(
  id: string,
  input: { note: string; progress?: number; currentValue?: number },
  scope: GoalScope,
) {
  return requestJson<Goal>(
    apiServiceUrl(`/goals/${encodeURIComponent(id)}/checkins`),
    jsonRequest("POST", { ...input, ...scope }),
  );
}

export function linkGoalTaskRecord(id: string, taskId: string, weight: number, scope: GoalScope) {
  return requestJson<Goal>(
    apiServiceUrl(`/goals/${encodeURIComponent(id)}/tasks`),
    jsonRequest("POST", { taskId, weight, ...scope }),
  );
}

export function unlinkGoalTaskRecord(id: string, taskId: string, scope: GoalScope) {
  const query = new URLSearchParams({ ...scope, taskId });
  return requestJson<Goal>(`${apiServiceUrl(`/goals/${encodeURIComponent(id)}/tasks`)}?${query.toString()}`, {
    method: "DELETE",
  });
}

export async function updateGoalRecord(
  id: string,
  input: Partial<Pick<Goal, "title" | "description" | "ownerId" | "periodStart" | "periodEnd">>,
  scope: { organizationId: string; workspaceId: string; actorId?: string },
) {
  return requestJson<Goal>(apiServiceUrl("/goals"), jsonRequest("PATCH", { id, ...input, ...scope }));
}
