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
  taskDayKey,
  taskOccursOnCalendarDay,
  visibleCalendarQueryRange,
} from "./task-calendar-range";

test("task calendar date ranges and timezone semantics", async (t) => {
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

  await t.test("builds visible query ranges with exact UTC boundaries", () => {
    const anchor = new Date(2026, 6, 29);
    const dayRange = visibleCalendarQueryRange(anchor, "day", 6);
    assert.equal(dayRange.days.length, 1);
    assert.equal(dayRange.calendarFrom, "2026-07-29T00:00:00.000Z");
    assert.equal(dayRange.calendarTo, "2026-07-29T23:59:59.999Z");

    const weekRange = visibleCalendarQueryRange(anchor, "week", 6);
    assert.equal(weekRange.days.length, 7);
    assert.equal(weekRange.calendarFrom, "2026-07-25T00:00:00.000Z");
    assert.equal(weekRange.calendarTo, "2026-07-31T23:59:59.999Z");

    const monthRange = visibleCalendarQueryRange(anchor, "month", 6);
    assert.equal(monthRange.days.length, 42);
    assert.equal(monthRange.calendarFrom, "2026-06-27T00:00:00.000Z");
    assert.equal(monthRange.calendarTo, "2026-08-07T23:59:59.999Z");
  });

  await t.test("moves the anchor according to the active view", () => {
    const anchor = new Date(2026, 0, 31);
    assert.equal(calendarDayKey(shiftCalendarAnchor(anchor, "day", 1)), "2026-02-01");
    assert.equal(calendarDayKey(shiftCalendarAnchor(anchor, "week", -1)), "2026-01-24");
    assert.equal(calendarDayKey(shiftCalendarAnchor(anchor, "month", 1)), "2026-02-01");
  });

  await t.test("formats taskDayKey accurately across UTC, positive and negative timezone offsets", () => {
    const utcTimestamp = "2026-08-20T02:00:00.000Z";
    assert.equal(taskDayKey(utcTimestamp, "UTC"), "2026-08-20");
    assert.equal(taskDayKey(utcTimestamp, "Asia/Riyadh"), "2026-08-20"); // +03:00 -> 05:00 on 2026-08-20
    assert.equal(taskDayKey(utcTimestamp, "America/New_York"), "2026-08-19"); // -04:00 -> 22:00 on 2026-08-19

    const noonTimestamp = "2026-08-20T12:00:00.000Z";
    assert.equal(taskDayKey(noonTimestamp, "UTC"), "2026-08-20");
    assert.equal(taskDayKey(noonTimestamp, "Asia/Tokyo"), "2026-08-20"); // +09:00 -> 21:00 on 2026-08-20
    assert.equal(taskDayKey(noonTimestamp, "America/New_York"), "2026-08-20"); // -04:00 -> 08:00 on 2026-08-20
  });

  await t.test("evaluates taskOccursOnCalendarDay correctly across edge cases", () => {
    // 1. Fully inside multi-day
    const multiDay = {
      startDate: "2026-07-28T09:00:00.000Z",
      dueDate: "2026-07-30T17:00:00.000Z",
      timezone: "UTC",
    };
    assert.equal(taskOccursOnCalendarDay(multiDay, new Date(2026, 6, 27)), false);
    assert.equal(taskOccursOnCalendarDay(multiDay, new Date(2026, 6, 28)), true);
    assert.equal(taskOccursOnCalendarDay(multiDay, new Date(2026, 6, 29)), true);
    assert.equal(taskOccursOnCalendarDay(multiDay, new Date(2026, 6, 30)), true);
    assert.equal(taskOccursOnCalendarDay(multiDay, new Date(2026, 6, 31)), false);

    // 2. Start only
    const startOnly = { startDate: "2026-07-29T12:00:00.000Z", dueDate: null, timezone: "UTC" };
    assert.equal(taskOccursOnCalendarDay(startOnly, new Date(2026, 6, 28)), false);
    assert.equal(taskOccursOnCalendarDay(startOnly, new Date(2026, 6, 29)), true);
    assert.equal(taskOccursOnCalendarDay(startOnly, new Date(2026, 6, 30)), false);

    // 3. Due only
    const dueOnly = { startDate: null, dueDate: "2026-07-29T12:00:00.000Z", timezone: "UTC" };
    assert.equal(taskOccursOnCalendarDay(dueOnly, new Date(2026, 6, 28)), false);
    assert.equal(taskOccursOnCalendarDay(dueOnly, new Date(2026, 6, 29)), true);
    assert.equal(taskOccursOnCalendarDay(dueOnly, new Date(2026, 6, 30)), false);

    // 4. Both null (dateless)
    const dateless = { startDate: null, dueDate: null };
    assert.equal(taskOccursOnCalendarDay(dateless, new Date(2026, 6, 29)), false);

    // 5. Milestone
    const milestone = {
      startDate: "2026-07-29T12:00:00.000Z",
      dueDate: "2026-07-29T12:00:00.000Z",
      isMilestone: true,
      timezone: "UTC",
    };
    assert.equal(taskOccursOnCalendarDay(milestone, new Date(2026, 6, 28)), false);
    assert.equal(taskOccursOnCalendarDay(milestone, new Date(2026, 6, 29)), true);
    assert.equal(taskOccursOnCalendarDay(milestone, new Date(2026, 6, 30)), false);

    // 6. Month boundary span
    const monthSpan = {
      startDate: "2026-07-30T10:00:00.000Z",
      dueDate: "2026-08-02T18:00:00.000Z",
      timezone: "UTC",
    };
    assert.equal(taskOccursOnCalendarDay(monthSpan, new Date(2026, 6, 29)), false);
    assert.equal(taskOccursOnCalendarDay(monthSpan, new Date(2026, 6, 31)), true);
    assert.equal(taskOccursOnCalendarDay(monthSpan, new Date(2026, 7, 1)), true);
    assert.equal(taskOccursOnCalendarDay(monthSpan, new Date(2026, 7, 2)), true);
    assert.equal(taskOccursOnCalendarDay(monthSpan, new Date(2026, 7, 3)), false);
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
