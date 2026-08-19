import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ForbiddenException, type ExecutionContext } from "@nestjs/common";
import { dispatchWatcherNotifications, type DatabaseTenantContext } from "@calmboard/database";
import { createTaskWatcherService } from "./task-watcher.service.js";
import { deriveWatcherRelevantTaskChanges } from "./task.service.js";
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

  describe("Task Watcher Service operations and idempotent activity logging", () => {
    it("proves actual selfWatch, repeat selfWatch, selfUnwatch, repeat selfUnwatch and managed watchers", async () => {
      const watchingState = new Set<string>();

      const mockFollowersRepo = {
        async watch(taskId: string, userId: string) {
          if (watchingState.has(userId)) {
            return { changed: false };
          }
          watchingState.add(userId);
          return { changed: true };
        },
        async unwatch(taskId: string, userId: string) {
          if (!watchingState.has(userId)) {
            return { changed: false };
          }
          watchingState.delete(userId);
          return { changed: true };
        },
      };

      const context: DatabaseTenantContext = { organizationId: "org-1", workspaceId: "ws-1", actorId: "user-1" };
      const service = createTaskWatcherService(context, mockFollowersRepo as never);

      // 1. Initial selfWatch -> relation created, changed = true
      const watchRes1 = await service.selfWatch("task-100", "user-1");
      assert.deepEqual(watchRes1, { ok: true, watching: true, changed: true });
      assert.ok(watchingState.has("user-1"));

      // 2. Repeat selfWatch -> changed = false (no duplicate, no activity logged)
      const watchRes2 = await service.selfWatch("task-100", "user-1");
      assert.deepEqual(watchRes2, { ok: true, watching: true, changed: false });

      // 3. Initial selfUnwatch -> relation closed, changed = true
      const unwatchRes1 = await service.selfUnwatch("task-100", "user-1");
      assert.deepEqual(unwatchRes1, { ok: true, watching: false, changed: true });
      assert.ok(!watchingState.has("user-1"));

      // 4. Repeat selfUnwatch -> changed = false (no duplicate, no activity logged)
      const unwatchRes2 = await service.selfUnwatch("task-100", "user-1");
      assert.deepEqual(unwatchRes2, { ok: true, watching: false, changed: false });

      // 5. Managed addWatcher and removeWatcher
      const addRes1 = await service.addWatcher("task-100", "user-2", "user-1");
      assert.deepEqual(addRes1, { ok: true, watching: true, changed: true });
      assert.ok(watchingState.has("user-2"));

      const addRes2 = await service.addWatcher("task-100", "user-2", "user-1");
      assert.deepEqual(addRes2, { ok: true, watching: true, changed: false });

      const removeRes1 = await service.removeWatcher("task-100", "user-2", "user-1");
      assert.deepEqual(removeRes1, { ok: true, watching: false, changed: true });
      assert.ok(!watchingState.has("user-2"));

      const removeRes2 = await service.removeWatcher("task-100", "user-2", "user-1");
      assert.deepEqual(removeRes2, { ok: true, watching: false, changed: false });
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

    it("promoted Lead B receives specific assignment recipient status and is excluded from generic watcher update", async () => {
      // User B was a contributor, now promoted to Lead
      const before = {
        assigneeId: "user-A",
        assigneeIds: ["user-A", "user-B"],
      };
      const after = {
        assigneeId: "user-B",
        assigneeIds: ["user-A", "user-B"],
        serial: "T-100",
      };

      const changes = deriveWatcherRelevantTaskChanges(before, after);
      assert.deepEqual(changes.specificAssignmentRecipientIds, ["user-B"]);

      // Watchers of the task: user-A, user-B (if user-B was watching), user-watcher-1
      const activeWatchers = ["user-A", "user-B", "user-watcher-1"];
      const mockDb = createMockDb(activeWatchers);

      const result = await dispatchWatcherNotifications(
        context,
        {
          taskId: "task-100",
          actorId: "user-actor",
          excludedUserIds: changes.specificAssignmentRecipientIds, // user-B excluded from generic watcher notification
          type: "task_watch_update",
          title: "تحديث في المهمة T-100",
          body: changes.body,
          deduplicationKeyTemplate: (uid) => `task-watch/task-100/${changes.event}/v2/${uid}`,
        },
        mockDb as never,
      );

      // user-B must NOT receive generic watcher notification
      assert.ok(!result.notifiedUserIds.includes("user-B"), "Promoted Lead B must NOT receive generic watcher update");
      assert.ok(result.notifiedUserIds.includes("user-A"));
      assert.ok(result.notifiedUserIds.includes("user-watcher-1"));
    });
  });

  describe("Schedule and Assignment change detection invariants using production helper", () => {
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
        serial: "T-1",
      };

      const changes = deriveWatcherRelevantTaskChanges(before, after);
      assert.equal(changes.scheduleChanged, false);
      assert.equal(changes.statusChanged, false);
      assert.equal(changes.priorityChanged, false);
      assert.equal(changes.assigneesChanged, false);
      assert.equal(changes.hasChanges, false);
      assert.deepEqual(changes.specificAssignmentRecipientIds, []);
    });

    it("actual startDate change produces scheduleChanged = true and event = schedule_changed", () => {
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
        serial: "T-1",
      };

      const changes = deriveWatcherRelevantTaskChanges(before, after);
      assert.equal(changes.scheduleChanged, true);
      assert.equal(changes.event, "schedule_changed");
      assert.equal(changes.hasChanges, true);
    });

    it("actual dueDate change produces scheduleChanged = true and event = schedule_changed", () => {
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
        serial: "T-1",
      };

      const changes = deriveWatcherRelevantTaskChanges(before, after);
      assert.equal(changes.scheduleChanged, true);
      assert.equal(changes.event, "schedule_changed");
      assert.equal(changes.hasChanges, true);
    });

    it("clearing dueDate (set to null) produces scheduleChanged = true and event = schedule_changed", () => {
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
        serial: "T-1",
      };

      const changes = deriveWatcherRelevantTaskChanges(before, after);
      assert.equal(changes.scheduleChanged, true);
      assert.equal(changes.event, "schedule_changed");
      assert.equal(changes.hasChanges, true);
    });

    it("lead swap with identical assignee set produces assigneesChanged = true and specific recipient", () => {
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
        serial: "T-1",
      };

      const changes = deriveWatcherRelevantTaskChanges(before, after);
      assert.equal(changes.primaryChanged, true);
      assert.equal(changes.executionAssigneesChanged, false);
      assert.equal(changes.assigneesChanged, true);
      assert.deepEqual(changes.addedAssigneeIds, []);
      assert.deepEqual(changes.specificAssignmentRecipientIds, ["user-B"]);
      assert.equal(changes.event, "assignees_changed");
    });

    it("unchanged assignment produces assigneesChanged = false and empty specificAssignmentRecipientIds", () => {
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
        assigneeId: "user-A",
        assigneeIds: ["user-A", "user-B"],
        startDate: null,
        dueDate: null,
        serial: "T-1",
      };

      const changes = deriveWatcherRelevantTaskChanges(before, after);
      assert.equal(changes.primaryChanged, false);
      assert.equal(changes.executionAssigneesChanged, false);
      assert.equal(changes.assigneesChanged, false);
      assert.deepEqual(changes.specificAssignmentRecipientIds, []);
      assert.equal(changes.hasChanges, false);
    });
  });
});
