import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getTaskAssigneeIds,
  getTaskEffortShare,
  isTaskAssignedTo,
  isTaskContributor,
  isTaskLead,
  rebalanceTaskAssignees,
} from "./assignment-domain.js";
import type { Task } from "../../lib/types.js";

describe("task assignment domain helpers (frontend)", () => {
  const sampleTask: Task = {
    id: "task-1",
    organizationId: "org-1",
    workspaceId: "ws-1",
    projectId: "proj-1",
    title: "Domain Test Task",
    description: "",
    status: "todo",
    priority: "high",
    assigneeId: "user-lead",
    assigneeIds: ["user-lead", "user-contrib-1", "user-contrib-2"],
    followerIds: ["user-observer"],
    serial: "TASK-1",
    order: 0,
    tags: [],
    customFields: {},
    estimatedHours: 12,
    loggedHours: 0,
    progress: 0,
    timezone: "UTC",
    isMilestone: false,
    isRecurring: false,
    version: 1,
    createdAt: "2026-08-17T00:00:00.000Z",
    updatedAt: "2026-08-17T00:00:00.000Z",
  };

  it("getTaskAssigneeIds returns unified list with lead first", () => {
    assert.deepEqual(getTaskAssigneeIds(null), []);
    assert.deepEqual(getTaskAssigneeIds({}), []);
    assert.deepEqual(getTaskAssigneeIds({ assigneeId: "user-1" }), ["user-1"]);
    assert.deepEqual(getTaskAssigneeIds(sampleTask), ["user-lead", "user-contrib-1", "user-contrib-2"]);
  });

  it("isTaskAssignedTo matches both Lead and Contributor (proving Contributor appears in My Work)", () => {
    // Lead matches
    assert.equal(isTaskAssignedTo(sampleTask, "user-lead"), true);
    // Contributors match (proves Contributor appears in My Work)
    assert.equal(isTaskAssignedTo(sampleTask, "user-contrib-1"), true);
    assert.equal(isTaskAssignedTo(sampleTask, "user-contrib-2"), true);

    // Non-assignees do not match
    assert.equal(isTaskAssignedTo(sampleTask, "user-observer"), false); // Followers are not assignees
    assert.equal(isTaskAssignedTo(sampleTask, "unrelated-user"), false);
    assert.equal(isTaskAssignedTo(null, "user-lead"), false);
    assert.equal(isTaskAssignedTo(sampleTask, null), false);
  });

  it("isTaskLead identifies primary assignee only", () => {
    assert.equal(isTaskLead(sampleTask, "user-lead"), true);
    assert.equal(isTaskLead(sampleTask, "user-contrib-1"), false);
  });

  it("isTaskContributor identifies non-lead contributors only", () => {
    assert.equal(isTaskContributor(sampleTask, "user-lead"), false);
    assert.equal(isTaskContributor(sampleTask, "user-contrib-1"), true);
    assert.equal(isTaskContributor(sampleTask, "user-contrib-2"), true);
    assert.equal(isTaskContributor(sampleTask, "unrelated"), false);
  });

  it("getTaskEffortShare calculates 12h / 3 assignees = 4h allocation each", () => {
    // 12h task with 3 execution assignees -> 4h each
    const share = getTaskEffortShare(sampleTask);
    assert.equal(share, 4);

    // Single assignee task -> full allocation
    const singleAssigneeTask = { ...sampleTask, assigneeIds: ["user-lead"] };
    assert.equal(getTaskEffortShare(singleAssigneeTask), 12);

    // Unassigned task -> 0
    const unassignedTask = { ...sampleTask, assigneeId: null, assigneeIds: [] };
    assert.equal(getTaskEffortShare(unassignedTask), 0);

    // Missing or non-positive estimated hours -> 0
    assert.equal(getTaskEffortShare({ ...sampleTask, estimatedHours: undefined }), 0);
    assert.equal(getTaskEffortShare({ ...sampleTask, estimatedHours: 0 }), 0);
    assert.equal(getTaskEffortShare(null), 0);
  });

  it("rebalanceTaskAssignees replaces Lead and preserves contributors", () => {
    const result = rebalanceTaskAssignees(sampleTask, "user-lead", "user-target");
    assert.ok(result);
    assert.equal(result.assigneeId, "user-target");
    assert.deepEqual(result.assigneeIds, ["user-target", "user-contrib-1", "user-contrib-2"]);
  });

  it("rebalanceTaskAssignees replaces Contributor and preserves Lead", () => {
    const result = rebalanceTaskAssignees(sampleTask, "user-contrib-1", "user-target");
    assert.ok(result);
    assert.equal(result.assigneeId, "user-lead"); // Lead preserved!
    assert.deepEqual(result.assigneeIds, ["user-lead", "user-target", "user-contrib-2"]);
  });

  it("rebalanceTaskAssignees rejects/skips if target is already assigned", () => {
    // target user-contrib-2 is already a contributor on sampleTask
    const result = rebalanceTaskAssignees(sampleTask, "user-lead", "user-contrib-2");
    assert.equal(result, null);
  });

  it("rebalanceTaskAssignees rejects/skips if source is not assigned or same as target", () => {
    const notAssigned = rebalanceTaskAssignees(sampleTask, "unrelated-user", "user-target");
    assert.equal(notAssigned, null);

    const sameUser = rebalanceTaskAssignees(sampleTask, "user-lead", "user-lead");
    assert.equal(sameUser, null);
  });

  it("explicit Unassigned action creates full assignment clearing payload", () => {
    const unassignedPayload = (value: string | null) =>
      value ? { assigneeId: value } : { assigneeId: null, assigneeIds: [] };

    assert.deepEqual(unassignedPayload(""), { assigneeId: null, assigneeIds: [] });
    assert.deepEqual(unassignedPayload(null), { assigneeId: null, assigneeIds: [] });
    assert.deepEqual(unassignedPayload("user-1"), { assigneeId: "user-1" });
  });
});
