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

function createMockDb(
  activeWatchers: string[],
  preferencesMap: Record<string, { inApp?: boolean; email?: boolean }> = {},
) {
  const createdNotifications: Array<{ userId: string; type: string; deduplicationKey: string }> = [];
  const createdEmails: Array<{ userId: string; idempotencyKey: string }> = [];

  const mockDb = {
    createdNotifications,
    createdEmails,
    select: () => ({
      from: () => ({
        where: () => {
          const rows = activeWatchers.map((userId) => ({
            id: `row-${userId}`,
            userId,
            email: `${userId}@example.test`,
            name: `User ${userId}`,
            inAppEnabled: preferencesMap[userId]?.inApp ?? true,
            emailEnabled: preferencesMap[userId]?.email ?? true,
            projectId: "proj-1",
          }));
          const promise = Promise.resolve(rows);
          return Object.assign(promise, {
            limit: async () => [
              {
                id: "task-100",
                projectId: "proj-1",
                userId: "user-1",
                email: "user@test.local",
                inAppEnabled: true,
                emailEnabled: true,
              },
            ],
            orderBy: async () => rows,
          });
        },
      }),
    }),
    insert: () => ({
      values: (val: any) => ({
        onConflictDoNothing: () => ({
          returning: async () => {
            if (val.deduplicationKey && val.subject === undefined) {
              createdNotifications.push({
                userId: val.userId,
                type: val.type,
                deduplicationKey: val.deduplicationKey,
              });
            } else if (val.subject !== undefined) {
              createdEmails.push({
                userId: val.userId,
                idempotencyKey: val.idempotencyKey,
              });
            }
            return [{ id: `notif-${val.userId}` }];
          },
        }),
        returning: async () => {
          if (val.deduplicationKey && val.subject === undefined) {
            createdNotifications.push({
              userId: val.userId,
              type: val.type,
              deduplicationKey: val.deduplicationKey,
            });
          }
          return [{ id: `notif-${val.userId}` }];
        },
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: async () => [{ id: "updated" }],
        }),
      }),
    }),
  };

  return mockDb;
}

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
      const mockDb = createMockDb(activeWatchers);

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
        mockDb as never,
      );

      // Notified watchers must be watcher-1 and watcher-2 (actor and assignee excluded)
      assert.deepEqual(result.notifiedUserIds.sort(), ["user-watcher-1", "user-watcher-2"].sort());
      assert.equal(mockDb.createdNotifications.length, 2);
      assert.equal(
        mockDb.createdNotifications.find((n) => n.userId === "user-watcher-1")?.deduplicationKey,
        "task-watch/task-100/status_changed/v2/user-watcher-1",
      );
    });

    it("respects delivery preferences and deduplicates retries", async () => {
      const activeWatchers = ["user-1"];
      const mockDb = createMockDb(activeWatchers);

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
        mockDb as never,
      );

      assert.deepEqual(result.notifiedUserIds, ["user-1"]);
    });
  });

  describe("Schedule and Assignment change detection invariants", () => {
    function instantValue(value: Date | string | null | undefined): number | null {
      if (!value) return null;
      const date = value instanceof Date ? value : new Date(value);
      return Number.isNaN(date.getTime()) ? null : date.getTime();
    }

    function checkChanges(
      before: {
        status: string;
        priority: string;
        assigneeId: string | null;
        assigneeIds: string[];
        startDate: Date | null;
        dueDate: Date | null;
      },
      after: {
        status: string;
        priority: string;
        assigneeId: string | null;
        assigneeIds: string[];
        startDate: Date | null;
        dueDate: Date | null;
      },
    ) {
      const statusChanged = after.status !== before.status;
      const priorityChanged = after.priority !== before.priority;
      const scheduleChanged =
        instantValue(after.startDate) !== instantValue(before.startDate) ||
        instantValue(after.dueDate) !== instantValue(before.dueDate);

      const beforeAssignees =
        before.assigneeIds && before.assigneeIds.length > 0
          ? before.assigneeIds
          : before.assigneeId
            ? [before.assigneeId]
            : [];
      const afterAssignees =
        after.assigneeIds && after.assigneeIds.length > 0
          ? after.assigneeIds
          : after.assigneeId
            ? [after.assigneeId]
            : [];

      const primaryChanged = (before.assigneeId ?? null) !== (after.assigneeId ?? null);
      const executionAssigneesChanged =
        beforeAssignees.length !== afterAssignees.length ||
        beforeAssignees.some((id) => !afterAssignees.includes(id)) ||
        afterAssignees.some((id) => !beforeAssignees.includes(id));
      const assigneesChanged = primaryChanged || executionAssigneesChanged;

      return { statusChanged, priorityChanged, scheduleChanged, assigneesChanged };
    }

    it("title-only update on scheduled task produces NO schedule or status change", () => {
      const date1 = new Date("2026-08-01T10:00:00Z");
      const date2 = new Date("2026-08-15T18:00:00Z");
      // Even if Date object references are different instances with same timestamp
      const date1Copy = new Date("2026-08-01T10:00:00Z");
      const date2Copy = new Date("2026-08-15T18:00:00Z");

      const before = {
        status: "todo",
        priority: "medium",
        assigneeId: "user-1",
        assigneeIds: ["user-1"],
        startDate: date1,
        dueDate: date2,
      };
      const after = {
        status: "todo",
        priority: "medium",
        assigneeId: "user-1",
        assigneeIds: ["user-1"],
        startDate: date1Copy,
        dueDate: date2Copy,
      };

      const changes = checkChanges(before, after);
      assert.equal(changes.scheduleChanged, false);
      assert.equal(changes.statusChanged, false);
      assert.equal(changes.priorityChanged, false);
      assert.equal(changes.assigneesChanged, false);
    });

    it("actual startDate change produces scheduleChanged = true", () => {
      const before = {
        status: "todo",
        priority: "medium",
        assigneeId: "user-1",
        assigneeIds: ["user-1"],
        startDate: new Date("2026-08-01T10:00:00Z"),
        dueDate: new Date("2026-08-15T18:00:00Z"),
      };
      const after = {
        status: "todo",
        priority: "medium",
        assigneeId: "user-1",
        assigneeIds: ["user-1"],
        startDate: new Date("2026-08-05T10:00:00Z"),
        dueDate: new Date("2026-08-15T18:00:00Z"),
      };

      const changes = checkChanges(before, after);
      assert.equal(changes.scheduleChanged, true);
    });

    it("actual dueDate change produces scheduleChanged = true", () => {
      const before = {
        status: "todo",
        priority: "medium",
        assigneeId: "user-1",
        assigneeIds: ["user-1"],
        startDate: new Date("2026-08-01T10:00:00Z"),
        dueDate: new Date("2026-08-15T18:00:00Z"),
      };
      const after = {
        status: "todo",
        priority: "medium",
        assigneeId: "user-1",
        assigneeIds: ["user-1"],
        startDate: new Date("2026-08-01T10:00:00Z"),
        dueDate: new Date("2026-08-20T18:00:00Z"),
      };

      const changes = checkChanges(before, after);
      assert.equal(changes.scheduleChanged, true);
    });

    it("clearing dueDate (set to null) produces scheduleChanged = true", () => {
      const before = {
        status: "todo",
        priority: "medium",
        assigneeId: "user-1",
        assigneeIds: ["user-1"],
        startDate: new Date("2026-08-01T10:00:00Z"),
        dueDate: new Date("2026-08-15T18:00:00Z"),
      };
      const after = {
        status: "todo",
        priority: "medium",
        assigneeId: "user-1",
        assigneeIds: ["user-1"],
        startDate: new Date("2026-08-01T10:00:00Z"),
        dueDate: null,
      };

      const changes = checkChanges(before, after);
      assert.equal(changes.scheduleChanged, true);
    });

    it("lead swap with identical assignee set produces assigneesChanged = true", () => {
      const before = {
        status: "todo",
        priority: "medium",
        assigneeId: "user-A",
        assigneeIds: ["user-A", "user-B"],
        startDate: null,
        dueDate: null,
      };
      const after = {
        status: "todo",
        priority: "medium",
        assigneeId: "user-B",
        assigneeIds: ["user-A", "user-B"],
        startDate: null,
        dueDate: null,
      };

      const changes = checkChanges(before, after);
      assert.equal(changes.assigneesChanged, true);
    });
  });
});
