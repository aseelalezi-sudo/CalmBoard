import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseExpectedReportScheduleVersion, parseReportScheduleInput } from "./report-schedule-validation.js";

describe("report schedule validation", () => {
  it("normalizes a timezone-aware weekly email report", () => {
    assert.deepEqual(
      parseReportScheduleInput({
        name: " Weekly leadership ",
        format: "pdf",
        cadence: "weekly",
        timezone: "Asia/Riyadh",
        time: "08:30",
        dayOfWeek: 1,
        recipientIds: ["11111111-1111-4111-8111-111111111111"],
      }),
      {
        name: "Weekly leadership",
        format: "pdf",
        cadence: "weekly",
        timezone: "Asia/Riyadh",
        minuteOfDay: 510,
        dayOfWeek: 1,
        dayOfMonth: null,
        recipientIds: ["11111111-1111-4111-8111-111111111111"],
        isEnabled: true,
      },
    );
    assert.equal(parseExpectedReportScheduleVersion("2"), 2);
  });

  it("rejects invalid timezones, recurrence fields, and recipients", () => {
    const valid = {
      name: "Report",
      format: "xlsx",
      cadence: "monthly",
      timezone: "UTC",
      time: "09:00",
      dayOfMonth: 1,
      recipientIds: ["11111111-1111-4111-8111-111111111111"],
    };
    assert.throws(() => parseReportScheduleInput({ ...valid, timezone: "Mars/Olympus" }));
    assert.throws(() => parseReportScheduleInput({ ...valid, dayOfMonth: 31 }));
    assert.throws(() => parseReportScheduleInput({ ...valid, recipientIds: [] }));
    assert.throws(() => parseExpectedReportScheduleVersion(0));
  });
});
