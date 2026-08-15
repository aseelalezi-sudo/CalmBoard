import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fmtMinutes, fmtNumber } from "./types";

describe("localized display formatting", () => {
  it("formats durations with locale-appropriate digits and units", () => {
    assert.equal(fmtMinutes(125, "en"), "2h 5m");
    assert.equal(fmtMinutes(125, "ar"), "٢ س ٥ د");
  });

  it("formats interface numbers using the selected locale", () => {
    assert.equal(fmtNumber(1234, "en"), "1,234");
    assert.equal(fmtNumber(1234, "ar"), "١٬٢٣٤");
    assert.equal(fmtNumber(4, "ar", { minimumIntegerDigits: 2, useGrouping: false }), "٠٤");
  });

  it("uses localized counts on active management screens", () => {
    for (const file of [
      "../features/members/members-view.tsx",
      "../features/settings/settings-view.tsx",
      "../features/billing/billing-view.tsx",
      "../features/automations/automation-view.tsx",
      "../features/goals/goals-view.tsx",
      "../features/permissions/permissions-view.tsx",
      "../features/time/time-view.tsx",
    ]) {
      assert.match(readFileSync(new URL(file, import.meta.url), "utf8"), /fmtNumber\(/);
    }
    const time = readFileSync(new URL("../features/time/time-view.tsx", import.meta.url), "utf8");
    assert.match(time, /minimumIntegerDigits: 2, useGrouping: false/);
    assert.doesNotMatch(time, /String\(value\)\.padStart/);
  });
});
