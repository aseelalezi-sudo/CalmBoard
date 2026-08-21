import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException, ForbiddenException, type ExecutionContext } from "@nestjs/common";
import type { AuthorizationService } from "./authorization.service";
import { AUTHORIZATION_POLICY, PermissionGuard, REQUIRED_PERMISSION, TENANT_MEMBER_REQUIRED } from "./permission.guard";
import { PLATFORM_ADMIN_REQUIRED, PlatformAdminGuard } from "./platform-admin.guard";
import type { PlatformAdministrationService } from "./platform-administration.service";
import { PUBLIC_ROUTE } from "./public-route.decorator";
import { TenantGuard } from "./tenant.guard";
import type { RequestScopeService } from "./request-scope.service";

function reflector(values: Record<string, unknown>) {
  return { getAllAndOverride: (key: string) => values[key] } as never;
}

function executionContext(request: unknown) {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
  } as unknown as ExecutionContext;
}

const requestScope = {
  trustedProjectId: async () => undefined,
} as unknown as RequestScopeService;

describe("tenant and permission guards", () => {
  it("derives the actor from the session and attaches database authorization", async () => {
    const calls: unknown[][] = [];
    const authorization = {
      resolve: async (...args: unknown[]) => {
        calls.push(args);
        return {
          member: true,
          allowed: true,
          membershipId: "membership-1",
          roles: ["manager"],
          permissions: ["projects.create"],
        };
      },
    } as unknown as AuthorizationService;
    const guard = new TenantGuard(reflector({ [PUBLIC_ROUTE]: false }), authorization, requestScope);
    const request = {
      url: "/projects",
      auth: { userId: "trusted-user", sessionId: "session-1" },
      body: {
        organizationId: "organization-1",
        workspaceId: "workspace-1",
        actorId: "spoofed-user",
        userId: "spoofed-user",
        authorId: "spoofed-user",
      },
      query: {},
      params: {},
    };
    assert.equal(await guard.canActivate(executionContext(request)), true);
    assert.equal(request.body.actorId, "trusted-user");
    assert.equal(request.body.userId, "trusted-user");
    assert.equal(request.body.authorId, "trusted-user");
    assert.deepEqual(calls, [["trusted-user", { organizationId: "organization-1", workspaceId: "workspace-1" }]]);
    assert.deepEqual((request as unknown as { authorization: { permissions: string[] } }).authorization.permissions, [
      "projects.create",
    ]);
  });

  it("rejects conflicting tenant input and users without active membership", async () => {
    const authorization = {
      resolve: async () => ({ member: false, allowed: false, roles: [], permissions: [] }),
    } as unknown as AuthorizationService;
    const guard = new TenantGuard(reflector({ [PUBLIC_ROUTE]: false }), authorization, requestScope);
    await assert.rejects(
      () =>
        guard.canActivate(
          executionContext({
            url: "/projects",
            auth: { userId: "user-1", sessionId: "session-1" },
            body: { organizationId: "organization-1", workspaceId: "workspace-1" },
            query: { organizationId: "organization-2" },
            params: {},
          }),
        ),
      BadRequestException,
    );
    await assert.rejects(
      () =>
        guard.canActivate(
          executionContext({
            url: "/projects",
            auth: { userId: "user-1", sessionId: "session-1" },
            body: { organizationId: "organization-1", workspaceId: "workspace-1" },
            query: {},
            params: {},
          }),
        ),
      ForbiddenException,
    );
  });

  it("enforces route permission metadata from the tenant decision", () => {
    const guard = new PermissionGuard(
      reflector({ [PUBLIC_ROUTE]: false, [REQUIRED_PERMISSION]: "billing.manage", [AUTHORIZATION_POLICY]: true }),
    );
    assert.throws(
      () => guard.canActivate(executionContext({ method: "POST", authorization: { permissions: ["data.export"] } })),
      ForbiddenException,
    );
    assert.equal(
      guard.canActivate(executionContext({ method: "POST", authorization: { permissions: ["billing.manage"] } })),
      true,
    );
  });

  it("fails closed when any protected route has no authorization policy", () => {
    const guard = new PermissionGuard(reflector({ [PUBLIC_ROUTE]: false }));
    assert.throws(() => guard.canActivate(executionContext({ method: "PATCH" })), ForbiddenException);
    assert.throws(() => guard.canActivate(executionContext({ method: "GET" })), ForbiddenException);
  });

  it("requires an active tenant decision for tenant-member routes", () => {
    const guard = new PermissionGuard(
      reflector({
        [PUBLIC_ROUTE]: false,
        [AUTHORIZATION_POLICY]: true,
        [TENANT_MEMBER_REQUIRED]: true,
      }),
    );
    assert.throws(
      () => guard.canActivate(executionContext({ method: "GET", authorization: { member: false, permissions: [] } })),
      ForbiddenException,
    );
    assert.equal(
      guard.canActivate(executionContext({ method: "GET", authorization: { member: true, permissions: [] } })),
      true,
    );
  });

  it("keeps platform administration separate from organization roles", async () => {
    const service = {
      isPlatformAdmin: async (userId: string) => userId === "platform-admin",
    } as PlatformAdministrationService;
    const guard = new PlatformAdminGuard(reflector({ [PLATFORM_ADMIN_REQUIRED]: true }), service);
    await assert.rejects(
      () => guard.canActivate(executionContext({ auth: { userId: "organization-owner", sessionId: "session-1" } })),
      ForbiddenException,
    );
    assert.equal(
      await guard.canActivate(executionContext({ auth: { userId: "platform-admin", sessionId: "session-2" } })),
      true,
    );
  });

  it("sanitizes query parameters to prevent user ID spoofing", async () => {
    const authorization = {
      resolve: async () => ({
        member: true,
        allowed: true,
        membershipId: "membership-1",
        roles: ["member"],
        permissions: ["tasks.read"],
      }),
    } as unknown as AuthorizationService;
    const guard = new TenantGuard(reflector({ [PUBLIC_ROUTE]: false }), authorization, requestScope);
    const request = {
      url: "/notifications",
      auth: { userId: "authenticated-user-id", sessionId: "session-1" },
      body: {},
      query: {
        organizationId: "org-1",
        workspaceId: "ws-1",
        userId: "victim-user-id",
        actorId: "victim-user-id",
      },
      params: {},
    };
    assert.equal(await guard.canActivate(executionContext(request)), true);
    assert.equal(request.query.actorId, "authenticated-user-id");
    assert.equal(request.query.userId, "authenticated-user-id");
  });
});
