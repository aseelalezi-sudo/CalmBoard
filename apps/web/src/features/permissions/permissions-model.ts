import type { AuthorizationBinding, AuthorizationCatalog, AuthorizationOverride, AuthorizationScopeName } from "./api";

export type PermissionScope = {
  organizationId: string;
  workspaceId?: string;
  projectId?: string;
};

const specificity: Record<AuthorizationScopeName, number> = { organization: 1, workspace: 2, project: 3 };

export function appliesToScope(
  item: Pick<AuthorizationBinding | AuthorizationOverride, "scope" | "workspaceId" | "projectId">,
  scope: PermissionScope,
) {
  if (item.scope === "organization") return true;
  if (item.scope === "workspace") return Boolean(scope.workspaceId && item.workspaceId === scope.workspaceId);
  return Boolean(scope.projectId && item.workspaceId === scope.workspaceId && item.projectId === scope.projectId);
}

export function exactScopeMatch(
  item: Pick<AuthorizationBinding | AuthorizationOverride, "scope" | "workspaceId" | "projectId">,
  scopeName: AuthorizationScopeName,
  scope: PermissionScope,
) {
  if (item.scope !== scopeName) return false;
  if (scopeName === "organization") return item.workspaceId === null && item.projectId === null;
  if (scopeName === "workspace") return item.workspaceId === scope.workspaceId && item.projectId === null;
  return item.workspaceId === scope.workspaceId && item.projectId === scope.projectId;
}

export function effectivePermissionKeys(catalog: AuthorizationCatalog, membershipId: string, scope: PermissionScope) {
  const roleById = new Map(catalog.roles.map((role) => [role.id, role]));
  const effective = new Set<string>();
  for (const binding of catalog.bindings) {
    if (binding.membershipId !== membershipId || !appliesToScope(binding, scope)) continue;
    for (const permission of roleById.get(binding.roleId)?.permissionKeys ?? []) effective.add(permission);
  }

  const selectedOverrides = new Map<string, AuthorizationOverride>();
  for (const override of catalog.overrides) {
    if (override.membershipId !== membershipId || !appliesToScope(override, scope)) continue;
    const current = selectedOverrides.get(override.permissionKey);
    if (
      !current ||
      specificity[override.scope] > specificity[current.scope] ||
      (specificity[override.scope] === specificity[current.scope] && override.effect === "deny")
    ) {
      selectedOverrides.set(override.permissionKey, override);
    }
  }
  for (const override of selectedOverrides.values()) {
    if (override.effect === "allow") effective.add(override.permissionKey);
    else effective.delete(override.permissionKey);
  }
  return [...effective].sort();
}

export function memberDirectory(catalog: AuthorizationCatalog) {
  return [...new Map(catalog.bindings.map((binding) => [binding.membershipId, binding])).values()].sort((a, b) =>
    a.userName.localeCompare(b.userName),
  );
}
