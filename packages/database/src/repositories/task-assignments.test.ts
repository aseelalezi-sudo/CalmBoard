import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TenantConflictError } from "../errors.js";
import {
  assertCanonicalTaskAssignment,
  resolveTaskAssignmentCreation,
  resolveTaskAssignmentUpdate,
} from "./task-assignments.js";

describe("canonical task assignment domain contract (backend)", () => {
  describe("assertCanonicalTaskAssignment invariants", () => {
    it("accepts valid unassigned state: null Lead and empty list", () => {
      assert.doesNotThrow(() => assertCanonicalTaskAssignment(null, []));
      assert.doesNotThrow(() => assertCanonicalTaskAssignment(undefined, []));
    });

    it("accepts valid single Lead state: Lead is first and only element", () => {
      assert.doesNotThrow(() => assertCanonicalTaskAssignment("user-lead", ["user-lead"]));
    });

    it("accepts valid multi-assignee state: Lead is first in unique ordered list", () => {
      assert.doesNotThrow(() =>
        assertCanonicalTaskAssignment("user-lead", ["user-lead", "user-contrib-1", "user-contrib-2"]),
      );
    });

    it("rejects duplicate IDs in assigneeIds", () => {
      assert.throws(
        () => assertCanonicalTaskAssignment("user-lead", ["user-lead", "user-contrib-1", "user-lead"]),
        (err: unknown) => err instanceof TenantConflictError && /unique user IDs/.test(err.message),
      );
    });

    it("rejects null Lead with non-empty assigneeIds", () => {
      assert.throws(
        () => assertCanonicalTaskAssignment(null, ["user-1"]),
        (err: unknown) => err instanceof TenantConflictError && /without a Lead/.test(err.message),
      );
    });

    it("rejects non-null Lead with empty assigneeIds", () => {
      assert.throws(
        () => assertCanonicalTaskAssignment("user-lead", []),
        (err: unknown) => err instanceof TenantConflictError && /non-empty assigneeIds list/.test(err.message),
      );
    });

    it("rejects Lead that is not the first element in assigneeIds", () => {
      assert.throws(
        () => assertCanonicalTaskAssignment("user-lead", ["user-contrib", "user-lead"]),
        (err: unknown) => err instanceof TenantConflictError && /first element/.test(err.message),
      );
    });

    it("rejects Lead that is missing from assigneeIds", () => {
      assert.throws(
        () => assertCanonicalTaskAssignment("user-lead", ["user-contrib-1", "user-contrib-2"]),
        (err: unknown) => err instanceof TenantConflictError && /first element/.test(err.message),
      );
    });
  });

  describe("resolveTaskAssignmentCreation", () => {
    it("creates genuinely unassigned task when no assignees are provided", () => {
      const res1 = resolveTaskAssignmentCreation({});
      assert.deepEqual(res1, { assigneeId: null, assigneeIds: [] });

      const res2 = resolveTaskAssignmentCreation({ assigneeId: null });
      assert.deepEqual(res2, { assigneeId: null, assigneeIds: [] });

      const res3 = resolveTaskAssignmentCreation({ assigneeId: null, assigneeIds: [] });
      assert.deepEqual(res3, { assigneeId: null, assigneeIds: [] });
    });

    it("creates Lead only task when only assigneeId is given", () => {
      const res = resolveTaskAssignmentCreation({ assigneeId: "user-lead" });
      assert.deepEqual(res, { assigneeId: "user-lead", assigneeIds: ["user-lead"] });
    });

    it("creates Lead + Contributors with Lead guaranteed first in order", () => {
      const res = resolveTaskAssignmentCreation({
        assigneeId: "user-lead",
        assigneeIds: ["user-contrib-1", "user-contrib-2", "user-lead"],
      });
      assert.deepEqual(res, {
        assigneeId: "user-lead",
        assigneeIds: ["user-lead", "user-contrib-1", "user-contrib-2"],
      });
    });

    it("determines Lead from assigneeIds[0] when assigneeId is omitted", () => {
      const res = resolveTaskAssignmentCreation({
        assigneeIds: ["user-1", "user-2", "user-3"],
      });
      assert.deepEqual(res, {
        assigneeId: "user-1",
        assigneeIds: ["user-1", "user-2", "user-3"],
      });
    });

    it("rejects duplicate IDs in assigneeIds on creation", () => {
      assert.throws(
        () =>
          resolveTaskAssignmentCreation({
            assigneeId: "user-lead",
            assigneeIds: ["user-lead", "user-contrib", "user-contrib"],
          }),
        (err: unknown) => err instanceof TenantConflictError && /unique user IDs/.test(err.message),
      );
    });

    it("rejects creation when assigneeId is null but non-empty assigneeIds are passed", () => {
      assert.throws(
        () => resolveTaskAssignmentCreation({ assigneeId: null, assigneeIds: ["user-1"] }),
        (err: unknown) => err instanceof TenantConflictError && /without a Lead/.test(err.message),
      );
    });
  });

  describe("resolveTaskAssignmentUpdate", () => {
    const current = {
      assigneeId: "user-lead",
      assigneeIds: ["user-lead", "user-contrib-1", "user-contrib-2"],
    };

    it("adds a new contributor, preserving Lead and appending to execution list", () => {
      const res = resolveTaskAssignmentUpdate(current, {
        assigneeIds: ["user-lead", "user-contrib-1", "user-contrib-2", "user-contrib-3"],
      });
      assert.equal(res.assigneeId, "user-lead");
      assert.deepEqual(res.assigneeIds, ["user-lead", "user-contrib-1", "user-contrib-2", "user-contrib-3"]);
      assert.equal(res.changed, true);
      assert.equal(res.primaryChanged, false);
      assert.deepEqual(res.addedAssigneeIds, ["user-contrib-3"]);
      assert.deepEqual(res.removedAssigneeIds, []);
    });

    it("no-op when adding an already assigned contributor", () => {
      const res = resolveTaskAssignmentUpdate(current, {
        assigneeIds: ["user-lead", "user-contrib-1", "user-contrib-2"],
      });
      assert.equal(res.assigneeId, "user-lead");
      assert.deepEqual(res.assigneeIds, ["user-lead", "user-contrib-1", "user-contrib-2"]);
      assert.equal(res.changed, false);
      assert.equal(res.primaryChanged, false);
      assert.deepEqual(res.addedAssigneeIds, []);
      assert.deepEqual(res.removedAssigneeIds, []);
    });

    it("replaces Lead when only assigneeId is updated (removes old Lead, preserves contributors)", () => {
      const res = resolveTaskAssignmentUpdate(current, {
        assigneeId: "user-new-lead",
      });
      assert.equal(res.assigneeId, "user-new-lead");
      assert.deepEqual(res.assigneeIds, ["user-new-lead", "user-contrib-1", "user-contrib-2"]);
      assert.equal(res.changed, true);
      assert.equal(res.primaryChanged, true);
      assert.deepEqual(res.addedAssigneeIds, ["user-new-lead"]);
      assert.deepEqual(res.removedAssigneeIds, ["user-lead"]);
    });

    it("promotes contributor to Lead and retains previous Lead as contributor when both are passed", () => {
      const res = resolveTaskAssignmentUpdate(current, {
        assigneeId: "user-contrib-1",
        assigneeIds: ["user-contrib-1", "user-lead", "user-contrib-2"],
      });
      assert.equal(res.assigneeId, "user-contrib-1");
      assert.deepEqual(res.assigneeIds, ["user-contrib-1", "user-lead", "user-contrib-2"]);
      assert.equal(res.changed, true);
      assert.equal(res.primaryChanged, true);
      assert.deepEqual(res.addedAssigneeIds, []);
      assert.deepEqual(res.removedAssigneeIds, []);
    });

    it("removes a contributor while preserving Lead", () => {
      const res = resolveTaskAssignmentUpdate(current, {
        assigneeIds: ["user-lead", "user-contrib-2"],
      });
      assert.equal(res.assigneeId, "user-lead");
      assert.deepEqual(res.assigneeIds, ["user-lead", "user-contrib-2"]);
      assert.equal(res.changed, true);
      assert.equal(res.primaryChanged, false);
      assert.deepEqual(res.addedAssigneeIds, []);
      assert.deepEqual(res.removedAssigneeIds, ["user-contrib-1"]);
    });

    it("removes Lead with remaining contributors (assigneeId: null promotes next contributor)", () => {
      const res = resolveTaskAssignmentUpdate(current, {
        assigneeId: null,
      });
      assert.equal(res.assigneeId, "user-contrib-1");
      assert.deepEqual(res.assigneeIds, ["user-contrib-1", "user-contrib-2"]);
      assert.equal(res.changed, true);
      assert.equal(res.primaryChanged, true);
      assert.deepEqual(res.addedAssigneeIds, []);
      assert.deepEqual(res.removedAssigneeIds, ["user-lead"]);
    });

    it("clears all assignees with assigneeIds: []", () => {
      const res = resolveTaskAssignmentUpdate(current, {
        assigneeIds: [],
      });
      assert.equal(res.assigneeId, null);
      assert.deepEqual(res.assigneeIds, []);
      assert.equal(res.changed, true);
      assert.equal(res.primaryChanged, true);
      assert.deepEqual(res.addedAssigneeIds, []);
      assert.deepEqual(res.removedAssigneeIds, ["user-lead", "user-contrib-1", "user-contrib-2"]);
    });

    it("no-op when clearing already unassigned task", () => {
      const unassigned = { assigneeId: null, assigneeIds: [] };
      const res = resolveTaskAssignmentUpdate(unassigned, { assigneeIds: [] });
      assert.equal(res.assigneeId, null);
      assert.deepEqual(res.assigneeIds, []);
      assert.equal(res.changed, false);
      assert.equal(res.primaryChanged, false);
    });

    it("no-op when setting current Lead as Lead again", () => {
      const res = resolveTaskAssignmentUpdate(current, { assigneeId: "user-lead" });
      assert.equal(res.assigneeId, "user-lead");
      assert.deepEqual(res.assigneeIds, ["user-lead", "user-contrib-1", "user-contrib-2"]);
      assert.equal(res.changed, false);
      assert.equal(res.primaryChanged, false);
    });

    it("rejects update when assigneeId is null but non-empty assigneeIds are passed", () => {
      assert.throws(
        () => resolveTaskAssignmentUpdate(current, { assigneeId: null, assigneeIds: ["user-1"] }),
        (err: unknown) => err instanceof TenantConflictError && /without a Lead/.test(err.message),
      );
    });

    it("rejects duplicate IDs in assigneeIds on update", () => {
      assert.throws(
        () =>
          resolveTaskAssignmentUpdate(current, {
            assigneeIds: ["user-lead", "user-contrib-1", "user-contrib-1"],
          }),
        (err: unknown) => err instanceof TenantConflictError && /unique user IDs/.test(err.message),
      );
    });
  });
});
