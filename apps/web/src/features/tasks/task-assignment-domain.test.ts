import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getTaskAssigneeIds, isTaskAssignedTo, isTaskContributor, isTaskLead } from "./assignment-domain.js";
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
    estimatedHours: 10,
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

  it("isTaskAssignedTo matches both Lead and Contributor", () => {
    assert.equal(isTaskAssignedTo(sampleTask, "user-lead"), true);
    assert.equal(isTaskAssignedTo(sampleTask, "user-contrib-1"), true);
    assert.equal(isTaskAssignedTo(sampleTask, "user-contrib-2"), true);
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

  it("workload rebalance logic preserves contributors when Lead is rebalanced", () => {
    const sourceUserId = "user-lead";
    const targetUserId = "user-target";
    const currentAssignees = getTaskAssigneeIds(sampleTask);

    let newAssigneeId: string | null = sampleTask.assigneeId ?? null;
    let newAssigneeIds: string[];

    if (sampleTask.assigneeId === sourceUserId) {
      newAssigneeId = targetUserId;
      newAssigneeIds = currentAssignees.map((id) => (id === sourceUserId ? targetUserId : id));
      if (!newAssigneeIds.includes(targetUserId)) {
        newAssigneeIds.unshift(targetUserId);
      }
    } else {
      newAssigneeIds = currentAssignees.map((id) => (id === sourceUserId ? targetUserId : id));
    }
    newAssigneeIds = [...new Set(newAssigneeIds)];

    assert.equal(newAssigneeId, "user-target");
    assert.deepEqual(newAssigneeIds, ["user-target", "user-contrib-1", "user-contrib-2"]);
  });

  it("workload rebalance logic preserves Lead when Contributor is rebalanced", () => {
    const sourceUserId = "user-contrib-1";
    const targetUserId = "user-target";
    const currentAssignees = getTaskAssigneeIds(sampleTask);

    let newAssigneeId: string | null = sampleTask.assigneeId ?? null;
    let newAssigneeIds: string[];

    if (sampleTask.assigneeId === sourceUserId) {
      newAssigneeId = targetUserId;
      newAssigneeIds = currentAssignees.map((id) => (id === sourceUserId ? targetUserId : id));
    } else {
      newAssigneeIds = currentAssignees.map((id) => (id === sourceUserId ? targetUserId : id));
    }
    newAssigneeIds = [...new Set(newAssigneeIds)];

    assert.equal(newAssigneeId, "user-lead"); // Lead preserved!
    assert.deepEqual(newAssigneeIds, ["user-lead", "user-target", "user-contrib-2"]);
  });
});
