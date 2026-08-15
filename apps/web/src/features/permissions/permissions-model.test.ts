import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AuthorizationCatalog } from "./api";
import { appliesToScope, effectivePermissionKeys, exactScopeMatch, memberDirectory } from "./permissions-model";

const catalog = {
  permissions: [],
  roles: [
    { id: "role-org", permissionKeys: ["reports.view"] },
    { id: "role-workspace", permissionKeys: ["tasks.create"] },
    { id: "role-project", permissionKeys: ["audit.view"] },
  ],
  bindings: [
    {
      id: "binding-org",
      membershipId: "member-1",
      roleId: "role-org",
      scope: "organization",
      workspaceId: null,
      projectId: null,
      userName: "Zaid",
      userEmail: "z@example.test",
    },
    {
      id: "binding-workspace",
      membershipId: "member-1",
      roleId: "role-workspace",
      scope: "workspace",
      workspaceId: "workspace-1",
      projectId: null,
      userName: "Zaid",
      userEmail: "z@example.test",
    },
    {
      id: "binding-project",
      membershipId: "member-1",
      roleId: "role-project",
      scope: "project",
      workspaceId: "workspace-1",
      projectId: "project-1",
      userName: "Zaid",
      userEmail: "z@example.test",
    },
  ],
  overrides: [
    {
      id: "deny-task",
      membershipId: "member-1",
      permissionKey: "tasks.create",
      scope: "workspace",
      workspaceId: "workspace-1",
      projectId: null,
      effect: "deny",
    },
    {
      id: "allow-task",
      membershipId: "member-1",
      permissionKey: "tasks.create",
      scope: "project",
      workspaceId: "workspace-1",
      projectId: "project-1",
      effect: "allow",
    },
  ],
} as unknown as AuthorizationCatalog;

describe("permissions model", () => {
  it("inherits role grants and applies the most specific override", () => {
    assert.deepEqual(effectivePermissionKeys(catalog, "member-1", { organizationId: "org-1" }), ["reports.view"]);
    assert.deepEqual(
      effectivePermissionKeys(catalog, "member-1", { organizationId: "org-1", workspaceId: "workspace-1" }),
      ["reports.view"],
    );
    assert.deepEqual(
      effectivePermissionKeys(catalog, "member-1", {
        organizationId: "org-1",
        workspaceId: "workspace-1",
        projectId: "project-1",
      }),
      ["audit.view", "reports.view", "tasks.create"],
    );
  });

  it("distinguishes inherited and exact-scope assignments", () => {
    const projectScope = { organizationId: "org-1", workspaceId: "workspace-1", projectId: "project-1" };
    assert.equal(appliesToScope(catalog.bindings[0]!, projectScope), true);
    assert.equal(exactScopeMatch(catalog.bindings[0]!, "project", projectScope), false);
    assert.equal(exactScopeMatch(catalog.bindings[2]!, "project", projectScope), true);
  });

  it("returns each member once even when several roles are assigned", () => {
    assert.deepEqual(
      memberDirectory(catalog).map((member) => member.membershipId),
      ["member-1"],
    );
  });
});
