import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TenantConflictError } from "../errors.js";
import {
  assertCanonicalTaskState,
  assertValidMilestone,
  assertValidTaskDates,
  assertValidTaskPriority,
  assertValidTaskProgress,
  assertValidTaskStatus,
  normalizeTaskRecurrence,
  resolveTaskStateCreation,
  resolveTaskStateUpdate,
  VALID_TASK_PRIORITIES,
  VALID_TASK_STATUSES,
} from "./task-states.js";

describe("canonical task state domain contract (backend)", () => {
  describe("atomic field invariants", () => {
    it("accepts all 6 canonical task statuses", () => {
      for (const status of VALID_TASK_STATUSES) {
        assert.doesNotThrow(() => assertValidTaskStatus(status));
      }
    });

    it("rejects non-canonical statuses", () => {
      const invalidStatuses = ["open", "closed", "finished", "archived", "pending", "", null, undefined, 123];
      for (const invalid of invalidStatuses) {
        assert.throws(
          () => assertValidTaskStatus(invalid),
          (err: unknown) => err instanceof TenantConflictError && /status is invalid/.test(err.message),
        );
      }
    });

    it("accepts all 4 canonical task priorities", () => {
      for (const priority of VALID_TASK_PRIORITIES) {
        assert.doesNotThrow(() => assertValidTaskPriority(priority));
      }
    });

    it("rejects non-canonical priorities", () => {
      const invalidPriorities = ["critical", "none", "emergency", "", null, undefined];
      for (const invalid of invalidPriorities) {
        assert.throws(
          () => assertValidTaskPriority(invalid),
          (err: unknown) => err instanceof TenantConflictError && /priority is invalid/.test(err.message),
        );
      }
    });

    it("accepts valid integer progress between 0 and 100", () => {
      for (const progress of [0, 1, 50, 99, 100]) {
        assert.doesNotThrow(() => assertValidTaskProgress(progress));
      }
    });

    it("rejects out-of-range, fractional, or non-finite progress", () => {
      const invalidProgress = [-1, 101, 50.5, NaN, Infinity, -Infinity, null, undefined, "50"];
      for (const invalid of invalidProgress) {
        assert.throws(
          () => assertValidTaskProgress(invalid),
          (err: unknown) =>
            err instanceof TenantConflictError && /progress must be an integer between 0 and 100/.test(err.message),
        );
      }
    });

    it("accepts valid date combinations (nulls, equal, or startDate <= dueDate)", () => {
      const now = new Date("2026-08-21T10:00:00Z");
      const later = new Date("2026-08-22T10:00:00Z");
      assert.doesNotThrow(() => assertValidTaskDates(null, null));
      assert.doesNotThrow(() => assertValidTaskDates(now, null));
      assert.doesNotThrow(() => assertValidTaskDates(null, later));
      assert.doesNotThrow(() => assertValidTaskDates(now, now));
      assert.doesNotThrow(() => assertValidTaskDates(now, later));
    });

    it("rejects invalid date range (startDate > dueDate)", () => {
      const now = new Date("2026-08-21T10:00:00Z");
      const earlier = new Date("2026-08-20T10:00:00Z");
      assert.throws(
        () => assertValidTaskDates(now, earlier),
        (err: unknown) => err instanceof TenantConflictError && /startDate cannot be after dueDate/.test(err.message),
      );
    });

    it("rejects invalid date objects", () => {
      assert.throws(
        () => assertValidTaskDates(new Date("invalid"), null),
        (err: unknown) => err instanceof TenantConflictError && /startDate is invalid/.test(err.message),
      );
      assert.throws(
        () => assertValidTaskDates(null, new Date("invalid")),
        (err: unknown) => err instanceof TenantConflictError && /dueDate is invalid/.test(err.message),
      );
    });

    it("accepts valid milestone when startDate and dueDate are identical", () => {
      const date = new Date("2026-08-21T12:00:00Z");
      assert.doesNotThrow(() => assertValidMilestone(true, date, date));
      assert.doesNotThrow(() => assertValidMilestone(false, date, new Date("2026-08-25T12:00:00Z")));
    });

    it("rejects milestone when dates are missing or differ", () => {
      const d1 = new Date("2026-08-21T12:00:00Z");
      const d2 = new Date("2026-08-22T12:00:00Z");
      assert.throws(
        () => assertValidMilestone(true, null, d1),
        (err: unknown) =>
          err instanceof TenantConflictError && /milestone requires identical startDate and dueDate/.test(err.message),
      );
      assert.throws(
        () => assertValidMilestone(true, d1, null),
        (err: unknown) =>
          err instanceof TenantConflictError && /milestone requires identical startDate and dueDate/.test(err.message),
      );
      assert.throws(
        () => assertValidMilestone(true, d1, d2),
        (err: unknown) =>
          err instanceof TenantConflictError && /milestone requires identical startDate and dueDate/.test(err.message),
      );
    });

    it("normalizes and validates recurrence rule correctly", () => {
      const start = new Date("2026-08-21T10:00:00Z");
      const normalized = normalizeTaskRecurrence(
        {
          frequency: "weekly",
          interval: 2,
          weekdays: [1, 3, 5],
          timezone: "Asia/Riyadh",
        },
        start,
      );
      assert.equal(normalized.frequency, "weekly");
      assert.equal(normalized.interval, 2);
      assert.deepEqual(normalized.weekdays, [1, 3, 5]);
      assert.equal(normalized.timezone, "Asia/Riyadh");
      assert.equal(normalized.status, "active");
    });

    it("rejects invalid recurrence parameters", () => {
      const start = new Date("2026-08-21T10:00:00Z");
      assert.throws(
        () => normalizeTaskRecurrence({ frequency: "minutely" as never }, start),
        (err: unknown) => err instanceof TenantConflictError && /frequency is invalid/.test(err.message),
      );
      assert.throws(
        () => normalizeTaskRecurrence({ frequency: "daily", interval: 0 }, start),
        (err: unknown) => err instanceof TenantConflictError && /interval must be a positive integer/.test(err.message),
      );
      assert.throws(
        () => normalizeTaskRecurrence({ frequency: "weekly", weekdays: [7] }, start),
        (err: unknown) => err instanceof TenantConflictError && /weekdays must be between 0 and 6/.test(err.message),
      );
      assert.throws(
        () => normalizeTaskRecurrence({ frequency: "monthly", monthDay: 32 }, start),
        (err: unknown) => err instanceof TenantConflictError && /month day must be between 1 and 31/.test(err.message),
      );
      assert.throws(
        () =>
          normalizeTaskRecurrence(
            { frequency: "daily", startsAt: start, endsAt: new Date("2026-08-20T10:00:00Z") },
            start,
          ),
        (err: unknown) => err instanceof TenantConflictError && /end must be after its start/.test(err.message),
      );
    });
  });

  describe("resolveTaskStateCreation", () => {
    it("creates task with default canonical state (todo, medium, progress 0)", () => {
      const res = resolveTaskStateCreation({});
      assert.equal(res.status, "todo");
      assert.equal(res.priority, "medium");
      assert.equal(res.progress, 0);
      assert.equal(res.startDate, null);
      assert.equal(res.dueDate, null);
      assert.equal(res.isMilestone, false);
      assert.equal(res.isRecurring, false);
      assert.equal(res.timezone, "UTC");
    });

    it("enforces progress = 100 when status is done on creation", () => {
      const res = resolveTaskStateCreation({ status: "done", progress: 20 });
      assert.equal(res.status, "done");
      assert.equal(res.progress, 100);
    });

    it("preserves progress = 100 on non-done status without mutating status to done", () => {
      const res = resolveTaskStateCreation({ status: "in_progress", progress: 100 });
      assert.equal(res.status, "in_progress");
      assert.equal(res.progress, 100);
    });

    it("preserves progress on canceled status on creation", () => {
      const res = resolveTaskStateCreation({ status: "canceled", progress: 45 });
      assert.equal(res.status, "canceled");
      assert.equal(res.progress, 45);
    });

    it("creates valid milestone with identical dates", () => {
      const date = new Date("2026-08-25T09:00:00Z");
      const res = resolveTaskStateCreation({
        isMilestone: true,
        startDate: date,
        dueDate: date,
      });
      assert.equal(res.isMilestone, true);
      assert.equal(res.startDate?.getTime(), date.getTime());
      assert.equal(res.dueDate?.getTime(), date.getTime());
    });

    it("rejects milestone creation with differing dates", () => {
      assert.throws(
        () =>
          resolveTaskStateCreation({
            isMilestone: true,
            startDate: new Date("2026-08-25T09:00:00Z"),
            dueDate: new Date("2026-08-26T09:00:00Z"),
          }),
        (err: unknown) =>
          err instanceof TenantConflictError && /milestone requires identical startDate and dueDate/.test(err.message),
      );
    });

    it("rejects creation with isRecurring = false and recurrence provided", () => {
      assert.throws(
        () =>
          resolveTaskStateCreation({
            isRecurring: false,
            recurrence: { frequency: "daily" },
          }),
        (err: unknown) =>
          err instanceof TenantConflictError &&
          /isRecurring cannot be false when recurrence is provided/.test(err.message),
      );
    });
  });

  describe("resolveTaskStateUpdate", () => {
    const current = {
      status: "in_progress" as const,
      priority: "medium" as const,
      progress: 40,
      startDate: new Date("2026-08-21T09:00:00Z"),
      dueDate: new Date("2026-08-25T18:00:00Z"),
      timezone: "UTC",
      isMilestone: false,
      isRecurring: false,
    };

    it("transitions status to done and automatically sets progress = 100", () => {
      const res = resolveTaskStateUpdate(current, { status: "done" });
      assert.equal(res.state.status, "done");
      assert.equal(res.state.progress, 100);
      assert.equal(res.statusChanged, true);
      assert.equal(res.progressChanged, true);
      assert.equal(res.hasStateChange, true);
    });

    it("preserves status when setting progress = 100 without status change", () => {
      const res = resolveTaskStateUpdate(current, { progress: 100 });
      assert.equal(res.state.status, "in_progress");
      assert.equal(res.state.progress, 100);
      assert.equal(res.statusChanged, false);
      assert.equal(res.progressChanged, true);
      assert.equal(res.hasStateChange, true);
    });

    it("preserves progress when transitioning to canceled", () => {
      const res = resolveTaskStateUpdate(current, { status: "canceled" });
      assert.equal(res.state.status, "canceled");
      assert.equal(res.state.progress, 40);
      assert.equal(res.statusChanged, true);
      assert.equal(res.progressChanged, false);
    });

    it("reopening a canceled task preserves its progress", () => {
      const canceled = { ...current, status: "canceled" as const, progress: 65 };
      const res = resolveTaskStateUpdate(canceled, { status: "in_progress" });
      assert.equal(res.state.status, "in_progress");
      assert.equal(res.state.progress, 65);
      assert.equal(res.statusChanged, true);
      assert.equal(res.progressChanged, false);
    });

    it("converts milestone to normal task when isMilestone: false is explicitly set", () => {
      const milestoneCurrent = {
        ...current,
        isMilestone: true,
        startDate: new Date("2026-08-25T09:00:00Z"),
        dueDate: new Date("2026-08-25T09:00:00Z"),
      };
      const res = resolveTaskStateUpdate(milestoneCurrent, {
        isMilestone: false,
        dueDate: new Date("2026-08-30T18:00:00Z"),
      });
      assert.equal(res.state.isMilestone, false);
      assert.equal(res.milestoneChanged, true);
      assert.equal(res.datesChanged, true);
      assert.equal(res.hasStateChange, true);
    });

    it("rejects extending dueDate on an existing milestone without setting isMilestone: false", () => {
      const milestoneCurrent = {
        ...current,
        isMilestone: true,
        startDate: new Date("2026-08-25T09:00:00Z"),
        dueDate: new Date("2026-08-25T09:00:00Z"),
      };
      assert.throws(
        () => resolveTaskStateUpdate(milestoneCurrent, { dueDate: new Date("2026-08-30T18:00:00Z") }),
        (err: unknown) =>
          err instanceof TenantConflictError && /milestone requires identical startDate and dueDate/.test(err.message),
      );
    });

    it("rejects update with startDate > dueDate", () => {
      assert.throws(
        () =>
          resolveTaskStateUpdate(current, {
            startDate: new Date("2026-08-28T09:00:00Z"),
            dueDate: new Date("2026-08-22T09:00:00Z"),
          }),
        (err: unknown) => err instanceof TenantConflictError && /startDate cannot be after dueDate/.test(err.message),
      );
    });

    it("detects exact state no-ops", () => {
      const doneCurrent = {
        ...current,
        status: "done" as const,
        progress: 100,
      };
      const noopDone = resolveTaskStateUpdate(doneCurrent, { status: "done" });
      assert.equal(noopDone.hasStateChange, false);
      assert.equal(noopDone.statusChanged, false);
      assert.equal(noopDone.progressChanged, false);

      const noopProgress = resolveTaskStateUpdate(current, { progress: 40 });
      assert.equal(noopProgress.hasStateChange, false);

      const noopDates = resolveTaskStateUpdate(current, {
        startDate: new Date("2026-08-21T09:00:00Z"),
        dueDate: new Date("2026-08-25T18:00:00Z"),
      });
      assert.equal(noopDates.hasStateChange, false);
    });
  });
});
