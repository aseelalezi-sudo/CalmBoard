import type { User } from "@/lib/types";
import { apiServiceUrl, jsonRequest, requestJson } from "@/lib/client-api";

export type InvitationInspection = {
  status: string;
  email?: string;
  role?: string;
  expiresAt?: string | null;
  organization?: { name: string };
  workspace?: { name: string } | null;
};

export function inspectInvitationToken(token: string) {
  return requestJson<InvitationInspection>(apiServiceUrl("/invitations/inspect"), jsonRequest("POST", { token }));
}

export function acceptInvitationToken(token: string) {
  return requestJson<{ organizationId: string; workspaceId: string | null }>(
    apiServiceUrl("/invitations/accept"),
    jsonRequest("POST", { token }),
  );
}

export function declineInvitationToken(token: string) {
  return requestJson<{ ok: true }>(apiServiceUrl("/invitations/decline"), jsonRequest("POST", { token }));
}

export type InvitationSession = { user?: User };
