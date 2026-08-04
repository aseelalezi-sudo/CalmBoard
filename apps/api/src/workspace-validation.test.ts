import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseUpdateWorkspaceInput } from "./workspace-validation.js";

describe("workspace request input", () => {
  it("normalizes slugs and maps only allow-listed fields", () => {
    assert.deepEqual(
      parseUpdateWorkspaceInput({
        name: "Design",
        slug: "Design Team",
        organizationId: "other-org",
        ownerId: "other-user",
      }),
      { name: "Design", slug: "design-team" },
    );
  });

  it("rejects empty updates", () => {
    assert.throws(
      () => parseUpdateWorkspaceInput({ organizationId: "org-2", workspaceId: "workspace-2" }),
      /at least one workspace field is required/,
    );
  });
});
