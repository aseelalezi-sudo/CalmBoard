import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db, withDatabaseContext } from "../client.js";
import {
  membershipPermissionOverrides,
  membershipRoleBindings,
  memberships,
  permissions,
  rolePermissions,
  roles,
} from "../schema.js";

export type AuthorizationScope = {
  organizationId: string;
  workspaceId?: string;
  projectId?: string;
};

export type AuthorizationDecision = {
  member: boolean;
  allowed: boolean;
  membershipId?: string;
  roles: string[];
  permissions: string[];
};

function applicableScope(
  scope: AuthorizationScope,
  table: typeof membershipRoleBindings | typeof membershipPermissionOverrides,
) {
  return or(
    and(eq(table.scope, "organization"), isNull(table.workspaceId), isNull(table.projectId)),
    scope.workspaceId
      ? and(eq(table.scope, "workspace"), eq(table.workspaceId, scope.workspaceId), isNull(table.projectId))
      : undefined,
    scope.workspaceId && scope.projectId
      ? and(eq(table.scope, "project"), eq(table.workspaceId, scope.workspaceId), eq(table.projectId, scope.projectId))
      : undefined,
  );
}

function scopeSpecificity(scope: "organization" | "workspace" | "project") {
  return scope === "project" ? 3 : scope === "workspace" ? 2 : 1;
}

