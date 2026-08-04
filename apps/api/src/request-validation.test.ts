import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseCreateAutomationInput,
  parseCreateCustomFieldInput,
  parseInviteMemberInput,
  parseMembershipRoleUpdate,
  parseUpdateAutomationInput,
  requiredIdempotencyKey,
  tenantContext,
} from "./request-validation.js";

describe("API request validation", () => {
  it("requires a complete tenant scope", () => {
    assert.deepEqual(tenantContext("org-1", "workspace-1", "user-1"), {
      organizationId: "org-1",
      workspaceId: "workspace-1",
      actorId: "user-1",
    });
    assert.throws(() => tenantContext("org-1", ""), /workspaceId is required/);
    assert.equal(requiredIdempotencyKey("request-12345678"), "request-12345678");
    assert.throws(() => requiredIdempotencyKey("short"), /between 8 and 255/);
  });

  it("accepts allow-listed automation values and rejects arbitrary actions", () => {
    assert.deepEqual(
      parseCreateAutomationInput({
        name: "Assign urgent work",
        trigger: "task_created",
        conditions: { priority: "urgent" },
        actions: { assignTo: "user-1", notify: "assignee" },
        enabled: true,
      }),
      {
        name: "Assign urgent work",
        trigger: "task_created",
        conditions: { priority: "urgent" },
        actions: { assignTo: "user-1", notify: "assignee" },
        enabled: true,
      },
    );
    assert.throws(
      () =>
        parseCreateAutomationInput({
          name: "Unsafe rule",
          trigger: "task_created",
          actions: { executeShell: "whoami" },
        }),
      /actions.executeShell is not supported/,
    );
    assert.throws(
      () => parseUpdateAutomationInput({ organizationId: "org-2", workspaceId: "workspace-2" }),
      /at least one automation field is required/,
    );
  });

  it("normalizes custom fields without accepting tenant-owned columns", () => {
    assert.deepEqual(
      parseCreateCustomFieldInput({
        name: "Client Name",
        required: true,
        organizationId: "other-org",
        createdById: "attacker",
      }),
      { name: "Client Name", key: "client-name", type: "short_text", required: true },
    );
    assert.throws(() => parseCreateCustomFieldInput({ name: "Unsafe", type: "executable" }), /type is invalid/);
  });

  it("normalizes member invitations and rejects unsupported roles", () => {
    assert.deepEqual(parseInviteMemberInput({ email: "  MEMBER@EXAMPLE.COM ", role: "member" }), {
      email: "member@example.com",
      role: "member",
    });
    assert.throws(() => parseInviteMemberInput({ email: "not-an-email" }), /email is invalid/);
    assert.throws(() => parseMembershipRoleUpdate({ id: "member-1", role: "super-admin" }), /role is invalid/);
  });
});
