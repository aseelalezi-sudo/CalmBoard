import assert from "node:assert/strict";
import { describe, it } from "node:test";
import "reflect-metadata";
import { AIController } from "./ai.controller.js";
import { proposedTasksFromResult, requiresAIProposal } from "./ai-proposal.js";
import { REQUIRED_PERMISSION } from "./permission.guard.js";

describe("AI mutation proposal normalization", () => {
  it("creates bounded task proposals only for impactful actions", () => {
    assert.equal(requiresAIProposal("summarize"), false);
    assert.equal(proposedTasksFromResult("summarize", "summary"), undefined);
    assert.deepEqual(proposedTasksFromResult("breakdown", [" First step ", "", 42, "Second step"]), [
      { title: "First step", description: "", priority: "medium" },
      { title: "Second step", description: "", priority: "medium" },
    ]);
  });

  it("normalizes generated task fields before persistence", () => {
    assert.deepEqual(
      proposedTasksFromResult("generate_task", {
        title: " Ship release ",
        description: " Verify deployment ",
        priority: "urgent",
        estimatedHours: 2.5,
      }),
      [{ title: "Ship release", description: "Verify deployment", priority: "urgent", estimatedHours: 2.5 }],
    );
    assert.equal(proposedTasksFromResult("generate_task", { description: "missing title" }), undefined);
  });

  it("requires the task creation policy on the approval mutation", () => {
    const handler = Object.getOwnPropertyDescriptor(AIController.prototype, "approve")?.value as unknown;
    assert.equal(Reflect.getMetadata(REQUIRED_PERMISSION, handler as object), "tasks.create");
  });
});
