import { apiServiceUrl, jsonRequest, request, requestJson } from "@/lib/client-api";

export type DeletionRequestState = {
  id: string;
  status: "requested" | "scheduled" | "processing" | "retry_wait" | "failed" | "completed" | "canceled";
  policyVersion: string;
  requestedAt: string;
  scheduledFor: string | null;
  processingStartedAt: string | null;
  retryAt: string | null;
  completedAt: string | null;
  failedAt: string | null;
  lastErrorCode: string | null;
  lastErrorSummary: string | null;
};

export type ReauthenticationInput = { password?: string; code?: string };

export function getAccountDeletion() {
  return requestJson<DeletionRequestState | null>(apiServiceUrl("/profile/deletion"));
}

export function scheduleAccountDeletion(input: ReauthenticationInput) {
  return requestJson<DeletionRequestState>(apiServiceUrl("/profile/deletion"), jsonRequest("POST", input));
}

export async function cancelAccountDeletion() {
  await request(apiServiceUrl("/profile/deletion"), { ...jsonRequest("POST", {}), method: "DELETE" });
}

function organizationPath(organizationId: string) {
  return apiServiceUrl(`/organizations/${encodeURIComponent(organizationId)}/deletion`);
}

export function getOrganizationDeletion(organizationId: string) {
  return requestJson<DeletionRequestState | null>(organizationPath(organizationId));
}

export function scheduleOrganizationDeletion(
  organizationId: string,
  input: ReauthenticationInput & { confirmedName: string },
) {
  return requestJson<DeletionRequestState>(organizationPath(organizationId), jsonRequest("POST", input));
}

export async function cancelOrganizationDeletion(organizationId: string) {
  await request(organizationPath(organizationId), { ...jsonRequest("POST", {}), method: "DELETE" });
}
