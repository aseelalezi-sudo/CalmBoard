import type { SavedView, SavedViewConfiguration } from "@/lib/types";
import { apiServiceUrl, jsonRequest, request, requestJson } from "@/lib/client-api";

type SavedViewScope = { organizationId: string; workspaceId: string; actorId?: string };

export function updateSavedViewRecord(
  scope: SavedViewScope,
  view: Pick<SavedView, "id" | "viewType">,
  updates: Partial<{
    name: string;
    filters: Record<string, string | undefined>;
    configuration: SavedViewConfiguration;
    isShared: boolean;
    isDefault: boolean;
  }>,
) {
  return requestJson<SavedView>(
    apiServiceUrl("/saved-views"),
    jsonRequest("PATCH", { ...scope, id: view.id, viewType: view.viewType, ...updates }),
  );
}

export async function deleteSavedViewRecord(scope: SavedViewScope, id: string) {
  const query = new URLSearchParams({
    organizationId: scope.organizationId,
    workspaceId: scope.workspaceId,
    id,
  });
  if (scope.actorId) query.set("actorId", scope.actorId);
  await request(apiServiceUrl(`/saved-views?${query.toString()}`), { method: "DELETE" });
}
