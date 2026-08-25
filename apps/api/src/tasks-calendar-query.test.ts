import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseQueryDate } from "./tasks.controller.js";

describe("calendar date query validation", () => {
  it("parses valid ISO timestamps and rejects invalid date formats", () => {
    const parsedFrom = parseQueryDate("2026-07-25T00:00:00.000Z", "calendarFrom");
    assert.ok(parsedFrom instanceof Date);
    assert.equal(parsedFrom.toISOString(), "2026-07-25T00:00:00.000Z");

    const parsedTo = parseQueryDate("2026-08-07T23:59:59.999Z", "calendarTo");
    assert.ok(parsedTo instanceof Date);
    assert.equal(parsedTo.toISOString(), "2026-08-07T23:59:59.999Z");

    assert.throws(() => parseQueryDate("not-a-date", "calendarFrom"), /calendarFrom must be a valid date/);
    assert.throws(() => parseQueryDate("2026-99-99", "calendarTo"), /calendarTo must be a valid date/);
  });
});
