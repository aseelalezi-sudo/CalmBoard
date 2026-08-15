import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { taskReminderTime } from "./task-reminders";

describe("task reminder presets", () => {
  const now = new Date("2026-08-13T10:00:00.000Z");

  it("converts relative presets into valid persisted timestamps", () => {
    assert.equal(taskReminderTime("1h", now), "2026-08-13T11:00:00.000Z");
    assert.equal(taskReminderTime("2h_before", now, "2026-08-14T10:00:00.000Z"), "2026-08-14T08:00:00.000Z");
    assert.doesNotThrow(() => new Date(taskReminderTime("tomorrow", now)!).toISOString());
  });

  it("rejects a missing, invalid, or already elapsed due-date reminder", () => {
    assert.equal(taskReminderTime("2h_before", now), null);
    assert.equal(taskReminderTime("2h_before", now, "invalid"), null);
    assert.equal(taskReminderTime("2h_before", now, "2026-08-13T11:00:00.000Z"), null);
  });
});
