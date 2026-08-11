import assert from "node:assert/strict";
import test from "node:test";
import type { Sprint, Task } from "@/lib/types";
import { groupSprintPlanning, sprintAccess, sprintSummary, validateSprintForm } from "./sprint-domain";

const task = (id: string, projectId: string, sprintId: string | null, status = "todo", storyPoints = 0) =>
  ({
    id,
    projectId,
    sprintId,
    status,
    storyPoints,
  }) as Task;

const sprint = (id: string, status: Sprint["status"]) => ({ id, status, projectId: "p1" }) as Sprint;

test("Sprint planning groups only current-project tasks and preserves historical attribution", () => {
  const sprints = [sprint("active", "active"), sprint("planned", "planned"), sprint("past", "completed")];
  const result = groupSprintPlanning(
    [
      task("backlog", "p1", null),
      task("active-task", "p1", "active"),
      task("past-task", "p1", "past", "done"),
      task("other-project", "p2", null),
    ],
    sprints,
    "p1",
  );

  assert.deepEqual(
    result.backlog.map(({ id }) => id),
    ["backlog"],
  );
  assert.deepEqual(
    result.bySprint.get("past")?.map(({ id }) => id),
    ["past-task"],
  );
  assert.deepEqual(
    result.writableTasks.map(({ id }) => id),
    ["backlog", "active-task"],
  );
});

test("Sprint summaries calculate task and points completion context", () => {
  assert.deepEqual(sprintSummary([task("a", "p1", "s1", "done", 5), task("b", "p1", "s1", "todo", 3)]), {
    taskCount: 2,
    completedCount: 1,
    incompleteCount: 1,
    storyPoints: 8,
    completedStoryPoints: 5,
    progress: 50,
  });
});

test("Sprint form validation requires a name and chronological dates", () => {
  assert.equal(validateSprintForm({ name: "" }), "name");
  assert.equal(validateSprintForm({ name: "Sprint", startsAt: "2026-08-10", endsAt: "2026-08-01" }), "range");
  assert.equal(validateSprintForm({ name: "Sprint", startsAt: "2026-08-01", endsAt: "2026-08-10" }), null);
});

test("Sprint permissions distinguish viewer and manager behavior", () => {
  assert.deepEqual(
    sprintAccess((permission) => permission === "sprints.view"),
    { canView: true, canManage: false },
  );
  assert.deepEqual(
    sprintAccess(() => true),
    { canView: true, canManage: true },
  );
});
