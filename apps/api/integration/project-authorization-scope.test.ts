import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import { ForbiddenException, NotFoundException, type ExecutionContext } from "@nestjs/common";
import {
  db,
  membershipPermissionOverrides,
  memberships,
  organizations,
  permissions,
  pool,
  projects,
  sprints,
  tasks,
  users,
  workspaces,
} from "@calmboard/database";
import { and, eq, inArray } from "drizzle-orm";
import { AuthorizationService } from "../src/authorization.service.js";
import { AUTHORIZATION_POLICY, PermissionGuard, REQUIRED_PERMISSION } from "../src/permission.guard.js";
import { PUBLIC_ROUTE } from "../src/public-route.decorator.js";
import { RequestScopeService } from "../src/request-scope.service.js";
import { TenantGuard } from "../src/tenant.guard.js";

function reflector(values: Record<string, unknown>) {
  return { getAllAndOverride: (key: string) => values[key] } as never;
}

function executionContext(request: unknown) {
  return {
    getType: () => "http",
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
  } as unknown as ExecutionContext;
}

function request(input: {
  userId: string;
  url: string;
  organizationId: string;
  workspaceId: string;
  params?: Record<string, string>;
}) {
  return {
    method: "PATCH",
    url: input.url,
    auth: { userId: input.userId, sessionId: randomUUID() },
    params: input.params ?? {},
    body: { organizationId: input.organizationId, workspaceId: input.workspaceId },
    query: {},
  };
}

async function authorize(input: {
  userId: string;
  url: string;
  organizationId: string;
  workspaceId: string;
  params?: Record<string, string>;
  permission: string;
}) {
  const candidate = request(input);
  const context = executionContext(candidate);
  const tenantGuard = new TenantGuard(
    reflector({ [PUBLIC_ROUTE]: false }),
    new AuthorizationService(),
    new RequestScopeService(db),
  );
  await tenantGuard.canActivate(context);
  const permissionGuard = new PermissionGuard(
    reflector({
      [PUBLIC_ROUTE]: false,
      [AUTHORIZATION_POLICY]: true,
      [REQUIRED_PERMISSION]: input.permission,
    }),
  );
  permissionGuard.canActivate(context);
  return candidate;
}

