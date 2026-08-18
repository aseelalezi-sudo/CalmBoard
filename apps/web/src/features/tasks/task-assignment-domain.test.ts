import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildAddAssigneeMutation,
  buildClearAllAssigneesMutation,
  buildCustomAssignmentMutation,
  buildRemoveAssigneeMutation,
  buildSetLeadMutation,
  getTaskAssigneeIds,
  getTaskEffortShare,
  getWorkspaceCandidateUsers,
  isTaskAssignedTo,
  isTaskContributor,
  isTaskLead,
  rebalanceTaskAssignees,
  resolveTaskPeople,
} from "./assignment-domain.js";
import type { Member, Task, User } from "../../lib/types.js";

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

  describe("getWorkspaceCandidateUsers", () => {
    const members: Member[] = [
      {
        id: "m-1",
        userId: "u-1",
        role: "admin",
        status: "active",
        joinedAt: "2026-01-01",
        user: { id: "u-1", name: "Alice", email: "alice@example.com" },
      },
      {
        id: "m-2",
        userId: "u-2",
        role: "member",
        status: "active",
        joinedAt: "2026-01-01",
        user: { id: "u-2", name: "Bob", email: "bob@example.com" },
      },
      {
        id: "m-3",
        userId: "u-3",
        role: "member",
        status: "inactive",
        joinedAt: "2026-01-01",
        user: { id: "u-3", name: "Inactive User", email: "inactive@example.com" },
      },
    ];

    const directoryUsers: User[] = [
      { id: "u-1", name: "Alice", email: "alice@example.com" },
      { id: "u-2", name: "Bob", email: "bob@example.com" },
      { id: "u-3", name: "Inactive User", email: "inactive@example.com" },
      { id: "u-outside", name: "Outside User", email: "outside@example.com" },
    ];

    it("filters active members and excludes inactive users and outsiders", () => {
      const candidates = getWorkspaceCandidateUsers(members, directoryUsers);
      assert.equal(candidates.length, 2);
      assert.deepEqual(
        candidates.map((u) => u.id),
        ["u-1", "u-2"],
      );
    });

    it("falls back to directory users if members array is empty", () => {
      const candidates = getWorkspaceCandidateUsers([], directoryUsers);
      assert.equal(candidates.length, directoryUsers.length);
    });
  });

  describe("resolveTaskPeople", () => {
    const users: User[] = [
      { id: "u-1", name: "Alice Lead", email: "alice@example.com" },
      { id: "u-2", name: "Bob Contrib", email: "bob@example.com" },
    ];

    it("resolves assignees with Lead first and correct role tags", () => {
      const task: Partial<Task> = {
        assigneeId: "u-1",
        assigneeIds: ["u-1", "u-2"],
      };
      const people = resolveTaskPeople(task, users);
      assert.equal(people.length, 2);
      assert.equal(people[0].user.id, "u-1");
      assert.equal(people[0].isLead, true);
      assert.equal(people[0].isContributor, false);
      assert.equal(people[1].user.id, "u-2");
      assert.equal(people[1].isLead, false);
      assert.equal(people[1].isContributor, true);
    });

    it("creates synthetic fallback user for unknown assignee id", () => {
      const task: Partial<Task> = {
        assigneeId: "unknown-id-1234",
        assigneeIds: ["unknown-id-1234"],
      };
      const people = resolveTaskPeople(task, users);
      assert.equal(people.length, 1);
      assert.equal(people[0].user.id, "unknown-id-1234");
      assert.equal(people[0].user.name, "User unkn");
    });
  });

  describe("pure assignment mutation builders", () => {
    it("buildAddAssigneeMutation adds contributor preserving Lead", () => {
      const res = buildAddAssigneeMutation(sampleTask, "user-new");
      assert.equal(res.assigneeId, "user-lead");
      assert.deepEqual(res.assigneeIds, ["user-lead", "user-contrib-1", "user-contrib-2", "user-new"]);
    });

    it("buildAddAssigneeMutation assigns Lead when task was unassigned", () => {
      const unassignedTask = { assigneeId: null, assigneeIds: [] };
      const res = buildAddAssigneeMutation(unassignedTask, "user-first");
      assert.equal(res.assigneeId, "user-first");
      assert.deepEqual(res.assigneeIds, ["user-first"]);
    });

    it("buildRemoveAssigneeMutation removes contributor preserving Lead", () => {
      const res = buildRemoveAssigneeMutation(sampleTask, "user-contrib-1");
      assert.equal(res.assigneeId, "user-lead");
      assert.deepEqual(res.assigneeIds, ["user-lead", "user-contrib-2"]);
    });

    it("buildRemoveAssigneeMutation removes Lead and lets backend canonical response promote next", () => {
      const res = buildRemoveAssigneeMutation(sampleTask, "user-lead");
      // assigneeId is omitted so backend canonical promotion promotes user-contrib-1
      assert.equal(res.assigneeId, undefined);
      assert.deepEqual(res.assigneeIds, ["user-contrib-1", "user-contrib-2"]);
    });

    it("buildRemoveAssigneeMutation clears assignment when last assignee is removed", () => {
      const singleTask = { assigneeId: "user-only", assigneeIds: ["user-only"] };
      const res = buildRemoveAssigneeMutation(singleTask, "user-only");
      assert.equal(res.assigneeId, null);
      assert.deepEqual(res.assigneeIds, []);
    });

    it("buildSetLeadMutation moves designated user to Lead and puts them first", () => {
      const res = buildSetLeadMutation(sampleTask, "user-contrib-2");
      assert.equal(res.assigneeId, "user-contrib-2");
      assert.deepEqual(res.assigneeIds, ["user-contrib-2", "user-lead", "user-contrib-1"]);
    });

    it("buildClearAllAssigneesMutation returns null and empty array", () => {
      const res = buildClearAllAssigneesMutation();
      assert.equal(res.assigneeId, null);
      assert.deepEqual(res.assigneeIds, []);
    });

    it("buildCustomAssignmentMutation formats draft assignment sets correctly", () => {
      const res = buildCustomAssignmentMutation("user-2", ["user-1", "user-2", "user-3"]);
      assert.equal(res.assigneeId, "user-2");
      assert.deepEqual(res.assigneeIds, ["user-2", "user-1", "user-3"]);

      const emptyRes = buildCustomAssignmentMutation(null, []);
      assert.equal(emptyRes.assigneeId, null);
      assert.deepEqual(emptyRes.assigneeIds, []);
    });
  });
});
