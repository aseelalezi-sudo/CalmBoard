import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NAV_ADMIN, NAV_SPACE, NAV_TOOLS, NAV_WORK } from "./navigation";

describe("sidebar information architecture", () => {
  it("keeps projects in Work and separates Workspace, Tools, and Administration", () => {
    assert.deepEqual(
      NAV_WORK.map((item) => item.id),
      ["mywork", "projects", "inbox", "dashboard"],
    );
    assert.deepEqual(
      NAV_SPACE.map((item) => item.id),
      ["docs", "goals", "time"],
    );
    assert.deepEqual(
      NAV_TOOLS.map((item) => item.id),
      ["automation", "forms", "integrations"],
    );
    assert.deepEqual(
      NAV_ADMIN.map((item) => item.id),
      ["workspaces", "settings", "members", "billing", "activity"],
    );
  });

  it("does not expose account and security as workspace navigation", () => {
    const ids = [...NAV_WORK, ...NAV_SPACE, ...NAV_TOOLS, ...NAV_ADMIN].map((item) => item.id);
    assert.equal(ids.includes("profile"), false);
  });
});
