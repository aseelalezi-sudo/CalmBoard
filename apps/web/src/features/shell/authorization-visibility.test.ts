import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canOpenWorkspaceView } from "./authorization-visibility";

describe("permission-aware workspace navigation", () => {
  it("hides project Sprint and protected administration views when permission is absent", () => {
    const can = (permission: string) => permission === "custom_fields.manage";
    assert.equal(canOpenWorkspaceView("sprints", can), false);
    assert.equal(canOpenWorkspaceView("sprint_board", can), false);
    assert.equal(canOpenWorkspaceView("billing", can), false);
    assert.equal(canOpenWorkspaceView("activity", can), false);
    assert.equal(canOpenWorkspaceView("settings", can), true);
  });

  it("keeps ordinary member views visible and exposes Sprints only with its read permission", () => {
    const can = (permission: string) => permission === "sprints.view";
    assert.equal(canOpenWorkspaceView("projects", can), true);
    assert.equal(canOpenWorkspaceView("sprints", can), true);
  });
});
