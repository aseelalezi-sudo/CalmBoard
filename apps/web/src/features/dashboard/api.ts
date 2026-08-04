import type { DashboardLayout, DashboardWidget } from "@/lib/types";
import { apiServiceUrl, jsonRequest, requestJson } from "@/lib/client-api";

type Scope = { organizationId: string; workspaceId: string };

export function getDashboardLayout(scope: Scope) {
  const query = new URLSearchParams(scope);
  return requestJson<DashboardLayout>(apiServiceUrl(`/dashboard-layout?${query.toString()}`));
}

export function updateDashboardLayout(scope: Scope, widgets: DashboardWidget[], expectedVersion: number) {
  return requestJson<DashboardLayout>(
    apiServiceUrl("/dashboard-layout"),
    jsonRequest("PATCH", { ...scope, widgets, expectedVersion }),
  );
}
