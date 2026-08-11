import assert from "node:assert/strict";
import test from "node:test";
import { formatSprintMetric, sprintNumberLocale } from "./sprint-presentation";

test("Sprint metric signs remain attached to values in an explicit numeric locale", () => {
  assert.equal(sprintNumberLocale("ar"), "ar-SA");
  assert.match(formatSprintMetric(8, "en", true), /^\+8$/u);
  assert.match(formatSprintMetric(-3, "en", true), /^-3$/u);
  assert.equal(formatSprintMetric(8, "en"), "8");
});
