import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AutomationsController } from "./automations.controller.js";
import type { AuthenticatedRequest } from "./auth.guard.js";
import type { DatabaseTenantContext } from "@calmboard/database";

describe("automations controller actor identity and validation", () => {
  it("binds authenticated actorId on list and ignores conflicting client query values", async () => {
    let capturedContext: DatabaseTenantContext | undefined;
    const fakeRepo = {
      list: async () => [{ id: "auto-1", name: "Rule 1" }],
    };

    const controller = new AutomationsController((context) => {
      capturedContext = context;
      return fakeRepo as never;
    });

    const request = {
      auth: { userId: "trusted-user-123", sessionId: "sess-1" },
    } as AuthenticatedRequest;

    const result = await controller.list(request, "org-456", "ws-789");

    assert.equal(capturedContext?.actorId, "trusted-user-123");
    assert.equal(capturedContext?.organizationId, "org-456");
    assert.equal(capturedContext?.workspaceId, "ws-789");
    assert.deepEqual(result, [{ id: "auto-1", name: "Rule 1" }]);
  });

  it("binds authenticated actorId on create and rejects client-supplied actorId/userId overrides", async () => {
    let capturedContext: DatabaseTenantContext | undefined;
    let capturedInput: unknown;
    const fakeRepo = {
      create: async (input: unknown) => {
        capturedInput = input;
        return { id: "new-rule-id" };
      },
    };

    const controller = new AutomationsController((context) => {
      capturedContext = context;
      return fakeRepo as never;
    });

    const request = {
      auth: { userId: "authenticated-lead-user", sessionId: "sess-2" },
    } as AuthenticatedRequest;

    const body = {
      organizationId: "org-alpha",
      workspaceId: "ws-beta",
      actorId: "malicious-spoofed-actor",
      userId: "malicious-spoofed-user",
      name: "Triage Urgent",
      trigger: "task_created",
      actions: { setPriority: "urgent" },
    };

    const created = await controller.create(request, body);

    assert.equal(capturedContext?.actorId, "authenticated-lead-user");
    assert.equal(capturedContext?.organizationId, "org-alpha");
    assert.equal(capturedContext?.workspaceId, "ws-beta");
    assert.deepEqual(created, { id: "new-rule-id" });
    assert.ok(capturedInput);
  });

  it("binds authenticated actorId on update and rejects client-supplied actorId/userId overrides", async () => {
    let capturedContext: DatabaseTenantContext | undefined;
    let capturedId: string | undefined;
    const fakeRepo = {
      update: async (id: string) => {
        capturedId = id;
        return { id, name: "Updated Rule" };
      },
    };

    const controller = new AutomationsController((context) => {
      capturedContext = context;
      return fakeRepo as never;
    });

    const request = {
      auth: { userId: "authenticated-manager-user", sessionId: "sess-3" },
    } as AuthenticatedRequest;

    const body = {
      id: "rule-uuid-99",
      organizationId: "org-alpha",
      workspaceId: "ws-beta",
      actorId: "spoofed-actor-id",
      userId: "spoofed-user-id",
      name: "Updated Rule",
      enabled: false,
    };

    const updated = await controller.update(request, body);

    assert.equal(capturedContext?.actorId, "authenticated-manager-user");
    assert.equal(capturedContext?.organizationId, "org-alpha");
    assert.equal(capturedContext?.workspaceId, "ws-beta");
    assert.equal(capturedId, "rule-uuid-99");
    assert.deepEqual(updated, { id: "rule-uuid-99", name: "Updated Rule" });
  });

  it("requires organizationId and workspaceId in create body", () => {
    const controller = new AutomationsController();
    const request = {
      auth: { userId: "trusted-user", sessionId: "session-1" },
    } as AuthenticatedRequest;

    assert.throws(
      () =>
        controller.create(request, {
          name: "Test Rule",
          trigger: "task_created",
          workspaceId: "ws-1",
        }),
      /organizationId is required/,
    );

    assert.throws(
      () =>
        controller.create(request, {
          name: "Test Rule",
          trigger: "task_created",
          organizationId: "org-1",
        }),
      /workspaceId is required/,
    );
  });
});
