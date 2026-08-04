import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import { and, eq } from "drizzle-orm";
import {
  createAuthorizationRepository,
  db,
  membershipPermissionOverrides,
  membershipRoleBindings,
  memberships,
  organizations,
  permissions,
  pool,
  projects,
  roles,
  subscriptions,
  usageLimits,
  users,
  workspaces,
} from "../src/index";

after(async () => {
  await pool.end();
});

describe("database-backed authorization", () => {
  it("resolves all system roles, custom roles, scopes, and permission overrides", async () => {
    const suffix = randomUUID().slice(0, 8);
    const userIds: string[] = [];
    const organizationId = randomUUID();
    const workspaceId = randomUUID();
    const projectId = randomUUID();
    const repository = createAuthorizationRepository();
    try {
      for (const role of ["owner", "admin", "manager", "member", "guest", "viewer"] as const) {
        const [user] = await db
          .insert(users)
          .values({ email: `${role}-${suffix}@example.test`, name: `${role} test` })
          .returning({ id: users.id });
        userIds.push(user.id);
      }
      await db.insert(organizations).values({
        id: organizationId,
        name: "Authorization test",
        slug: `authz-${suffix}`,
        ownerId: userIds[0],
        seats: 6,
      });
      await db.insert(workspaces).values({
        id: workspaceId,
        organizationId,
        name: "Authorization workspace",
        slug: `authz-workspace-${suffix}`,
      });
      const roleKeys = ["owner", "admin", "manager", "member", "guest", "viewer"] as const;
      for (let index = 0; index < roleKeys.length; index += 1) {
        await db
          .insert(memberships)
          .values({ userId: userIds[index], organizationId, role: roleKeys[index], status: "active" });
      }
      await db
        .insert(projects)
        .values({ id: projectId, organizationId, workspaceId, name: "Authorization project", ownerId: userIds[0] });

      const scope = { organizationId, workspaceId, projectId };
      assert.equal((await repository.resolve(userIds[0], scope, "billing.manage")).allowed, true);
      assert.equal((await repository.resolve(userIds[1], scope, "billing.manage")).allowed, false);
      assert.equal((await repository.resolve(userIds[1], scope, "organization.manage")).allowed, false);
      assert.equal((await repository.resolve(userIds[2], scope, "data.export")).allowed, true);
      assert.equal((await repository.resolve(userIds[3], scope, "tasks.create")).allowed, true);
      assert.equal((await repository.resolve(userIds[3], scope, "tasks.update")).allowed, true);
      assert.equal((await repository.resolve(userIds[4], scope, "tasks.create")).allowed, false);
      assert.deepEqual((await repository.resolve(userIds[4], scope)).permissions, []);
      assert.equal((await repository.resolve(userIds[5], scope, "tasks.create")).allowed, false);
      assert.deepEqual((await repository.resolve(userIds[5], scope)).permissions, []);
      assert.equal((await repository.resolve(randomUUID(), scope, "tasks.create")).member, false);

      const [viewerMembership] = await db.select().from(memberships).where(eq(memberships.userId, userIds[5]));
      const customRole = await repository.createCustomRole(userIds[0], organizationId, {
        key: `analyst-${suffix}`,
        name: "Analyst",
        permissionKeys: ["reports.view"],
      });
      assert.ok(
        (await repository.listCatalog(userIds[0], organizationId)).roles.some((role) => role.id === customRole.id),
      );
      const binding = await repository.assignRole(userIds[0], {
        organizationId,
        workspaceId,
        membershipId: viewerMembership.id,
        roleId: customRole.id,
        scope: "workspace",
      });
      assert.equal((await repository.resolve(userIds[5], scope, "reports.view")).allowed, true);
      const updatedRole = await repository.updateCustomRole(userIds[0], organizationId, customRole.id, {
        name: "Security analyst",
        permissionKeys: ["audit.view"],
      });
      assert.deepEqual(updatedRole?.permissionKeys, ["audit.view"]);
      assert.equal((await repository.resolve(userIds[5], scope, "reports.view")).allowed, false);
      assert.equal((await repository.resolve(userIds[5], scope, "audit.view")).allowed, true);
      assert.ok(await repository.removeRoleAssignment(userIds[0], organizationId, binding.id));
      assert.equal((await repository.resolve(userIds[5], scope, "audit.view")).allowed, false);
      assert.ok(await repository.archiveCustomRole(userIds[0], organizationId, customRole.id));

      const [memberMembership] = await db.select().from(memberships).where(eq(memberships.userId, userIds[3]));
      const [taskCreatePermission] = await db.select().from(permissions).where(eq(permissions.key, "tasks.create"));
      await db.insert(membershipPermissionOverrides).values({
        organizationId,
        workspaceId,
        membershipId: memberMembership.id,
        permissionId: taskCreatePermission.id,
        scope: "workspace",
        effect: "deny",
        createdBy: userIds[0],
      });
      assert.equal((await repository.resolve(userIds[3], scope, "tasks.create")).allowed, false);
      await db.insert(membershipPermissionOverrides).values({
        organizationId,
        workspaceId,
        projectId,
        membershipId: memberMembership.id,
        permissionId: taskCreatePermission.id,
        scope: "project",
        effect: "allow",
        createdBy: userIds[0],
      });
      assert.equal((await repository.resolve(userIds[3], scope, "tasks.create")).allowed, true);
    } finally {
      await db
        .delete(membershipPermissionOverrides)
        .where(eq(membershipPermissionOverrides.organizationId, organizationId))
        .catch(() => undefined);
      await db
        .delete(membershipRoleBindings)
        .where(eq(membershipRoleBindings.organizationId, organizationId))
        .catch(() => undefined);
      await db
        .delete(memberships)
        .where(eq(memberships.organizationId, organizationId))
        .catch(() => undefined);
      await db
        .delete(roles)
        .where(and(eq(roles.organizationId, organizationId), eq(roles.isSystem, false)))
        .catch(() => undefined);
      await db
        .delete(projects)
        .where(eq(projects.organizationId, organizationId))
        .catch(() => undefined);
      await db
        .delete(usageLimits)
        .where(eq(usageLimits.organizationId, organizationId))
        .catch(() => undefined);
      await db
        .delete(subscriptions)
        .where(eq(subscriptions.organizationId, organizationId))
        .catch(() => undefined);
      await db
        .delete(workspaces)
        .where(eq(workspaces.organizationId, organizationId))
        .catch(() => undefined);
      await db
        .delete(organizations)
        .where(eq(organizations.id, organizationId))
        .catch(() => undefined);
      for (const userId of userIds)
        await db
          .delete(users)
          .where(eq(users.id, userId))
          .catch(() => undefined);
    }
  });
});