describe("project-scoped HTTP authorization", () => {
  const userIds: string[] = [];
  const organizationIds: string[] = [];

  after(async () => {
    if (organizationIds.length) {
      await pool.query("delete from tasks where organization_id = any($1::uuid[])", [organizationIds]);
      await pool.query("delete from sprints where organization_id = any($1::uuid[])", [organizationIds]);
      await pool.query("delete from membership_permission_overrides where organization_id = any($1::uuid[])", [
        organizationIds,
      ]);
      await pool.query("delete from memberships where organization_id = any($1::uuid[])", [organizationIds]);
      await pool.query("delete from projects where organization_id = any($1::uuid[])", [organizationIds]);
      await pool.query("delete from usage_limits where organization_id = any($1::uuid[])", [organizationIds]);
      await pool.query("delete from subscriptions where organization_id = any($1::uuid[])", [organizationIds]);
      await pool.query("delete from workspaces where organization_id = any($1::uuid[])", [organizationIds]);
      await pool.query("update organizations set owner_id = null where id = any($1::uuid[])", [organizationIds]);
      await pool.query("delete from organizations where id = any($1::uuid[])", [organizationIds]);
    }
    if (userIds.length) await pool.query("delete from users where id = any($1::uuid[])", [userIds]);
    await pool.end();
  });

  it("enforces trusted project overrides and rejects mismatched nested resources", { timeout: 30_000 }, async () => {
    const suffix = randomUUID().slice(0, 8);
    const organizationId = randomUUID();
    const foreignOrganizationId = randomUUID();
    const workspaceId = randomUUID();
    const siblingWorkspaceId = randomUUID();
    const foreignWorkspaceId = randomUUID();
    const projectAId = randomUUID();
    const projectBId = randomUUID();
    const siblingProjectId = randomUUID();
    const foreignProjectId = randomUUID();
    organizationIds.push(organizationId, foreignOrganizationId);

    const createdUsers = await db
      .insert(users)
      .values([
        { email: `m2-owner-${suffix}@example.test`, name: "M2 owner" },
        { email: `m2-admin-${suffix}@example.test`, name: "M2 admin" },
        { email: `m2-member-${suffix}@example.test`, name: "M2 member" },
        { email: `m2-viewer-${suffix}@example.test`, name: "M2 viewer" },
        { email: `m2-platform-${suffix}@example.test`, name: "M2 platform", isPlatformAdmin: true },
      ])
      .returning({ id: users.id, email: users.email });
    userIds.push(...createdUsers.map((user) => user.id));
    const idFor = (prefix: string) => createdUsers.find((user) => user.email.startsWith(prefix))!.id;
    const ownerId = idFor("m2-owner-");
    const adminId = idFor("m2-admin-");
    const memberId = idFor("m2-member-");
    const viewerId = idFor("m2-viewer-");
    const platformAdminId = idFor("m2-platform-");

    await db.insert(organizations).values([
      { id: organizationId, name: "M2 authorization", slug: `m2-auth-${suffix}`, ownerId, seats: 4 },
      {
        id: foreignOrganizationId,
        name: "M2 foreign",
        slug: `m2-foreign-${suffix}`,
        ownerId: platformAdminId,
        seats: 1,
      },
    ]);
    await db.insert(workspaces).values([
      { id: workspaceId, organizationId, name: "M2 workspace", slug: `m2-workspace-${suffix}` },
      {
        id: siblingWorkspaceId,
        organizationId,
        name: "M2 sibling workspace",
        slug: `m2-sibling-workspace-${suffix}`,
      },
      {
        id: foreignWorkspaceId,
        organizationId: foreignOrganizationId,
        name: "M2 foreign workspace",
        slug: `m2-foreign-workspace-${suffix}`,
      },
    ]);
    await db.insert(memberships).values([
      { userId: ownerId, organizationId, role: "owner", status: "active" },
      { userId: adminId, organizationId, role: "admin", status: "active" },
      { userId: memberId, organizationId, role: "member", status: "active" },
      { userId: viewerId, organizationId, role: "viewer", status: "active" },
      { userId: platformAdminId, organizationId: foreignOrganizationId, role: "owner", status: "active" },
    ]);
    await db.insert(projects).values([
      { id: projectAId, organizationId, workspaceId, name: "Project A", ownerId },
      { id: projectBId, organizationId, workspaceId, name: "Project B", ownerId },
      { id: siblingProjectId, organizationId, workspaceId: siblingWorkspaceId, name: "Sibling project", ownerId },
      {
        id: foreignProjectId,
        organizationId: foreignOrganizationId,
        workspaceId: foreignWorkspaceId,
        name: "Foreign project",
        ownerId: platformAdminId,
      },
    ]);

    const [taskA, taskB, siblingTask, foreignTask] = await db
      .insert(tasks)
      .values([
        { organizationId, workspaceId, projectId: projectAId, serial: `M2A-${suffix}`, title: "Task A" },
        { organizationId, workspaceId, projectId: projectBId, serial: `M2B-${suffix}`, title: "Task B" },
        {
          organizationId,
          workspaceId: siblingWorkspaceId,
          projectId: siblingProjectId,
          serial: `M2S-${suffix}`,
          title: "Sibling workspace task",
        },
        {
          organizationId: foreignOrganizationId,
          workspaceId: foreignWorkspaceId,
          projectId: foreignProjectId,
          serial: `M2F-${suffix}`,
          title: "Foreign task",
        },
      ])
      .returning({ id: tasks.id });
    const [sprintA, sprintB] = await db
      .insert(sprints)
      .values([
        { organizationId, workspaceId, projectId: projectAId, name: "Sprint A", createdBy: ownerId },
        { organizationId, workspaceId, projectId: projectBId, name: "Sprint B", createdBy: ownerId },
      ])
      .returning({ id: sprints.id });

    const membershipRows = await db
      .select({ id: memberships.id, userId: memberships.userId })
      .from(memberships)
      .where(
        and(eq(memberships.organizationId, organizationId), inArray(memberships.userId, [adminId, memberId, viewerId])),
      );
    const permissionRows = await db
      .select({ id: permissions.id, key: permissions.key })
      .from(permissions)
      .where(inArray(permissions.key, ["tasks.update", "sprints.view"]));
    const membershipId = (userId: string) => membershipRows.find((row) => row.userId === userId)!.id;
    const permissionId = (key: string) => permissionRows.find((row) => row.key === key)!.id;
    await db.insert(membershipPermissionOverrides).values([
      {
        organizationId,
        workspaceId,
        projectId: projectAId,
        membershipId: membershipId(memberId),
        permissionId: permissionId("tasks.update"),
        scope: "project",
        effect: "deny",
        createdBy: ownerId,
      },
      {
        organizationId,
        workspaceId,
        projectId: projectAId,
        membershipId: membershipId(adminId),
        permissionId: permissionId("sprints.view"),
        scope: "project",
        effect: "deny",
        createdBy: ownerId,
      },
      {
        organizationId,
        workspaceId,
        projectId: projectAId,
        membershipId: membershipId(viewerId),
        permissionId: permissionId("tasks.update"),
        scope: "project",
        effect: "allow",
        createdBy: ownerId,
      },
    ]);

    await assert.rejects(
      () =>
        authorize({
          userId: memberId,
          url: `/tasks/${taskA.id}`,
          organizationId,
          workspaceId,
          params: { id: taskA.id },
          permission: "tasks.update",
        }),
      ForbiddenException,
    );
    await authorize({
      userId: memberId,
      url: `/tasks/${taskB.id}`,
      organizationId,
      workspaceId,
      params: { id: taskB.id },
      permission: "tasks.update",
    });
    await authorize({
      userId: viewerId,
      url: `/tasks/${taskA.id}`,
      organizationId,
      workspaceId,
      params: { id: taskA.id },
      permission: "tasks.update",
    });
    await assert.rejects(
      () =>
        authorize({
          userId: viewerId,
          url: `/tasks/${taskB.id}`,
          organizationId,
          workspaceId,
          params: { id: taskB.id },
          permission: "tasks.update",
        }),
      ForbiddenException,
    );

    await assert.rejects(
      () =>
        authorize({
          userId: adminId,
          url: `/api/projects/${projectAId}/sprints/${sprintB.id}`,
          organizationId,
          workspaceId,
          params: { projectId: projectAId, sprintId: sprintB.id },
          permission: "sprints.view",
        }),
      ForbiddenException,
    );
    await assert.rejects(
      () =>
        authorize({
          userId: adminId,
          url: `/api/projects/${projectAId}/sprints/${sprintA.id}/analytics`,
          organizationId,
          workspaceId,
          params: { projectId: projectAId, sprintId: sprintA.id },
          permission: "sprints.view",
        }),
      ForbiddenException,
    );
    await authorize({
      userId: adminId,
      url: `/api/projects/${projectBId}/sprints/${sprintB.id}/analytics`,
      organizationId,
      workspaceId,
      params: { projectId: projectBId, sprintId: sprintB.id },
      permission: "sprints.view",
    });

    await assert.rejects(
      () =>
        authorize({
          userId: memberId,
          url: `/tasks/${siblingTask.id}`,
          organizationId,
          workspaceId,
          params: { id: siblingTask.id },
          permission: "tasks.update",
        }),
      NotFoundException,
    );
    await assert.rejects(
      () =>
        authorize({
          userId: memberId,
          url: `/tasks/${foreignTask.id}`,
          organizationId,
          workspaceId,
          params: { id: foreignTask.id },
          permission: "tasks.update",
        }),
      NotFoundException,
    );
    await assert.rejects(
      () =>
        authorize({
          userId: platformAdminId,
          url: `/tasks/${taskB.id}`,
          organizationId,
          workspaceId,
          params: { id: taskB.id },
          permission: "tasks.update",
        }),
      ForbiddenException,
    );
  });
});