export function createAuthorizationRepository() {
  async function permissionRows(permissionKeys: string[]) {
    const unique = [...new Set(permissionKeys)];
    const rows = unique.length ? await db.select().from(permissions).where(inArray(permissions.key, unique)) : [];
    if (rows.length !== unique.length) throw new Error("One or more permission keys are invalid");
    return rows;
  }

  return {
    async resolve(
      userId: string,
      scope: AuthorizationScope,
      requiredPermission?: string,
    ): Promise<AuthorizationDecision> {
      return withDatabaseContext(
        { organizationId: scope.organizationId, workspaceId: scope.workspaceId, actorId: userId },
        async () => {
          const membershipScope = scope.workspaceId
            ? or(isNull(memberships.workspaceId), eq(memberships.workspaceId, scope.workspaceId))
            : isNull(memberships.workspaceId);
          const [membership] = await db
            .select({ id: memberships.id })
            .from(memberships)
            .where(
              and(
                eq(memberships.userId, userId),
                eq(memberships.organizationId, scope.organizationId),
                eq(memberships.status, "active"),
                membershipScope,
              ),
            )
            .orderBy(desc(sql`${memberships.workspaceId} is not null`))
            .limit(1);
          if (!membership) return { member: false, allowed: false, roles: [], permissions: [] };

          const bindings = await db
            .select({ roleId: membershipRoleBindings.roleId, roleKey: roles.key })
            .from(membershipRoleBindings)
            .innerJoin(roles, eq(roles.id, membershipRoleBindings.roleId))
            .where(
              and(
                eq(membershipRoleBindings.membershipId, membership.id),
                eq(membershipRoleBindings.organizationId, scope.organizationId),
                isNull(roles.deletedAt),
                applicableScope(scope, membershipRoleBindings),
              ),
            );
          const roleIds = [...new Set(bindings.map((binding) => binding.roleId))];
          const granted = roleIds.length
            ? await db
                .select({ key: permissions.key })
                .from(rolePermissions)
                .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
                .where(inArray(rolePermissions.roleId, roleIds))
            : [];
          const grantedPermissions = new Set(granted.map((permission) => permission.key));

          const overrides = await db
            .select({
              key: permissions.key,
              effect: membershipPermissionOverrides.effect,
              scope: membershipPermissionOverrides.scope,
            })
            .from(membershipPermissionOverrides)
            .innerJoin(permissions, eq(permissions.id, membershipPermissionOverrides.permissionId))
            .where(
              and(
                eq(membershipPermissionOverrides.membershipId, membership.id),
                eq(membershipPermissionOverrides.organizationId, scope.organizationId),
                applicableScope(scope, membershipPermissionOverrides),
              ),
            );
          const overrideByPermission = new Map<string, { effect: "allow" | "deny"; specificity: number }>();
          for (const override of overrides) {
            const specificity = scopeSpecificity(override.scope);
            const current = overrideByPermission.get(override.key);
            if (
              !current ||
              specificity > current.specificity ||
              (specificity === current.specificity && override.effect === "deny")
            ) {
              overrideByPermission.set(override.key, { effect: override.effect, specificity });
            }
          }
          for (const [key, override] of overrideByPermission) {
            if (override.effect === "allow") grantedPermissions.add(key);
            else grantedPermissions.delete(key);
          }

          return {
            member: true,
            allowed: requiredPermission ? grantedPermissions.has(requiredPermission) : true,
            membershipId: membership.id,
            roles: [...new Set(bindings.map((binding) => binding.roleKey))],
            permissions: [...grantedPermissions].sort(),
          };
        },
      );
    },

    async listCatalog(userId: string, organizationId: string) {
      return withDatabaseContext({ organizationId, actorId: userId }, async () => {
        const permissionRows = await db
          .select()
          .from(permissions)
          .orderBy(asc(permissions.category), asc(permissions.key));
        const roleRows = await db
          .select()
          .from(roles)
          .where(
            and(or(isNull(roles.organizationId), eq(roles.organizationId, organizationId)), isNull(roles.deletedAt)),
          )
          .orderBy(desc(roles.isSystem), asc(roles.name));
        const roleIds = roleRows.map((role) => role.id);
        const grants = roleIds.length
          ? await db
              .select({ roleId: rolePermissions.roleId, permissionKey: permissions.key })
              .from(rolePermissions)
              .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
              .where(inArray(rolePermissions.roleId, roleIds))
          : [];
        return {
          permissions: permissionRows,
          roles: roleRows.map((role) => ({
            ...role,
            permissionKeys: grants
              .filter((grant) => grant.roleId === role.id)
              .map((grant) => grant.permissionKey)
              .sort(),
          })),
        };
      });
    },

    async createCustomRole(
      userId: string,
      organizationId: string,
      input: { key: string; name: string; description?: string | null; permissionKeys: string[] },
    ) {
      return withDatabaseContext({ organizationId, actorId: userId }, async () => {
        return db.transaction(async (transaction) => {
          const availablePermissions = await permissionRows(input.permissionKeys);
          const [role] = await transaction
            .insert(roles)
            .values({
              organizationId,
              key: input.key,
              name: input.name,
              description: input.description,
              createdBy: userId,
            })
            .returning();
          if (availablePermissions.length) {
            await transaction
              .insert(rolePermissions)
              .values(availablePermissions.map((permission) => ({ roleId: role.id, permissionId: permission.id })));
          }
          return { ...role, permissionKeys: availablePermissions.map((permission) => permission.key).sort() };
        });
      });
    },

    async updateCustomRole(
      userId: string,
      organizationId: string,
      roleId: string,
      input: { name: string; description?: string | null; permissionKeys: string[] },
    ) {
      return withDatabaseContext({ organizationId, actorId: userId }, async () => {
        return db.transaction(async (transaction) => {
          const availablePermissions = await permissionRows(input.permissionKeys);
          const [role] = await transaction
            .update(roles)
            .set({ name: input.name, description: input.description, updatedAt: new Date() })
            .where(
              and(
                eq(roles.id, roleId),
                eq(roles.organizationId, organizationId),
                eq(roles.isSystem, false),
                isNull(roles.deletedAt),
              ),
            )
            .returning();
          if (!role) return null;
          await transaction.delete(rolePermissions).where(eq(rolePermissions.roleId, role.id));
          if (availablePermissions.length) {
            await transaction
              .insert(rolePermissions)
              .values(availablePermissions.map((permission) => ({ roleId: role.id, permissionId: permission.id })));
          }
          return { ...role, permissionKeys: availablePermissions.map((permission) => permission.key).sort() };
        });
      });
    },

    async archiveCustomRole(userId: string, organizationId: string, roleId: string) {
      return withDatabaseContext({ organizationId, actorId: userId }, async () => {
        const [role] = await db
          .update(roles)
          .set({ deletedAt: new Date(), updatedAt: new Date() })
          .where(
            and(
              eq(roles.id, roleId),
              eq(roles.organizationId, organizationId),
              eq(roles.isSystem, false),
              isNull(roles.deletedAt),
            ),
          )
          .returning({ id: roles.id });
        return role ?? null;
      });
    },

    async assignRole(
      userId: string,
      input: AuthorizationScope & {
        membershipId: string;
        roleId: string;
        scope: "organization" | "workspace" | "project";
      },
    ) {
      return withDatabaseContext(
        { organizationId: input.organizationId, workspaceId: input.workspaceId, actorId: userId },
        async () => {
          const [binding] = await db
            .insert(membershipRoleBindings)
            .values({
              organizationId: input.organizationId,
              workspaceId: input.scope === "organization" ? null : input.workspaceId,
              projectId: input.scope === "project" ? input.projectId : null,
              membershipId: input.membershipId,
              roleId: input.roleId,
              scope: input.scope,
              createdBy: userId,
            })
            .returning();
          return binding;
        },
      );
    },

    async removeRoleAssignment(userId: string, organizationId: string, bindingId: string) {
      return withDatabaseContext({ organizationId, actorId: userId }, async () => {
        const [binding] = await db
          .delete(membershipRoleBindings)
          .where(
            and(
              eq(membershipRoleBindings.id, bindingId),
              eq(membershipRoleBindings.organizationId, organizationId),
              eq(membershipRoleBindings.isPrimary, false),
            ),
          )
          .returning({ id: membershipRoleBindings.id });
        return binding ?? null;
      });
    },
  };
}
