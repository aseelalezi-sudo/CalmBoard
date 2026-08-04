import assert from "node:assert/strict";
import test from "node:test";
import { parseWorkloadCapacityInput, parseWorkloadRange, parseWorkloadTimeOffInput } from "./workload-validation";

test("workload input accepts bounded capacity and valid time off", () => {
  assert.deepEqual(parseWorkloadCapacityInput({ weeklyMinutes: 2100, workdayMask: 62 }, "member"), {
    userId: "member",
    weeklyMinutes: 2100,
    workdayMask: 62,
  });
  assert.deepEqual(
    parseWorkloadTimeOffInput({
      userId: "member",
      kind: "vacation",
      startsOn: "2026-07-27",
      endsOn: "2026-07-29",
      minutesPerDay: 240,
    }),
    {
      userId: "member",
      kind: "vacation",
      startsOn: "2026-07-27",
      endsOn: "2026-07-29",
      minutesPerDay: 240,
      note: undefined,
    },
  );
  assert.deepEqual(parseWorkloadRange("2026-07-27", "2026-08-02"), {
    rangeStart: "2026-07-27",
    rangeEnd: "2026-08-02",
  });
});

test("workload input rejects invalid ranges, dates, and capacity", () => {
  assert.throws(() => parseWorkloadCapacityInput({ weeklyMinutes: -1, workdayMask: 62 }, "member"));
  assert.throws(() => parseWorkloadRange("2026-08-02", "2026-07-27"));
  assert.throws(() => parseWorkloadTimeOffInput({ kind: "unknown", startsOn: "2026-07-27", endsOn: "2026-07-28" }));
  assert.throws(() =>
    parseWorkloadTimeOffInput({ kind: "public_holiday", startsOn: "not-a-date", endsOn: "2026-07-28" }),
  );
  assert.throws(() =>
    parseWorkloadTimeOffInput({ kind: "public_holiday", startsOn: "2026-02-30", endsOn: "2026-03-01" }),
  );
});
