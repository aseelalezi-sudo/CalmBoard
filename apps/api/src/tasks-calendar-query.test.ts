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

    // Offset timestamps (Tokyo +09:00, Riyadh +03:00, NY -04:00)
    const tokyoDate = parseQueryDate("2026-08-01T00:00:00+09:00", "calendarFrom");
    assert.ok(tokyoDate instanceof Date);
    assert.equal(tokyoDate.toISOString(), "2026-07-31T15:00:00.000Z");

    const riyadhDate = parseQueryDate("2026-08-01T00:00:00+03:00", "calendarFrom");
    assert.ok(riyadhDate instanceof Date);
    assert.equal(riyadhDate.toISOString(), "2026-07-31T21:00:00.000Z");

    const nyDate = parseQueryDate("2026-08-01T00:00:00-04:00", "calendarFrom");
    assert.ok(nyDate instanceof Date);
    assert.equal(nyDate.toISOString(), "2026-08-01T04:00:00.000Z");
  });
});
