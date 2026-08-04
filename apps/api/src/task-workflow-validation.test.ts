import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseTaskApprovalDecision,
  parseTaskApprovalRequest,
  parseTaskChecklists,
} from "./task-workflow-validation.js";

describe("task workflow request input", () => {
  it("normalizes checklists and approval requests", () => {
    const checklists = parseTaskChecklists([{ title: "Release", items: [{ title: "Tests pass", isCompleted: true }] }]);
    assert.equal(checklists[0]?.items?.[0]?.isCompleted, true);
    const request = parseTaskApprovalRequest("task-1", {
      reviewerIds: ["user-1", "user-2"],
      mode: "sequential",
      dueAt: "2026-08-01T09:00:00.000Z",
    });
    assert.equal(request.mode, "sequential");
    assert.ok(request.dueAt instanceof Date);
    assert.deepEqual(parseTaskApprovalDecision({ decision: "approved", comment: "Ready" }), {
      decision: "approved",
      comment: "Ready",
    });
  });

  it("rejects duplicate reviewers and invalid decisions", () => {
    assert.throws(() => parseTaskApprovalRequest("task-1", { reviewerIds: ["user-1", "user-1"] }), /must be unique/);
    assert.throws(() => parseTaskApprovalDecision({ decision: "skip" }), /approved or rejected/);
  });
});
