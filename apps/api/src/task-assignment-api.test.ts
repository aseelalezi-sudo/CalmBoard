import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseCreateTaskInput, parseUpdateTaskInput } from "./task-validation.js";

describe("task assignment API validation", () => {
  it("parses assigneeId and assigneeIds correctly for create", () => {
    const input = parseCreateTaskInput({
      projectId: "project-1",
      title: "Task with assignees",
      assigneeId: "user-1",
      assigneeIds: ["user-1", "user-2"],
    });
    assert.equal(input.assigneeId, "user-1");
    assert.deepEqual(input.assigneeIds, ["user-1", "user-2"]);
  });

  it("parses genuine unassigned creation", () => {
    const input = parseCreateTaskInput({
      projectId: "project-1",
      title: "Unassigned task",
      assigneeId: null,
    });
    assert.equal(input.assigneeId, null);
  });

  it("parses assigneeId and assigneeIds on update", () => {
    const input = parseUpdateTaskInput({
      expectedVersion: 1,
      assigneeId: "user-2",
      assigneeIds: ["user-1", "user-2", "user-3"],
    });
    assert.equal(input.assigneeId, "user-2");
    assert.deepEqual(input.assigneeIds, ["user-1", "user-2", "user-3"]);
  });

  it("parses assignee clearing on update", () => {
    const inputWithNull = parseUpdateTaskInput({
      expectedVersion: 1,
      assigneeId: null,
    });
    assert.equal(inputWithNull.assigneeId, null);

    const inputWithEmptyArray = parseUpdateTaskInput({
      expectedVersion: 1,
      assigneeIds: [],
    });
    assert.deepEqual(inputWithEmptyArray.assigneeIds, []);
  });
});
