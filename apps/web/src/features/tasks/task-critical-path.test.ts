import assert from "node:assert/strict";
import test from "node:test";
import type { Task, TaskDependencyLink } from "@/lib/types";
import { calculateCriticalPath } from "./task-critical-path";
import { buildTaskGanttModel } from "./task-gantt-model";

const DAY_MINUTES = 24 * 60;

function task(overrides: Partial<Task> & Pick<Task, "id" | "serial">): Task {
  return {
    title: overrides.serial,
    status: "todo",
    priority: "medium",
    projectId: "project-1",
    workspaceId: "workspace-1",
    organizationId: "organization-1",
    tags: [],
    progress: 0,
    order: 0,
    timezone: "UTC",
    createdAt: "2026-07-01T00:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

function link(
  blockingTaskId: string,
  blockingTaskSerial: string,
  type: TaskDependencyLink["type"] = "finish_to_start",
  lagMinutes = 0,
): TaskDependencyLink {
  return { blockingTaskId, blockingTaskSerial, type, lagMinutes };
}

test("critical path method", async (t) => {
  await t.test("calculates earliest/latest dates and float on a real dependency network", () => {
    const model = buildTaskGanttModel([
      task({
        id: "a",
        serial: "A",
        startDate: "2026-07-28T00:00:00.000Z",
        dueDate: "2026-07-30T00:00:00.000Z",
      }),
      task({
        id: "c",
        serial: "C",
        startDate: "2026-07-28T00:00:00.000Z",
        dueDate: "2026-07-29T00:00:00.000Z",
        dependencyLinks: [link("a", "A", "start_to_start")],
      }),
      task({
        id: "b",
        serial: "B",
        startDate: "2026-07-30T00:00:00.000Z",
        dueDate: "2026-07-31T00:00:00.000Z",
        dependencyLinks: [link("a", "A")],
      }),
      task({
        id: "d",
        serial: "D",
        startDate: "2026-07-31T00:00:00.000Z",
        dueDate: "2026-08-01T00:00:00.000Z",
        dependencyLinks: [link("b", "B"), link("c", "C")],
      }),
    ]);

    const result = calculateCriticalPath(model);
    assert.equal(result.status, "computed");
    if (result.status !== "computed") return;
    assert.equal(result.projectDurationMinutes, 4 * DAY_MINUTES);
    assert.deepEqual(result.criticalTaskIds, ["a", "b", "d"]);
    assert.deepEqual(
      result.criticalLinks.map((item) => `${item.blockingTaskId}->${item.dependentTaskId}`),
      ["a->b", "b->d"],
    );
    const floatByTask = new Map(result.metrics.map((metric) => [metric.taskId, metric.totalFloatMinutes]));
    assert.equal(floatByTask.get("c"), 2 * DAY_MINUTES);
  });

  await t.test("honors finish-to-finish and lag constraints", () => {
    const model = buildTaskGanttModel([
      task({
        id: "a",
        serial: "A",
        startDate: "2026-07-28T00:00:00.000Z",
        dueDate: "2026-07-30T00:00:00.000Z",
      }),
      task({
        id: "b",
        serial: "B",
        startDate: "2026-07-30T00:00:00.000Z",
        dueDate: "2026-07-31T00:00:00.000Z",
        dependencyLinks: [link("a", "A", "finish_to_finish", DAY_MINUTES)],
      }),
    ]);
    const result = calculateCriticalPath(model);
    assert.equal(result.status, "computed");
    if (result.status !== "computed") return;
    const metric = result.metrics.find((item) => item.taskId === "b")!;
    assert.equal(metric.earliestStartMinutes, 2 * DAY_MINUTES);
    assert.equal(result.projectDurationMinutes, 3 * DAY_MINUTES);
  });

  await t.test("fails closed for incomplete or cyclic dependency graphs", () => {
    const incomplete = buildTaskGanttModel([
      task({
        id: "a",
        serial: "A",
        startDate: "2026-07-28T00:00:00.000Z",
        dueDate: "2026-07-29T00:00:00.000Z",
        dependencyLinks: [link("missing", "MISSING")],
      }),
    ]);
    assert.equal(calculateCriticalPath(incomplete).status, "incomplete_dependencies");

    const cyclic = buildTaskGanttModel([
      task({
        id: "a",
        serial: "A",
        startDate: "2026-07-28T00:00:00.000Z",
        dueDate: "2026-07-29T00:00:00.000Z",
        dependencyLinks: [link("b", "B")],
      }),
      task({
        id: "b",
        serial: "B",
        startDate: "2026-07-29T00:00:00.000Z",
        dueDate: "2026-07-30T00:00:00.000Z",
        dependencyLinks: [link("a", "A")],
      }),
    ]);
    assert.equal(calculateCriticalPath(cyclic).status, "cyclic_dependencies");
  });
});
