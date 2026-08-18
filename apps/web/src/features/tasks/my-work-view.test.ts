import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { getTaskAssignmentRole, isTaskIncludedInMyWork } from "./assignment-domain.js";
import type { Task } from "../../lib/types.js";

const views = readFileSync(new URL("./task-views.tsx", import.meta.url), "utf8");

describe("My Work view wiring contracts", () => {
  it("filters assigned non-deleted tasks and provides 5 distinct lifecycle sections", () => {
    // Assigned filter using pure helper
    assert.match(views, /ctx\.tasks\.filter\(\(task\) => isTaskIncludedInMyWork\(task, ctx\.currentUser\?\.id\)\)/);

    // Active status filter (excluding done, canceled, cancelled)
    assert.match(
      views,
      /mine\.filter\([\s\S]*?task\.status !== "done"[\s\S]*?task\.status !== "canceled"[\s\S]*?task\.status !== "cancelled"/,
    );

    // 5 sections: today, upcoming, overdue, no_due_date, done
    assert.match(views, /id: "today"/);
    assert.match(views, /id: "upcoming"/);
    assert.match(views, /id: "overdue"/);
    assert.match(views, /id: "no_due_date"/);
    assert.match(views, /id: "done"/);
  });

  it("enforces deterministic sorting in all My Work sections", () => {
    // Priority order map definition
    assert.match(views, /const PRIORITY_ORDER: Record<string, number> = {/);

    // Due today sorted by priority then serial
    assert.match(views, /PRIORITY_ORDER\[b\.priority\][\s\S]*a\.serial\.localeCompare\(b\.serial\)/);

    // Overdue sorted by due date then priority then serial
    assert.match(views, /a\.dueDate[\s\S]*localeCompare[\s\S]*PRIORITY_ORDER/);
  });

  it("protects task toggle mutations with optimistic expectedVersion", () => {
    assert.match(views, /expectedVersion: task\.version/);
    assert.match(views, /saved = await ctx\.updateTask/);
    assert.match(views, /aria-busy=\{pendingTaskId === task\.id\}/);
  });
});

describe("My Work functional domain behavior & role resolution", () => {
  const baseTask: Task = {
    id: "task-test-1",
    organizationId: "org-1",
    workspaceId: "ws-1",
    projectId: "proj-1",
    title: "My Work Test Task",
    description: "",
    status: "in_progress",
    priority: "high",
    assigneeId: "user-lead",
    assigneeIds: ["user-lead", "user-contrib-1", "user-contrib-2"],
    followerIds: ["user-follower"],
    serial: "TSK-101",
    order: 0,
    tags: [],
    customFields: {},
    estimatedHours: 8,
    loggedHours: 2,
    progress: 25,
    timezone: "UTC",
    isMilestone: false,
    isRecurring: false,
    version: 1,
    createdAt: "2026-08-18T00:00:00.000Z",
    updatedAt: "2026-08-18T00:00:00.000Z",
  };

  it("includes Lead tasks in My Work and resolves role to lead", () => {
    assert.equal(isTaskIncludedInMyWork(baseTask, "user-lead"), true);
    assert.equal(getTaskAssignmentRole(baseTask, "user-lead"), "lead");
  });

  it("includes Contributor tasks in My Work and resolves role to contributor", () => {
    assert.equal(isTaskIncludedInMyWork(baseTask, "user-contrib-1"), true);
    assert.equal(getTaskAssignmentRole(baseTask, "user-contrib-1"), "contributor");
  });

  it("includes multiple Contributors in My Work and resolves role to contributor", () => {
    assert.equal(isTaskIncludedInMyWork(baseTask, "user-contrib-2"), true);
    assert.equal(getTaskAssignmentRole(baseTask, "user-contrib-2"), "contributor");
  });

  it("excludes follower-only users from My Work and resolves role to null", () => {
    assert.equal(isTaskIncludedInMyWork(baseTask, "user-follower"), false);
    assert.equal(getTaskAssignmentRole(baseTask, "user-follower"), null);
  });

  it("excludes unrelated users from My Work and resolves role to null", () => {
    assert.equal(isTaskIncludedInMyWork(baseTask, "user-unrelated"), false);
    assert.equal(getTaskAssignmentRole(baseTask, "user-unrelated"), null);
  });

  it("excludes unassigned tasks from My Work and resolves role to null", () => {
    const unassignedTask: Task = {
      ...baseTask,
      assigneeId: null,
      assigneeIds: [],
    };
    assert.equal(isTaskIncludedInMyWork(unassignedTask, "user-lead"), false);
    assert.equal(getTaskAssignmentRole(unassignedTask, "user-lead"), null);
  });

  it("excludes soft-deleted tasks from My Work even if user is assigned as Lead or Contributor", () => {
    const deletedTask: Task = {
      ...baseTask,
      deletedAt: "2026-08-18T10:00:00.000Z",
    };
    assert.equal(isTaskIncludedInMyWork(deletedTask, "user-lead"), false);
    assert.equal(isTaskIncludedInMyWork(deletedTask, "user-contrib-1"), false);
  });

  it("safely returns false and null for null or undefined user or task", () => {
    assert.equal(isTaskIncludedInMyWork(null, "user-lead"), false);
    assert.equal(isTaskIncludedInMyWork(undefined, "user-lead"), false);
    assert.equal(isTaskIncludedInMyWork(baseTask, null), false);
    assert.equal(isTaskIncludedInMyWork(baseTask, undefined), false);
    assert.equal(isTaskIncludedInMyWork(baseTask, ""), false);

    assert.equal(getTaskAssignmentRole(null, "user-lead"), null);
    assert.equal(getTaskAssignmentRole(undefined, "user-lead"), null);
    assert.equal(getTaskAssignmentRole(baseTask, null), null);
    assert.equal(getTaskAssignmentRole(baseTask, undefined), null);
    assert.equal(getTaskAssignmentRole(baseTask, ""), null);
  });
});
