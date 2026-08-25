import assert from "node:assert/strict";
import test from "node:test";
import {
  calendarDayDifference,
  calendarDayFromKey,
  calendarDayKey,
  calendarDaysForView,
  matchesTaskFilters,
  resizeTaskCalendarEnd,
  shiftCalendarAnchor,
  shiftTaskCalendarDates,
  taskDayKey,
  taskOccursOnCalendarDay,
  taskOccursWithinVisibleRange,
  visibleCalendarQueryRange,
  zonedTimeToUtc,
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

  await t.test("builds visible query ranges with exact UTC boundaries and safe query envelopes", () => {
    const anchor = new Date(2026, 6, 29);
    const dayRange = visibleCalendarQueryRange(anchor, "day", 6);
    assert.equal(dayRange.days.length, 1);
    assert.equal(dayRange.rangeStart.toISOString(), "2026-07-29T00:00:00.000Z");
    assert.equal(dayRange.rangeEnd.toISOString(), "2026-07-29T23:59:59.999Z");
    assert.equal(dayRange.calendarFrom, "2026-07-28T00:00:00.000Z");
    assert.equal(dayRange.calendarTo, "2026-07-30T23:59:59.999Z");

    const weekRange = visibleCalendarQueryRange(anchor, "week", 6);
    assert.equal(weekRange.days.length, 7);
    assert.equal(weekRange.rangeStart.toISOString(), "2026-07-25T00:00:00.000Z");
    assert.equal(weekRange.rangeEnd.toISOString(), "2026-07-31T23:59:59.999Z");
    assert.equal(weekRange.calendarFrom, "2026-07-24T00:00:00.000Z");
    assert.equal(weekRange.calendarTo, "2026-08-01T23:59:59.999Z");

    const monthRange = visibleCalendarQueryRange(anchor, "month", 6);
    assert.equal(monthRange.days.length, 42);
    assert.equal(monthRange.rangeStart.toISOString(), "2026-06-27T00:00:00.000Z");
    assert.equal(monthRange.rangeEnd.toISOString(), "2026-08-07T23:59:59.999Z");
    assert.equal(monthRange.calendarFrom, "2026-06-26T00:00:00.000Z");
    assert.equal(monthRange.calendarTo, "2026-08-08T23:59:59.999Z");
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

  await t.test("converts visibleCalendarQueryRange accurately across timezones and midnight boundaries", () => {
    const anchor = new Date(2026, 7, 1); // August 1, 2026
    const dayAnchor = new Date(2026, 7, 15);

    // 1. UTC
    const utcRange = visibleCalendarQueryRange(dayAnchor, "day", 0, "UTC");
    assert.equal(utcRange.rangeStart.toISOString(), "2026-08-15T00:00:00.000Z");
    assert.equal(utcRange.rangeEnd.toISOString(), "2026-08-15T23:59:59.999Z");
    assert.equal(utcRange.calendarFrom, "2026-08-14T00:00:00.000Z");
    assert.equal(utcRange.calendarTo, "2026-08-16T23:59:59.999Z");

    // 2. Asia/Riyadh (+03:00)
    // 2026-08-15 00:00:00 in Riyadh is 2026-08-14 21:00:00 UTC
    // 2026-08-15 23:59:59.999 in Riyadh is 2026-08-15 20:59:59.999 UTC
    const riyadhRange = visibleCalendarQueryRange(dayAnchor, "day", 0, "Asia/Riyadh");
    assert.equal(riyadhRange.rangeStart.toISOString(), "2026-08-14T21:00:00.000Z");
    assert.equal(riyadhRange.rangeEnd.toISOString(), "2026-08-15T20:59:59.999Z");
    assert.equal(riyadhRange.calendarFrom, "2026-08-13T21:00:00.000Z");
    assert.equal(riyadhRange.calendarTo, "2026-08-16T20:59:59.999Z");

    // 3. Asia/Tokyo (+09:00)
    // 2026-08-15 00:00:00 in Tokyo is 2026-08-14 15:00:00 UTC
    // 2026-08-15 23:59:59.999 in Tokyo is 2026-08-15 14:59:59.999 UTC
    const tokyoRange = visibleCalendarQueryRange(dayAnchor, "day", 0, "Asia/Tokyo");
    assert.equal(tokyoRange.rangeStart.toISOString(), "2026-08-14T15:00:00.000Z");
    assert.equal(tokyoRange.rangeEnd.toISOString(), "2026-08-15T14:59:59.999Z");
    assert.equal(tokyoRange.calendarFrom, "2026-08-13T15:00:00.000Z");
    assert.equal(tokyoRange.calendarTo, "2026-08-16T14:59:59.999Z");

    // 4. America/New_York (-04:00 EDT)
    // 2026-08-15 00:00:00 in NY is 2026-08-15 04:00:00 UTC
    // 2026-08-15 23:59:59.999 in NY is 2026-08-16 03:59:59.999 UTC
    const nyRange = visibleCalendarQueryRange(dayAnchor, "day", 0, "America/New_York");
    assert.equal(nyRange.rangeStart.toISOString(), "2026-08-15T04:00:00.000Z");
    assert.equal(nyRange.rangeEnd.toISOString(), "2026-08-16T03:59:59.999Z");
    assert.equal(nyRange.calendarFrom, "2026-08-14T04:00:00.000Z");
    assert.equal(nyRange.calendarTo, "2026-08-17T03:59:59.999Z");

    // 5. Midnight boundary task in Tokyo:
    // Task timestamp is midnight local time: 2026-08-01 00:00:00+09:00 -> 2026-07-31T15:00:00.000Z
    const tokyoTask = {
      startDate: "2026-07-31T15:00:00.000Z",
      dueDate: "2026-07-31T15:00:00.000Z",
      timezone: "Asia/Tokyo",
    };
    // When queried with UTC calendar default:
    const utcDayRange = visibleCalendarQueryRange(anchor, "day", 0, "UTC");
    // Safe envelope MUST encompass Tokyo midnight task
    assert.ok(utcDayRange.calendarFrom <= tokyoTask.startDate);
    assert.ok(utcDayRange.calendarTo >= tokyoTask.dueDate);
    // Frontend maps task to August 1 in Tokyo
    assert.equal(taskDayKey(tokyoTask.startDate, "Asia/Tokyo"), "2026-08-01");
    assert.equal(taskOccursOnCalendarDay(tokyoTask, new Date(2026, 7, 1)), true);

    // 6. Late night boundary task in New York:
    // 2026-08-01 23:30:00-04:00 -> 2026-08-02T03:30:00.000Z
    const nyTask = {
      startDate: "2026-08-02T03:30:00.000Z",
      dueDate: "2026-08-02T03:30:00.000Z",
      timezone: "America/New_York",
    };
    assert.ok(utcDayRange.calendarFrom <= nyTask.startDate);
    assert.ok(utcDayRange.calendarTo >= nyTask.dueDate);
    assert.equal(taskDayKey(nyTask.startDate, "America/New_York"), "2026-08-01");
    assert.equal(taskOccursOnCalendarDay(nyTask, new Date(2026, 7, 1)), true);
  });

  await t.test("matchesTaskFilters accurately evaluates status, priority, assignee, and search filters", () => {
    const task = {
      title: "Deploy Auth System",
      description: "Setup OAuth and passkeys",
      serial: "CB-104",
      status: "in_progress",
      priority: "urgent",
      assigneeId: "user-1",
      assigneeIds: ["user-1", "user-2"],
      assignees: [{ id: "user-1" }, { id: "user-2" }],
    };

    // All match
    assert.equal(matchesTaskFilters(task, {}), true);
    assert.equal(matchesTaskFilters(task, { status: "in_progress" }), true);
    assert.equal(matchesTaskFilters(task, { priority: "urgent" }), true);
    assert.equal(matchesTaskFilters(task, { assigneeId: "user-1" }), true);
    assert.equal(matchesTaskFilters(task, { assigneeId: "user-2" }), true);
    assert.equal(matchesTaskFilters(task, { search: "deploy" }), true);
    assert.equal(matchesTaskFilters(task, { search: "passkeys" }), true);
    assert.equal(matchesTaskFilters(task, { search: "CB-104" }), true);

    // Mismatches
    assert.equal(matchesTaskFilters(task, { status: "done" }), false);
    assert.equal(matchesTaskFilters(task, { priority: "low" }), false);
    assert.equal(matchesTaskFilters(task, { assigneeId: "user-99" }), false);
    assert.equal(matchesTaskFilters(task, { search: "unrelated query" }), false);
  });

  await t.test("taskOccursWithinVisibleRange detects whether task is in visible grid", () => {
    const days = [new Date(2026, 7, 10), new Date(2026, 7, 11), new Date(2026, 7, 12)];
    const insideTask = { startDate: "2026-08-11T10:00:00.000Z", dueDate: "2026-08-11T12:00:00.000Z", timezone: "UTC" };
    const outsideTask = { startDate: "2026-08-20T10:00:00.000Z", dueDate: "2026-08-20T12:00:00.000Z", timezone: "UTC" };

    assert.equal(taskOccursWithinVisibleRange(insideTask, days, "UTC"), true);
    assert.equal(taskOccursWithinVisibleRange(outsideTask, days, "UTC"), false);
  });
});
