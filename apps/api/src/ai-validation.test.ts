import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MAX_AI_INPUT_LENGTH, parseAIRequest } from "./ai-validation.js";

describe("AI request validation", () => {
  it("accepts only allow-listed actions and bounded text", () => {
    assert.deepEqual(parseAIRequest({ action: "breakdown", text: "  إطلاق منتج  ", projectId: "project-1" }), {
      action: "breakdown",
      text: "إطلاق منتج",
      projectId: "project-1",
    });
    assert.deepEqual(parseAIRequest({ action: "summarize" }), { action: "summarize", text: "" });
  });

  it("rejects unknown actions, missing required fields, and oversized input", () => {
    assert.throws(() => parseAIRequest({ action: "delete_workspace", text: "x" }), /action is invalid/);
    assert.throws(() => parseAIRequest({ action: "generate_task" }), /text is required/);
    assert.throws(() => parseAIRequest({ action: "breakdown", text: "Plan" }), /projectId is required/);
    assert.throws(
      () => parseAIRequest({ action: "translate", text: "x".repeat(MAX_AI_INPUT_LENGTH + 1) }),
      /must not exceed/,
    );
  });
});
