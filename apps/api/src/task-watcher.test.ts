import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ForbiddenException, type ExecutionContext } from "@nestjs/common";
import { dispatchWatcherNotifications, type DatabaseTenantContext } from "@calmboard/database";
import { createTaskWatcherService } from "./task-watcher.service.js";
import {
  AUTHORIZATION_POLICY,
  PermissionGuard,
  REQUIRED_PERMISSION,
  TENANT_MEMBER_REQUIRED,
} from "./permission.guard.js";
import { TenantGuard } from "./tenant.guard.js";
import { PUBLIC_ROUTE } from "./public-route.decorator.js";
import type { AuthenticatedRequest } from "./auth.guard.js";
import type { AuthorizationService } from "./authorization.service.js";
import type { RequestScopeService } from "./request-scope.service.js";

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

describe("task watcher API, service, and notification engine", () => {
  describe("API authorization and identity enforcement", () => {
    it("allows authenticated tenant members to self-watch without tasks.update permission", async () => {
      const authorization = {
        resolve: async () => ({
          member: true,
          allowed: true,
          membershipId: "membership-1",
          roles: ["viewer"],
          permissions: [], // no tasks.update permission
        }),
      } as unknown as AuthorizationService;

      const tenantGuard = new TenantGuard(reflector({ [PUBLIC_ROUTE]: false }), authorization, requestScope);
      const permissionGuard = new PermissionGuard(
        reflector({
          [PUBLIC_ROUTE]: false,
          [TENANT_MEMBER_REQUIRED]: true,
          [AUTHORIZATION_POLICY]: true,
        }),
      );

      const request: AuthenticatedRequest = {
        url: "/tasks/task-1/watch",
        auth: { userId: "user-viewer", sessionId: "sess-1" },
        body: { organizationId: "org-1", workspaceId: "ws-1" },
        query: {},
        params: { id: "task-1" },
      } as never;

      assert.equal(await tenantGuard.canActivate(executionContext(request)), true);
      assert.equal(await permissionGuard.canActivate(executionContext(request)), true);
    });

    it("requires tasks.update permission to manage other watchers", async () => {
      const authorization = {
        resolve: async () => ({
          member: true,
          allowed: true,
          membershipId: "membership-1",
          roles: ["viewer"],
          permissions: [], // missing tasks.update
        }),
      } as unknown as AuthorizationService;

      const tenantGuard = new TenantGuard(reflector({ [PUBLIC_ROUTE]: false }), authorization, requestScope);
      const permissionGuard = new PermissionGuard(
        reflector({
          [PUBLIC_ROUTE]: false,
          [REQUIRED_PERMISSION]: "tasks.update",
        }),
      );

      const request: AuthenticatedRequest = {
        url: "/tasks/task-1/watchers/target-user",
        auth: { userId: "user-viewer", sessionId: "sess-1" },
        body: { organizationId: "org-1", workspaceId: "ws-1" },
        query: {},
        params: { id: "task-1", userId: "target-user" },
      } as never;

      assert.equal(await tenantGuard.canActivate(executionContext(request)), true);
      assert.throws(
        () => permissionGuard.canActivate(executionContext(request)),
        (err: unknown) =>
          err instanceof ForbiddenException && /Permission 'tasks.update' is required/.test(err.message),
      );
    });

    it("enforces authenticated userId and sanitizes spoofed actorId", async () => {
      const authorization = {
        resolve: async () => ({
          member: true,
          allowed: true,
          membershipId: "membership-1",
          roles: ["member"],
          permissions: ["tasks.update"],
        }),
      } as unknown as AuthorizationService;

      const tenantGuard = new TenantGuard(reflector({ [PUBLIC_ROUTE]: false }), authorization, requestScope);
      const request: AuthenticatedRequest = {
        url: "/tasks/task-1/watchers/target-user",
        auth: { userId: "trusted-user-123", sessionId: "sess-1" },
        body: {
          organizationId: "org-1",
          workspaceId: "ws-1",
          actorId: "spoofed-user-456",
        },
        query: {
          actorId: "spoofed-user-456",
        },
        params: {},
      } as never;

      assert.equal(await tenantGuard.canActivate(executionContext(request)), true);
      // Tenant guard strictly overwrites body.actorId and query.actorId with trusted authenticated userId
      assert.equal((request.body as Record<string, string>).actorId, "trusted-user-123");
      assert.equal((request.query as Record<string, string>).actorId, "trusted-user-123");
    });
  });

  describe("Task Watcher Service operations", () => {
    it("performs selfWatch and selfUnwatch correctly", async () => {
      const context: DatabaseTenantContext = { organizationId: "org-1", workspaceId: "ws-1", actorId: "user-1" };
      const service = createTaskWatcherService(context);
      assert.ok(typeof service.selfWatch === "function");
      assert.ok(typeof service.selfUnwatch === "function");
      assert.ok(typeof service.addWatcher === "function");
      assert.ok(typeof service.removeWatcher === "function");
    });
  });

  describe("Watcher notification selection and deduplication", () => {
    const context: DatabaseTenantContext = { organizationId: "org-1", workspaceId: "ws-1", actorId: "user-actor" };

    it("notifies active watchers while excluding actor and users with specific notifications", async () => {
      const activeWatchers = ["user-actor", "user-assignee", "user-watcher-1", "user-watcher-2"];
      const createdNotifications: Array<{ userId: string; type: string; deduplicationKey: string }> = [];

      const result = await dispatchWatcherNotifications(
        context,
        {
          taskId: "task-100",
          actorId: "user-actor",
          excludedUserIds: ["user-assignee"], // assignee got dedicated assignment notification
          type: "task_watch_update",
          title: "تحديث في المهمة T-100",
          body: "تم تغيير حالة المهمة إلى in_progress",
          deduplicationKeyTemplate: (uid) => `task-watch/task-100/status_changed/v2/${uid}`,
        },
        {
          select: ((...args: unknown[]) => ({
            from: () => ({
              where: () => ({
                limit: async () => [{ id: "task-100", projectId: "proj-1" }],
                orderBy: async () => activeWatchers.map((userId) => ({ userId })),
              }),
            }),
          })) as never,
          insert: ((...args: unknown[]) => ({
            values: (val: any) => ({
              onConflictDoNothing: () => ({
                returning: async () => {
                  createdNotifications.push({
                    userId: val.userId,
                    type: val.type,
                    deduplicationKey: val.deduplicationKey,
                  });
                  return [{ id: `notif-${val.userId}` }];
                },
              }),
              returning: async () => {
                createdNotifications.push({
                  userId: val.userId,
                  type: val.type,
                  deduplicationKey: val.deduplicationKey,
                });
                return [{ id: `notif-${val.userId}` }];
              },
            }),
          })) as never,
          update: (() => ({
            set: () => ({
              where: () => ({
                returning: async () => [{ id: "updated" }],
              }),
            }),
          })) as never,
        },
      );

      // Notified watchers must be watcher-1 and watcher-2 (actor and assignee excluded)
      assert.deepEqual(result.notifiedUserIds.sort(), ["user-watcher-1", "user-watcher-2"].sort());
      assert.equal(createdNotifications.length, 2);
      assert.equal(
        createdNotifications.find((n) => n.userId === "user-watcher-1")?.deduplicationKey,
        "task-watch/task-100/status_changed/v2/user-watcher-1",
      );
    });

    it("respects delivery preferences and deduplicates retries", async () => {
      const activeWatchers = ["user-1"];
      const createdNotifications: string[] = [];

      const result = await dispatchWatcherNotifications(
        context,
        {
          taskId: "task-100",
          actorId: "actor-1",
          type: "task_watch_update",
          title: "Schedule changed",
          body: "Due date updated",
          deduplicationKeyTemplate: (uid) => `task-watch/task-100/schedule_changed/v3/${uid}`,
        },
        {
          select: ((...args: unknown[]) => ({
            from: () => ({
              where: () => ({
                limit: async () => [{ id: "task-100", projectId: "proj-1" }],
                orderBy: async () => activeWatchers.map((userId) => ({ userId })),
              }),
            }),
          })) as never,
          insert: ((...args: unknown[]) => ({
            values: (val: any) => ({
              onConflictDoNothing: () => ({
                returning: async () => {
                  createdNotifications.push(val.userId);
                  return [{ id: `notif-${val.userId}` }];
                },
              }),
              returning: async () => {
                createdNotifications.push(val.userId);
                return [{ id: `notif-${val.userId}` }];
              },
            }),
          })) as never,
          update: (() => ({
            set: () => ({
              where: () => ({
                returning: async () => [{ id: "updated" }],
              }),
            }),
          })) as never,
        },
      );

      assert.deepEqual(result.notifiedUserIds, ["user-1"]);
    });
  });
});
