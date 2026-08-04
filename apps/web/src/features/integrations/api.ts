import { apiServiceUrl, createIdempotencyKey, jsonRequest, requestJson } from "@/lib/client-api";

export type IntegrationCredentialSummary = {
  id: string;
  provider: string;
  credentialKey: string;
  displayName: string;
  authType: "oauth2" | "api_key" | "bearer" | "basic" | "webhook_secret";
  status: "active" | "expired" | "error" | "revoked";
  expiresAt?: string | null;
  lastUsedAt?: string | null;
  hasSecret: true;
};

export function listIntegrationCredentials(input: { organizationId: string; workspaceId: string; actorId: string }) {
  const query = new URLSearchParams(input);
  return requestJson<IntegrationCredentialSummary[]>(
    `${apiServiceUrl("/integrations/credentials")}?${query.toString()}`,
  );
}

export function revokeIntegrationCredential(
  id: string,
  input: { organizationId: string; workspaceId: string; actorId: string },
) {
  const query = new URLSearchParams(input);
  return requestJson<IntegrationCredentialSummary>(
    `${apiServiceUrl(`/integrations/credentials/${id}`)}?${query.toString()}`,
    { method: "DELETE" },
  );
}

export type IntegrationOAuthProvider = "github" | "slack" | "gcal" | "microsoft";
export type IntegrationOAuthAvailability = Record<IntegrationOAuthProvider, boolean>;

export function integrationOAuthProviders() {
  return requestJson<IntegrationOAuthAvailability>(apiServiceUrl("/integrations/oauth/providers"));
}

export function integrationOAuthStartUrl(
  provider: IntegrationOAuthProvider,
  input: { organizationId: string; workspaceId: string; actorId: string },
) {
  return `${apiServiceUrl(`/integrations/oauth/${provider}/start`)}?${new URLSearchParams(input).toString()}`;
}

export function disconnectOAuthIntegration(
  provider: IntegrationOAuthProvider,
  input: { organizationId: string; workspaceId: string; actorId: string },
) {
  return requestJson<{ credential: IntegrationCredentialSummary; providerRevoked: boolean }>(
    `${apiServiceUrl(`/integrations/oauth/${provider}`)}?${new URLSearchParams(input).toString()}`,
    { method: "DELETE" },
  );
}

export function runIntegrationSync(input: { provider: string; organizationId?: string; workspaceId?: string }) {
  return requestJson<{ ok: boolean; error?: string }>(
    apiServiceUrl("/integrations/sync"),
    jsonRequest("POST", input, { "Idempotency-Key": createIdempotencyKey() }),
  );
}
