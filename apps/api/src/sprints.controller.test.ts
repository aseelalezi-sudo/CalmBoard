import assert from "node:assert/strict";
import test from "node:test";
import {
  parseCreateSprintInput,
  parseUpdateSprintInput,
  parseCompleteSprintInput,
  parseMoveTaskSprintInput,
  parseSprintStatus,
} from "./sprint-validation.js";

test("parseSprintStatus validates allowed statuses", () => {
  assert.equal(parseSprintStatus("planned"), "planned");
  assert.equal(parseSprintStatus("active"), "active");
  assert.equal(parseSprintStatus("completed"), "completed");
  assert.equal(parseSprintStatus("cancelled"), "cancelled");
  assert.throws(() => parseSprintStatus("invalid"), /invalid/);
});

test("parseCreateSprintInput validates dates and fields", () => {
  const input = {
    name: "Sprint 1",
    goal: "Finish something",
    startsAt: "2026-08-01T00:00:00Z",
    endsAt: "2026-08-15T00:00:00Z",
  };
  const parsed = parseCreateSprintInput(input);
  assert.equal(parsed.name, "Sprint 1");
  assert.equal(parsed.goal, "Finish something");
  assert.ok(parsed.startsAt instanceof Date);
  assert.ok(parsed.endsAt instanceof Date);

  assert.throws(
    () => parseCreateSprintInput({ name: "A", startsAt: "2026-08-15T00:00:00Z", endsAt: "2026-08-01T00:00:00Z" }),
    /startsAt must be before endsAt/,
  );
});

test("parseUpdateSprintInput rejects generic lifecycle modifications", () => {
  const input = { name: "Updated Sprint", status: "active" };
  assert.throws(() => parseUpdateSprintInput(input), /Field status cannot be modified via generic update/);

  const valid = { name: "Valid update" };
  const parsed = parseUpdateSprintInput(valid);
  assert.equal(parsed.name, "Valid update");
});

test("parseCompleteSprintInput validates destination", () => {
  const inputBacklog = { incompleteTaskDestination: { type: "backlog" } };
  assert.deepEqual(parseCompleteSprintInput(inputBacklog), { type: "backlog" });

  const inputSprint = { incompleteTaskDestination: { type: "sprint", sprintId: "target-id" } };
  assert.deepEqual(parseCompleteSprintInput(inputSprint), { type: "sprint", sprintId: "target-id" });

  assert.throws(() => parseCompleteSprintInput({}), /incompleteTaskDestination must be provided/);
});

test("parseMoveTaskSprintInput validates target and expected source", () => {
  const input = { targetSprintId: "target", expectedFromSprintId: "source" };
  const parsed = parseMoveTaskSprintInput(input);
  assert.equal(parsed.targetSprintId, "target");
  assert.equal(parsed.expectedFromSprintId, "source");

  const fromBacklog = parseMoveTaskSprintInput({ targetSprintId: "target", expectedFromSprintId: null });
  assert.equal(fromBacklog.expectedFromSprintId, null);
});
