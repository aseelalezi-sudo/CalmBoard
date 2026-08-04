import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseCreateTaskInput,
  parseMoveTaskInput,
  parseTaskImportInput,
  parseUpdateTaskInput,
} from "./task-validation.js";

describe("task request input", () => {
  it("accepts supported task fields and converts dates", () => {
    const input = parseCreateTaskInput({
      projectId: "project-1",
      title: "Prepare release",
      status: "todo",
      priority: "high",
      startDate: "2026-08-01T12:00:00.000Z",
      dueDate: "2026-08-01T12:00:00.000Z",
      isMilestone: true,
    });
    assert.equal(input.status, "todo");
    assert.equal(input.priority, "high");
    assert.ok(input.dueDate instanceof Date);
    assert.equal(input.isMilestone, true);
  });

  it("accepts a bounded board move and rejects unsafe fields", () => {
    assert.deepEqual(parseMoveTaskInput({ status: "review", targetIndex: 2, expectedVersion: 4 }), {
      status: "review",
      targetIndex: 2,
      expectedVersion: 4,
    });
    assert.deepEqual(
      parseMoveTaskInput({
        status: "review",
        targetIndex: 2,
        beforeTaskId: "task-1",
        afterTaskId: null,
        expectedVersion: 4,
      }),
      {
        status: "review",
        targetIndex: 2,
        beforeTaskId: "task-1",
        afterTaskId: null,
        expectedVersion: 4,
      },
    );
    assert.throws(() => parseMoveTaskInput({ status: "review", targetIndex: -1, expectedVersion: 4 }), /targetIndex/);
    assert.throws(
      () => parseMoveTaskInput({ status: "review", targetIndex: 0, expectedVersion: 4, projectId: "other" }),
      /not supported/,
    );
  });

  it("rejects invalid or empty updates", () => {
    assert.throws(() => parseUpdateTaskInput({ status: "not-a-status" }), /status is invalid/);
    assert.throws(
      () => parseUpdateTaskInput({ organizationId: "org-2", workspaceId: "workspace-2" }),
      /at least one task field is required/,
    );
  });

  it("maps relational metadata and the persisted delay reason without accepting arbitrary columns", () => {
    const input = parseUpdateTaskInput({
      expectedVersion: 2,
      delayReason: "Waiting for review",
      dependencies: ["task-2"],
      reminders: [{ id: "reminder-1", time: "2026-08-01T09:00:00.000Z", label: "Review", sent: false }],
    });
    assert.equal(input.delayReason, "Waiting for review");
    assert.deepEqual(input.metadata, {
      dependencies: ["task-2"],
      reminders: [{ id: "reminder-1", time: "2026-08-01T09:00:00.000Z", label: "Review", sent: false }],
    });
    assert.throws(() => parseUpdateTaskInput({ deletedAt: new Date().toISOString() }), /is not supported/);
  });

  it("accepts multiple assignees, followers, and task timezone", () => {
    const input = parseCreateTaskInput({
      projectId: "project-1",
      title: "Coordinate release",
      assigneeIds: ["user-1", "user-2"],
      followerIds: ["user-3"],
      timezone: "Asia/Riyadh",
      delayReason: "Waiting for vendor",
    });
    assert.deepEqual(input.assigneeIds, ["user-1", "user-2"]);
    assert.deepEqual(input.followerIds, ["user-3"]);
    assert.equal(input.timezone, "Asia/Riyadh");
    assert.equal(input.delayReason, "Waiting for vendor");
  });

  it("validates bounded task import batches without nested tenant overrides", () => {
    const tasks = parseTaskImportInput({
      organizationId: "organization-1",
      workspaceId: "workspace-1",
      actorId: "user-1",
      tasks: [
        { projectId: "project-1", title: "First" },
        { projectId: "project-1", title: "Second", priority: "high" },
      ],
    });
    assert.equal(tasks.length, 2);
    assert.equal(tasks[1]?.priority, "high");
    assert.throws(
      () =>
        parseTaskImportInput({
          organizationId: "organization-1",
          workspaceId: "workspace-1",
          tasks: [{ projectId: "project-1", title: "Unsafe", organizationId: "organization-2" }],
        }),
      /tasks\.0/,
    );
    assert.throws(
      () =>
        parseTaskImportInput({
          organizationId: "organization-1",
          workspaceId: "workspace-1",
          tasks: Array.from({ length: 101 }, (_, index) => ({ projectId: "project-1", title: `Task ${index}` })),
        }),
      /tasks/,
    );
  });

  it("validates relational reminder and recurrence inputs", () => {
    const input = parseUpdateTaskInput({
      expectedVersion: 4,
      reminders: [{ id: "release", time: "2026-08-01T09:00:00.000Z", label: "Release review" }],
      recurrence: {
        frequency: "weekly",
        interval: 2,
        timezone: "Asia/Riyadh",
        weekdays: [0, 4],
        startsAt: "2026-08-01T09:00:00.000Z",
        maxOccurrences: 12,
      },
    });
    assert.equal(input.recurrence?.frequency, "weekly");
    assert.equal(input.recurrence?.interval, 2);
    assert.ok(input.recurrence?.startsAt instanceof Date);
    assert.throws(
      () =>
        parseUpdateTaskInput({
          reminders: [
            { id: "duplicate", time: "invalid", label: "First" },
            { id: "duplicate", time: "2026-08-01T09:00:00.000Z", label: "Second" },
          ],
          expectedVersion: 1,
        }),
      /must be a valid date/,
    );
    assert.throws(
      () => parseUpdateTaskInput({ recurrence: { frequency: "weekly", weekdays: [7] }, expectedVersion: 1 }),
      /recurrence.weekdays is invalid/,
    );
  });
});
