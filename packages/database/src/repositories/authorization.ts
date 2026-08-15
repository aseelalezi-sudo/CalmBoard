import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db, withDatabaseContext } from "../client.js";
import { TenantConflictError, TenantPermissionDeniedError, TenantResourceNotFoundError } from "../errors.js";
import {
  membershipPermissionOverrides,
  membershipRoleBindings,
  memberships,
  permissions,
  projects,
  rolePermissions,
  roles,
  users,
  workspaces,
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

  async function assertNotSelfAssignment(userId: string, organizationId: string, membershipId: string) {
    const [membership] = await db
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(
        and(
          eq(memberships.id, membershipId),
          eq(memberships.organizationId, organizationId),
          eq(memberships.status, "active"),
        ),
      )
      .limit(1);
    if (!membership) throw new TenantResourceNotFoundError("membership");
    if (membership.userId === userId) {
      throw new TenantPermissionDeniedError("Members cannot change their own role assignments or permission overrides");
    }
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
        const bindings = await db
          .select({
            id: membershipRoleBindings.id,
            organizationId: membershipRoleBindings.organizationId,
            workspaceId: membershipRoleBindings.workspaceId,
            projectId: membershipRoleBindings.projectId,
            membershipId: membershipRoleBindings.membershipId,
            roleId: membershipRoleBindings.roleId,
            scope: membershipRoleBindings.scope,
            isPrimary: membershipRoleBindings.isPrimary,
            createdAt: membershipRoleBindings.createdAt,
            userId: memberships.userId,
            membershipWorkspaceId: memberships.workspaceId,
            membershipRole: memberships.role,
            membershipStatus: memberships.status,
            userName: users.name,
            userEmail: users.email,
            roleKey: roles.key,
            roleName: roles.name,
            roleIsSystem: roles.isSystem,
            workspaceName: workspaces.name,
            projectName: projects.name,
          })
          .from(membershipRoleBindings)
          .innerJoin(memberships, eq(membershipRoleBindings.membershipId, memberships.id))
          .innerJoin(users, eq(memberships.userId, users.id))
          .innerJoin(roles, eq(membershipRoleBindings.roleId, roles.id))
          .leftJoin(workspaces, eq(membershipRoleBindings.workspaceId, workspaces.id))
          .leftJoin(projects, eq(membershipRoleBindings.projectId, projects.id))
          .where(
            and(
              eq(membershipRoleBindings.organizationId, organizationId),
              eq(memberships.status, "active"),
              isNull(roles.deletedAt),
            ),
          )
          .orderBy(asc(users.name), asc(membershipRoleBindings.scope), asc(roles.name));
        const overrides = await db
          .select({
            id: membershipPermissionOverrides.id,
            organizationId: membershipPermissionOverrides.organizationId,
            workspaceId: membershipPermissionOverrides.workspaceId,
            projectId: membershipPermissionOverrides.projectId,
            membershipId: membershipPermissionOverrides.membershipId,
            permissionId: membershipPermissionOverrides.permissionId,
            permissionKey: permissions.key,
            scope: membershipPermissionOverrides.scope,
            effect: membershipPermissionOverrides.effect,
            reason: membershipPermissionOverrides.reason,
            createdAt: membershipPermissionOverrides.createdAt,
            updatedAt: membershipPermissionOverrides.updatedAt,
          })
          .from(membershipPermissionOverrides)
          .innerJoin(permissions, eq(membershipPermissionOverrides.permissionId, permissions.id))
          .innerJoin(memberships, eq(membershipPermissionOverrides.membershipId, memberships.id))
          .where(
            and(eq(membershipPermissionOverrides.organizationId, organizationId), eq(memberships.status, "active")),
          )
          .orderBy(asc(membershipPermissionOverrides.scope), asc(permissions.key));
        const assignmentCount = new Map<string, number>();
        for (const binding of bindings) {
          assignmentCount.set(binding.roleId, (assignmentCount.get(binding.roleId) ?? 0) + 1);
        }
        return {
          permissions: permissionRows,
          roles: roleRows.map((role) => ({
            ...role,
            assignmentCount: assignmentCount.get(role.id) ?? 0,
            permissionKeys: grants
              .filter((grant) => grant.roleId === role.id)
              .map((grant) => grant.permissionKey)
              .sort(),
          })),
          bindings,
          overrides,
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
        return db.transaction(async (transaction) => {
          const [role] = await transaction
            .select({ id: roles.id })
            .from(roles)
            .where(
              and(
                eq(roles.id, roleId),
                eq(roles.organizationId, organizationId),
                eq(roles.isSystem, false),
                isNull(roles.deletedAt),
              ),
            )
            .for("update")
            .limit(1);
          if (!role) return { status: "not_found" as const };
          const [binding] = await transaction
            .select({ id: membershipRoleBindings.id })
            .from(membershipRoleBindings)
            .where(
              and(eq(membershipRoleBindings.organizationId, organizationId), eq(membershipRoleBindings.roleId, roleId)),
            )
            .limit(1);
          if (binding) return { status: "in_use" as const };
          await transaction
            .update(roles)
            .set({ deletedAt: new Date(), updatedAt: new Date() })
            .where(eq(roles.id, roleId));
          return { status: "archived" as const, id: roleId };
        });
      });
    },

    async setPermissionOverride(
      userId: string,
      input: AuthorizationScope & {
        membershipId: string;
        permissionKey: string;
        scope: "organization" | "workspace" | "project";
        effect: "allow" | "deny";
        reason?: string | null;
      },
    ) {
      return withDatabaseContext(
        { organizationId: input.organizationId, workspaceId: input.workspaceId, actorId: userId },
        async () => {
          await assertNotSelfAssignment(userId, input.organizationId, input.membershipId);
          if (input.permissionKey === "organization.manage" && input.effect === "deny") {
            throw new TenantPermissionDeniedError("The organization management permission cannot be explicitly denied");
          }
          const [permission] = await permissionRows([input.permissionKey]);
          if (!permission) throw new TenantResourceNotFoundError("permission");
          return db.transaction(async (transaction) => {
            const scopeMatch =
              input.scope === "organization"
                ? and(
                    isNull(membershipPermissionOverrides.workspaceId),
                    isNull(membershipPermissionOverrides.projectId),
                  )
                : input.scope === "workspace"
                  ? and(
                      eq(membershipPermissionOverrides.workspaceId, input.workspaceId!),
                      isNull(membershipPermissionOverrides.projectId),
                    )
                  : and(
                      eq(membershipPermissionOverrides.workspaceId, input.workspaceId!),
                      eq(membershipPermissionOverrides.projectId, input.projectId!),
                    );
            const [existing] = await transaction
              .select({ id: membershipPermissionOverrides.id })
              .from(membershipPermissionOverrides)
              .where(
                and(
                  eq(membershipPermissionOverrides.organizationId, input.organizationId),
                  eq(membershipPermissionOverrides.membershipId, input.membershipId),
                  eq(membershipPermissionOverrides.permissionId, permission.id),
                  eq(membershipPermissionOverrides.scope, input.scope),
                  scopeMatch,
                ),
              )
              .limit(1);
            const values = {
              organizationId: input.organizationId,
              workspaceId: input.scope === "organization" ? null : input.workspaceId,
              projectId: input.scope === "project" ? input.projectId : null,
              membershipId: input.membershipId,
              permissionId: permission.id,
              scope: input.scope,
              effect: input.effect,
              reason: input.reason ?? null,
              createdBy: userId,
              updatedAt: new Date(),
            };
            if (existing) {
              const [updated] = await transaction
                .update(membershipPermissionOverrides)
                .set(values)
                .where(eq(membershipPermissionOverrides.id, existing.id))
                .returning();
              return updated;
            }
            const [created] = await transaction.insert(membershipPermissionOverrides).values(values).returning();
            return created;
          });
        },
      );
    },

    async removePermissionOverride(userId: string, organizationId: string, overrideId: string) {
      return withDatabaseContext({ organizationId, actorId: userId }, async () => {
        const [override] = await db
          .select({ membershipId: membershipPermissionOverrides.membershipId })
          .from(membershipPermissionOverrides)
          .where(
            and(
              eq(membershipPermissionOverrides.id, overrideId),
              eq(membershipPermissionOverrides.organizationId, organizationId),
            ),
          )
          .limit(1);
        if (!override) return null;
        await assertNotSelfAssignment(userId, organizationId, override.membershipId);
        const [removed] = await db
          .delete(membershipPermissionOverrides)
          .where(
            and(
              eq(membershipPermissionOverrides.id, overrideId),
              eq(membershipPermissionOverrides.organizationId, organizationId),
            ),
          )
          .returning({ id: membershipPermissionOverrides.id });
        return removed ?? null;
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
          await assertNotSelfAssignment(userId, input.organizationId, input.membershipId);
          const [role] = await db
            .select({ id: roles.id })
            .from(roles)
            .where(
              and(
                eq(roles.id, input.roleId),
                or(isNull(roles.organizationId), eq(roles.organizationId, input.organizationId)),
                isNull(roles.deletedAt),
              ),
            )
            .limit(1);
          if (!role) throw new TenantResourceNotFoundError("role");
          const scopeMatch =
            input.scope === "organization"
              ? and(isNull(membershipRoleBindings.workspaceId), isNull(membershipRoleBindings.projectId))
              : input.scope === "workspace"
                ? and(
                    eq(membershipRoleBindings.workspaceId, input.workspaceId!),
                    isNull(membershipRoleBindings.projectId),
                  )
                : and(
                    eq(membershipRoleBindings.workspaceId, input.workspaceId!),
                    eq(membershipRoleBindings.projectId, input.projectId!),
                  );
          const [existing] = await db
            .select({ id: membershipRoleBindings.id })
            .from(membershipRoleBindings)
            .where(
              and(
                eq(membershipRoleBindings.organizationId, input.organizationId),
                eq(membershipRoleBindings.membershipId, input.membershipId),
                eq(membershipRoleBindings.roleId, input.roleId),
                eq(membershipRoleBindings.scope, input.scope),
                scopeMatch,
              ),
            )
            .limit(1);
          if (existing) throw new TenantConflictError("The role is already assigned in this scope");
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
        const [current] = await db
          .select({ membershipId: membershipRoleBindings.membershipId, isPrimary: membershipRoleBindings.isPrimary })
          .from(membershipRoleBindings)
          .where(
            and(eq(membershipRoleBindings.id, bindingId), eq(membershipRoleBindings.organizationId, organizationId)),
          )
          .limit(1);
        if (!current || current.isPrimary) return null;
        await assertNotSelfAssignment(userId, organizationId, current.membershipId);
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
