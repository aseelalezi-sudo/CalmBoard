import assert from "node:assert/strict";
import test from "node:test";
import type { ProjectBaseline, Task } from "@/lib/types";
import { buildTaskGanttModel } from "./task-gantt-model";
import { compareProjectBaseline, detectScheduleConflicts } from "./task-schedule-analysis";

const base = (value: Partial<Task> & Pick<Task, "id" | "serial">): Task => ({
  title: value.serial,
  status: "todo",
  priority: "medium",
  projectId: "p",
  workspaceId: "w",
  organizationId: "o",
  tags: [],
  progress: 0,
  order: 0,
  timezone: "UTC",
  createdAt: "2026-01-01T00:00:00Z",
  version: 1,
  ...value,
});

test("schedule baseline and conflict analysis", () => {
  const tasks = [
    base({ id: "a", serial: "A", startDate: "2026-07-01T00:00:00Z", dueDate: "2026-07-03T00:00:00Z" }),
    base({
      id: "b",
      serial: "B",
      startDate: "2026-07-02T00:00:00Z",
      dueDate: "2026-07-04T00:00:00Z",
      dependencyLinks: [{ blockingTaskId: "a", blockingTaskSerial: "A", type: "finish_to_start", lagMinutes: 0 }],
    }),
  ];
  const conflicts = detectScheduleConflicts(buildTaskGanttModel(tasks));
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0]!.violationMinutes, 24 * 60);

  const baseline: ProjectBaseline = {
    id: "bl",
    organizationId: "o",
    workspaceId: "w",
    projectId: "p",
    name: "Initial",
    taskCount: 2,
    createdAt: "2026-07-01T00:00:00Z",
    tasks: [
      {
        sourceTaskId: "a",
        serial: "A",
        title: "A",
        startDate: "2026-07-01T00:00:00Z",
        dueDate: "2026-07-02T00:00:00Z",
        isMilestone: false,
        taskVersion: 1,
      },
      {
        sourceTaskId: "removed",
        serial: "OLD",
        title: "Old",
        startDate: null,
        dueDate: null,
        isMilestone: false,
        taskVersion: 1,
      },
    ],
  };
  const variances = compareProjectBaseline(tasks, baseline);
  assert.deepEqual(variances.map((item) => item.kind).sort(), ["added", "changed", "removed"]);
  assert.equal(variances.find((item) => item.taskId === "a")!.dueVarianceMinutes, 24 * 60);
});
