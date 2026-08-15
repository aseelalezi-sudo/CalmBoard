import { apiServiceUrl, jsonRequest, request, requestJson } from "@/lib/client-api";

export type SessionItem = {
  id: string;
  device: string;
  browser: string | null;
  ip: string | null;
  location: string | null;
  isCurrent: boolean;
  lastActive: string;
  lastRefreshAt: string | null;
  expiresAt: string;
  createdAt: string;
};

export type BranchItem = {
  id: string;
  name: string;
  code: string;
  city: string;
  address: string;
};

export type PreferencesItem = {
  emailEnabled: boolean;
  pushEnabled: boolean;
  inAppEnabled: boolean;
  dndStart: string;
  dndEnd: string;
  dndEnabled: boolean;
};

export type MfaStatus = {
  enabled: boolean;
  enabledAt: string | null;
  recoveryCodesRemaining: number;
};

export type MfaSetup = { secret: string; uri: string };

export async function getProfileSecurityData(organizationId?: string) {
  const [sessions, branches, preferences, mfa] = await Promise.all([
    requestJson<SessionItem[]>(apiServiceUrl("/profile/sessions")),
    requestJson<BranchItem[]>(
      `${apiServiceUrl("/branches")}?organizationId=${encodeURIComponent(organizationId ?? "")}`,
    ),
    requestJson<PreferencesItem>(apiServiceUrl("/profile/preferences")),
    requestJson<MfaStatus>(apiServiceUrl("/profile/mfa")),
  ]);
  return { sessions, branches, preferences, mfa };
}

export function beginMfaSetup() {
  return requestJson<MfaSetup>(apiServiceUrl("/profile/mfa/setup"), jsonRequest("POST", {}));
}

export function enableMfa(code: string) {
  return requestJson<{ enabled: true; recoveryCodes: string[]; enabledAt: string }>(
    apiServiceUrl("/profile/mfa/enable"),
    jsonRequest("POST", { code }),
  );
}

export function disableMfa(code: string) {
  return requestJson<{ enabled: false }>(apiServiceUrl("/profile/mfa/disable"), jsonRequest("POST", { code }));
}

export function deleteProfileSessions(input: { id?: string; allExceptCurrent?: boolean; all?: boolean }) {
  return requestJson<{ ok: boolean; message?: string; revoked?: number; revokedCurrent?: boolean }>(
    apiServiceUrl("/profile/sessions"),
    {
      ...jsonRequest("POST", input),
      method: "DELETE",
    },
  );
}

export async function updateProfilePreferences(preferences: Partial<PreferencesItem>) {
  await request(apiServiceUrl("/profile/preferences"), jsonRequest("PATCH", preferences));
}

export async function createBranch(input: { organizationId: string; name: string; code: string | null; city: string }) {
  await request(apiServiceUrl("/branches"), jsonRequest("POST", input));
}
