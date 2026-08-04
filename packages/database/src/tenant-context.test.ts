import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertTenantContext, assertWorkspaceTenantContext } from "./tenant-context.js";

describe("database tenant context", () => {
  it("rejects database access without an organization", () => {
    assert.throws(() => assertTenantContext({}), /organizationId is required for database access/);
  });

  it("rejects workspace data access without a workspace", () => {
    assert.throws(
      () => assertWorkspaceTenantContext({ organizationId: "org-1" }),
      /workspaceId is required for workspace database access/,
    );
  });

  it("accepts a complete workspace tenant context", () => {
    assert.doesNotThrow(() =>
      assertWorkspaceTenantContext({
        organizationId: "org-1",
        workspaceId: "workspace-1",
        actorId: "user-1",
      }),
    );
  });
});
