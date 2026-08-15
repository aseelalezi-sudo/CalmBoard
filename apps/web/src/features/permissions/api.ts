import { apiServiceUrl, jsonRequest, request, requestJson } from "@/lib/client-api";

export type AuthorizationScopeName = "organization" | "workspace" | "project";
export type PermissionOverrideEffect = "allow" | "deny";

export type AuthorizationPermission = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  category: string;
  createdAt: string;
};

export type AuthorizationRole = {
  id: string;
  organizationId: string | null;
  key: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  assignmentCount: number;
  permissionKeys: string[];
  createdAt: string;
  updatedAt: string;
};

export type AuthorizationBinding = {
  id: string;
  organizationId: string;
  workspaceId: string | null;
  projectId: string | null;
  membershipId: string;
  roleId: string;
  scope: AuthorizationScopeName;
  isPrimary: boolean;
  createdAt: string;
  userId: string;
  membershipWorkspaceId: string | null;
  membershipRole: string;
  membershipStatus: string;
  userName: string;
  userEmail: string;
  roleKey: string;
  roleName: string;
  roleIsSystem: boolean;
  workspaceName: string | null;
  projectName: string | null;
};

export type AuthorizationOverride = {
  id: string;
  organizationId: string;
  workspaceId: string | null;
  projectId: string | null;
  membershipId: string;
  permissionId: string;
  permissionKey: string;
  scope: AuthorizationScopeName;
  effect: PermissionOverrideEffect;
  reason: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AuthorizationCatalog = {
  permissions: AuthorizationPermission[];
  roles: AuthorizationRole[];
  bindings: AuthorizationBinding[];
  overrides: AuthorizationOverride[];
};

export type AuthorizationScopeInput = {
  organizationId: string;
  workspaceId?: string;
  projectId?: string;
  membershipId: string;
  scope: AuthorizationScopeName;
};

export function getAuthorizationCatalog(organizationId: string) {
  return requestJson<AuthorizationCatalog>(
    `${apiServiceUrl("/authorization/catalog")}?organizationId=${encodeURIComponent(organizationId)}`,
  );
}

export function createAuthorizationRole(input: {
  organizationId: string;
  key: string;
  name: string;
  description?: string | null;
  permissionKeys: string[];
}) {
  return requestJson<AuthorizationRole>(apiServiceUrl("/authorization/roles"), jsonRequest("POST", input));
}

export function updateAuthorizationRole(
  roleId: string,
  input: { organizationId: string; name: string; description?: string | null; permissionKeys: string[] },
) {
  return requestJson<AuthorizationRole>(
    apiServiceUrl(`/authorization/roles/${encodeURIComponent(roleId)}`),
    jsonRequest("PATCH", input),
  );
}

export function archiveAuthorizationRole(roleId: string, organizationId: string) {
  return request(
    `${apiServiceUrl(`/authorization/roles/${encodeURIComponent(roleId)}`)}?organizationId=${encodeURIComponent(organizationId)}`,
    { method: "DELETE" },
  );
}

export function assignAuthorizationRole(input: AuthorizationScopeInput & { roleId: string }) {
  return requestJson<AuthorizationBinding>(apiServiceUrl("/authorization/bindings"), jsonRequest("POST", input));
}

export function removeAuthorizationBinding(bindingId: string, organizationId: string) {
  return request(
    `${apiServiceUrl(`/authorization/bindings/${encodeURIComponent(bindingId)}`)}?organizationId=${encodeURIComponent(organizationId)}`,
    { method: "DELETE" },
  );
}

export function setAuthorizationOverride(
  input: AuthorizationScopeInput & {
    permissionKey: string;
    effect: PermissionOverrideEffect;
    reason?: string | null;
  },
) {
  return requestJson<AuthorizationOverride>(apiServiceUrl("/authorization/overrides"), jsonRequest("POST", input));
}

export function removeAuthorizationOverride(overrideId: string, organizationId: string) {
  return request(
    `${apiServiceUrl(`/authorization/overrides/${encodeURIComponent(overrideId)}`)}?organizationId=${encodeURIComponent(organizationId)}`,
    { method: "DELETE" },
  );
}
