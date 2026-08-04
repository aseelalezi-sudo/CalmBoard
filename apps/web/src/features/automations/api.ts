import type { Automation, AutomationRun } from "@/lib/types";
import { apiServiceUrl, jsonRequest, request, requestJson } from "@/lib/client-api";

type AutomationScope = {
  organizationId: string;
  workspaceId: string;
  actorId?: string;
};

export async function getAutomationState(scope: Omit<AutomationScope, "actorId">) {
  const query = new URLSearchParams({
    organizationId: scope.organizationId,
    workspaceId: scope.workspaceId,
  });
  return requestJson<{ automations?: Automation[]; runs?: AutomationRun[] }>(
    `${apiServiceUrl("/automations")}?${query.toString()}`,
  );
}

export async function updateAutomationRecord(id: string, enabled: boolean, scope: AutomationScope) {
  await request(apiServiceUrl("/automations"), jsonRequest("PATCH", { id, enabled, ...scope }));
}
