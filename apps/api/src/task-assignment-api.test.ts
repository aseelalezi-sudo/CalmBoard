import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException } from "@nestjs/common";
import { parseCreateTaskInput, parseTaskImportInput, parseUpdateTaskInput } from "./task-validation.js";

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

  it("rejects duplicate assigneeIds on create", () => {
    assert.throws(
      () =>
        parseCreateTaskInput({
          projectId: "project-1",
          title: "Duplicate Assignees Task",
          assigneeId: "user-1",
          assigneeIds: ["user-1", "user-2", "user-1"],
        }),
      (err: unknown) => err instanceof BadRequestException && /must contain unique values/.test(err.message),
    );
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

  it("rejects duplicate assigneeIds on update", () => {
    assert.throws(
      () =>
        parseUpdateTaskInput({
          expectedVersion: 1,
          assigneeIds: ["user-1", "user-2", "user-2"],
        }),
      (err: unknown) => err instanceof BadRequestException && /must contain unique values/.test(err.message),
    );
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

  it("parses task import with unassigned, lead-only, and multi-assignees", () => {
    const imported = parseTaskImportInput({
      organizationId: "org-1",
      workspaceId: "ws-1",
      tasks: [
        {
          projectId: "project-1",
          title: "Import Unassigned",
          assigneeId: null,
        },
        {
          projectId: "project-1",
          title: "Import Lead Only",
          assigneeId: "user-lead",
        },
        {
          projectId: "project-1",
          title: "Import Multi",
          assigneeId: "user-lead",
          assigneeIds: ["user-lead", "user-contrib"],
        },
      ],
    });

    assert.equal(imported.length, 3);
    assert.equal(imported[0]!.assigneeId, null);
    assert.equal(imported[1]!.assigneeId, "user-lead");
    assert.deepEqual(imported[2]!.assigneeIds, ["user-lead", "user-contrib"]);
  });

  it("rejects task import when a task has duplicate assigneeIds", () => {
    assert.throws(
      () =>
        parseTaskImportInput({
          organizationId: "org-1",
          workspaceId: "ws-1",
          tasks: [
            {
              projectId: "project-1",
              title: "Import with duplicates",
              assigneeIds: ["user-1", "user-1"],
            },
          ],
        }),
      (err: unknown) => err instanceof BadRequestException,
    );
  });
});
