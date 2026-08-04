import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getTableColumns } from "drizzle-orm";
import {
  membershipPermissionOverrides,
  membershipRoleBindings,
  permissions,
  rolePermissions,
  roles,
} from "./schema.js";

describe("authorization schema", () => {
  it("defines reusable roles and granular permissions", () => {
    const permissionColumns = getTableColumns(permissions);
    const roleColumns = getTableColumns(roles);
    const rolePermissionColumns = getTableColumns(rolePermissions);

    assert.equal(permissionColumns.key.notNull, true);
    assert.equal(permissionColumns.category.notNull, true);
    assert.equal(roleColumns.organizationId.notNull, false, "system roles must remain global");
    assert.equal(roleColumns.isSystem.notNull, true);
    assert.equal(rolePermissionColumns.roleId.notNull, true);
    assert.equal(rolePermissionColumns.permissionId.notNull, true);
  });

  it("keeps role bindings and permission overrides directly tenant-scoped", () => {
    for (const table of [membershipRoleBindings, membershipPermissionOverrides]) {
      const columns = getTableColumns(table);
      assert.equal(columns.organizationId.notNull, true);
      assert.equal(columns.workspaceId.notNull, false);
      assert.equal(columns.projectId.notNull, false);
      assert.equal(columns.membershipId.notNull, true);
      assert.equal(columns.scope.notNull, true);
    }

    const overrideColumns = getTableColumns(membershipPermissionOverrides);
    assert.equal(overrideColumns.permissionId.notNull, true);
    assert.equal(overrideColumns.effect.notNull, true);
  });
});
