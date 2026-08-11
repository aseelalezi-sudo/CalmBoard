import type { Sprint } from "@/lib/types";
import { apiServiceUrl, jsonRequest, request, requestJson } from "@/lib/client-api";

export type SprintScope = {
  organizationId: string;
  workspaceId: string;
  projectId: string;
  actorId?: string;
};

type TenantBody = Omit<SprintScope, "projectId">;

export type SprintFormInput = {
  name: string;
  goal?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
};

export type CompleteSprintDestination = { type: "backlog" } | { type: "sprint"; sprintId: string };

function queryUrl(path: string, scope: SprintScope) {
  const url = new URL(apiServiceUrl(path));
  url.searchParams.set("organizationId", scope.organizationId);
  url.searchParams.set("workspaceId", scope.workspaceId);
  if (scope.actorId) url.searchParams.set("actorId", scope.actorId);
  return url.toString();
}

export async function listSprints(scope: SprintScope): Promise<Sprint[]> {
  const response = await requestJson<{ ok: true; sprints: Sprint[] }>(
    queryUrl(`/api/projects/${scope.projectId}/sprints`, scope),
  );
  return response.sprints;
}

export async function getSprint(sprintId: string, scope: SprintScope): Promise<Sprint> {
  const response = await requestJson<{ ok: true; sprint: Sprint }>(
    queryUrl(`/api/projects/${scope.projectId}/sprints/${sprintId}`, scope),
  );
  return response.sprint;
}

export async function createSprint(scope: SprintScope, input: SprintFormInput): Promise<Sprint> {
  const response = await requestJson<{ ok: true; sprint: Sprint }>(
    apiServiceUrl(`/api/projects/${scope.projectId}/sprints`),
    jsonRequest("POST", { ...scope, ...input }),
  );
  return response.sprint;
}

export async function updateSprint(sprintId: string, scope: SprintScope, input: SprintFormInput): Promise<Sprint> {
  const response = await requestJson<{ ok: true; sprint: Sprint }>(
    apiServiceUrl(`/api/projects/${scope.projectId}/sprints/${sprintId}`),
    jsonRequest("PATCH", { ...scope, ...input }),
  );
  return response.sprint;
}

async function lifecycleAction(path: string, scope: SprintScope, body: TenantBody): Promise<Sprint> {
  const response = await requestJson<{ ok: true; sprint: Sprint }>(apiServiceUrl(path), jsonRequest("POST", body));
  return response.sprint;
}

export function startSprint(sprintId: string, scope: SprintScope) {
  return lifecycleAction(`/api/projects/${scope.projectId}/sprints/${sprintId}/start`, scope, scope);
}

export function completeSprint(sprintId: string, destination: CompleteSprintDestination, scope: SprintScope) {
  return lifecycleAction(`/api/projects/${scope.projectId}/sprints/${sprintId}/complete`, scope, {
    ...scope,
    incompleteTaskDestination: destination,
  } as TenantBody);
}

export function cancelSprint(sprintId: string, scope: SprintScope) {
  return lifecycleAction(`/api/projects/${scope.projectId}/sprints/${sprintId}/cancel`, scope, scope);
}

export async function assignTaskToSprint(taskId: string, targetSprintId: string, scope: SprintScope): Promise<void> {
  await request(
    apiServiceUrl(`/api/projects/${scope.projectId}/sprints/${targetSprintId}/tasks`),
    jsonRequest("POST", { ...scope, taskId }),
  );
}

export async function removeTaskFromSprint(taskId: string, sourceSprintId: string, scope: SprintScope): Promise<void> {
  await request(queryUrl(`/api/projects/${scope.projectId}/sprints/${sourceSprintId}/tasks/${taskId}`, scope), {
    method: "DELETE",
  });
}

/**
 * The route sprint id is transport context only; the backend reads the destination
 * from the body. Keep that ambiguity contained here and expose target-first semantics.
 */
export async function moveTaskToSprint(
  taskId: string,
  targetSprintId: string | null,
  expectedFromSprintId: string | null,
  scope: SprintScope,
): Promise<void> {
  const routeContextSprintId = targetSprintId ?? expectedFromSprintId;
  if (!routeContextSprintId) return;
  await request(
    apiServiceUrl(`/api/projects/${scope.projectId}/sprints/${routeContextSprintId}/tasks/${taskId}/move`),
    jsonRequest("POST", { ...scope, targetSprintId, expectedFromSprintId }),
  );
}
