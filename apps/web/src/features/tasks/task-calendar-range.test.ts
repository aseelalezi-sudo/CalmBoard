import assert from "node:assert/strict";
import test from "node:test";
import {
  calendarDayDifference,
  calendarDayFromKey,
  calendarDayKey,
  calendarDaysForView,
  resizeTaskCalendarEnd,
  shiftCalendarAnchor,
  shiftTaskCalendarDates,
  taskOccursOnCalendarDay,
} from "./task-calendar-range";

test("task calendar date ranges", async (t) => {
  await t.test("builds stable day, week, and six-week month ranges", () => {
    const anchor = new Date(2026, 6, 29, 18, 30);
    assert.deepEqual(calendarDaysForView(anchor, "day", 6).map(calendarDayKey), ["2026-07-29"]);
    assert.deepEqual(calendarDaysForView(anchor, "week", 6).map(calendarDayKey), [
      "2026-07-25",
      "2026-07-26",
      "2026-07-27",
      "2026-07-28",
      "2026-07-29",
      "2026-07-30",
      "2026-07-31",
    ]);
    const month = calendarDaysForView(anchor, "month", 6);
    assert.equal(month.length, 42);
    assert.equal(calendarDayKey(month[0]!), "2026-06-27");
    assert.equal(calendarDayKey(month[41]!), "2026-08-07");
  });

  await t.test("moves the anchor according to the active view", () => {
    const anchor = new Date(2026, 0, 31);
    assert.equal(calendarDayKey(shiftCalendarAnchor(anchor, "day", 1)), "2026-02-01");
    assert.equal(calendarDayKey(shiftCalendarAnchor(anchor, "week", -1)), "2026-01-24");
    assert.equal(calendarDayKey(shiftCalendarAnchor(anchor, "month", 1)), "2026-02-01");
  });

  await t.test("places a task on every real day in its date span", () => {
    const task = {
      startDate: "2026-07-28T09:00:00.000Z",
      dueDate: "2026-07-30T17:00:00.000Z",
    };
    assert.equal(taskOccursOnCalendarDay(task, new Date(2026, 6, 27)), false);
    assert.equal(taskOccursOnCalendarDay(task, new Date(2026, 6, 29)), true);
    assert.equal(taskOccursOnCalendarDay(task, new Date(2026, 6, 31)), false);
  });

  await t.test("parses local day keys and measures calendar days without DST drift", () => {
    assert.equal(calendarDayKey(calendarDayFromKey("2026-08-02")!), "2026-08-02");
    assert.equal(calendarDayFromKey("2026-02-30"), null);
    assert.equal(calendarDayFromKey("02/08/2026"), null);
    assert.equal(calendarDayDifference(new Date(2026, 7, 2), new Date(2026, 6, 29)), 4);
  });

  await t.test("moves the complete task span while preserving its times", () => {
    assert.deepEqual(
      shiftTaskCalendarDates(
        {
          startDate: "2026-07-28T09:00:00.000Z",
          dueDate: "2026-07-30T17:00:00.000Z",
        },
        new Date(2026, 7, 2),
        new Date(2026, 6, 29),
      ),
      {
        startDate: "2026-08-01T09:00:00.000Z",
        dueDate: "2026-08-03T17:00:00.000Z",
      },
    );
    assert.deepEqual(
      shiftTaskCalendarDates({ dueDate: "2026-07-30T17:00:00.000Z" }, new Date(2026, 7, 2), new Date(2026, 6, 30)),
      { startDate: undefined, dueDate: "2026-08-02T17:00:00.000Z" },
    );
  });

  await t.test("extends a due-only task into a range and rejects an end before its start", () => {
    assert.deepEqual(resizeTaskCalendarEnd({ dueDate: "2026-07-30T17:00:00.000Z" }, new Date(2026, 7, 2)), {
      startDate: "2026-07-30T17:00:00.000Z",
      dueDate: "2026-08-02T17:00:00.000Z",
    });
    assert.equal(
      resizeTaskCalendarEnd(
        {
          startDate: "2026-07-30T09:00:00.000Z",
          dueDate: "2026-08-02T17:00:00.000Z",
        },
        new Date(2026, 6, 29),
      ),
      null,
    );
  });
});
