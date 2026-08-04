import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Server } from "socket.io";
import { parseRealtimeScope, type RealtimeAccessService } from "./realtime-access.service.js";
import { RealtimeGateway } from "./realtime.gateway.js";
import { realtimeRooms, RealtimeService } from "./realtime.service.js";
import type { AuthService } from "./auth.service.js";

describe("realtime tenant isolation", () => {
  it("builds non-overlapping organization, workspace, project, and task rooms", () => {
    const first = realtimeRooms({
      organizationId: "organization-a",
      workspaceId: "workspace-1",
      projectId: "project-1",
      taskId: "task-1",
    });
    const second = realtimeRooms({
      organizationId: "organization-b",
      workspaceId: "workspace-1",
      projectId: "project-1",
      taskId: "task-1",
    });
    assert.equal(
      first.some((room) => second.includes(room)),
      false,
    );
    assert.deepEqual(first, [
      "organization:organization-a",
      "workspace:organization-a:workspace-1",
      "project:organization-a:workspace-1:project-1",
      "task:organization-a:workspace-1:task-1",
    ]);
  });

  it("rejects incomplete and malformed room scopes before database access", () => {
    assert.throws(
      () => parseRealtimeScope({ organizationId: "organization-a", projectId: "project-1" }),
      /workspace scope is required/,
    );
    assert.throws(() => parseRealtimeScope({ organizationId: "" }), /organizationId/);
    assert.deepEqual(parseRealtimeScope({ organizationId: "organization-a", workspaceId: "workspace-a" }), {
      organizationId: "organization-a",
      workspaceId: "workspace-a",
      projectId: undefined,
      taskId: undefined,
    });
  });

  it("does not join rooms when tenant authorization rejects the requested organization", async () => {
    const joined: string[] = [];
    const socket = {
      data: { user: { id: "user-1", name: "User" }, subscriptions: {} },
      join: async (rooms: string[]) => {
        joined.push(...rooms);
      },
      leave: async () => undefined,
    };
    const access = {
      authorize: async (_userId: string, input: unknown) => {
        const scope = parseRealtimeScope(input);
        if (scope.organizationId !== "organization-a") throw new Error("denied");
        return scope;
      },
    };
    const realtime = {
      currentVersion: async () => 3,
      presence: async () => [],
      publishPresence: async () => undefined,
    };
    const gateway = new RealtimeGateway(
      {} as AuthService,
      access as RealtimeAccessService,
      realtime as unknown as RealtimeService,
    );

    const allowed = await gateway.join(socket as never, {
      organizationId: "organization-a",
      workspaceId: "workspace-a",
    });
    assert.equal(allowed.ok, true);
    assert.deepEqual(joined, ["organization:organization-a", "workspace:organization-a:workspace-a"]);

    const beforeDenied = [...joined];
    const denied = await gateway.join(socket as never, {
      organizationId: "organization-b",
      workspaceId: "workspace-a",
    });
    assert.deepEqual(denied, { ok: false, error: "Realtime tenant access is denied" });
    assert.deepEqual(joined, beforeDenied);
  });

  it("publishes a versioned invalidation only to rooms from the committed tenant context", async () => {
    const previousRedisUrl = process.env.REDIS_URL;
    delete process.env.REDIS_URL;
    const emissions: Array<{ rooms: string[]; event: string; payload: Record<string, unknown> }> = [];
    const server = {
      to(rooms: string[]) {
        return {
          emit(event: string, payload: Record<string, unknown>) {
            emissions.push({ rooms, event, payload });
          },
        };
      },
    } as unknown as Server;
    const service = new RealtimeService();
    service.attachServer(server);
    try {
      await service.publishHttpMutation(
        {
          method: "PATCH",
          url: "/tasks",
          body: {
            organizationId: "untrusted-organization",
            workspaceId: "untrusted-workspace",
            projectId: "project-a",
            id: "task-a",
            title: "secret task title",
          },
        } as never,
        {
          organizationId: "trusted-organization",
          workspaceId: "trusted-workspace",
          actorId: "user-1",
        },
      );
    } finally {
      await service.onModuleDestroy();
      if (previousRedisUrl === undefined) delete process.env.REDIS_URL;
      else process.env.REDIS_URL = previousRedisUrl;
    }

    assert.equal(emissions.length, 1);
    assert.deepEqual(emissions[0]?.rooms, [
      "organization:trusted-organization",
      "workspace:trusted-organization:trusted-workspace",
      "project:trusted-organization:trusted-workspace:project-a",
      "task:trusted-organization:trusted-workspace:task-a",
    ]);
    assert.equal(emissions[0]?.event, "realtime:event");
    assert.equal(emissions[0]?.payload.schemaVersion, 1);
    assert.equal(typeof emissions[0]?.payload.version, "number");
    assert.equal(JSON.stringify(emissions[0]?.payload).includes("secret task title"), false);
  });
});
