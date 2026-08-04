import assert from "node:assert/strict";
import test from "node:test";
import type { Task } from "@/lib/types";
import { calendarDayKey } from "./task-calendar-range";
import { buildTaskGanttModel, buildTaskGanttSegments } from "./task-gantt-model";

function task(overrides: Partial<Task> & Pick<Task, "id" | "serial" | "title">): Task {
  return {
    description: "",
    status: "todo",
    priority: "medium",
    projectId: "project-1",
    workspaceId: "workspace-1",
    organizationId: "organization-1",
    tags: [],
    progress: 0,
    order: 0,
    timezone: "Asia/Riyadh",
    createdAt: "2026-07-01T12:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

test("real task Gantt model", async (t) => {
  const tasks = [
    task({
      id: "a",
      serial: "TASK-1",
      title: "Foundation",
      startDate: "2026-07-28T12:00:00.000Z",
      dueDate: "2026-07-30T12:00:00.000Z",
    }),
    task({
      id: "b",
      serial: "TASK-2",
      title: "Delivery",
      startDate: "2026-07-31T12:00:00.000Z",
      dueDate: "2026-08-02T12:00:00.000Z",
      dependencies: ["TASK-1", "TASK-X", "TASK-1"],
      dependencyLinks: [
        {
          blockingTaskId: "a",
          blockingTaskSerial: "TASK-1",
          type: "start_to_start",
          lagMinutes: 120,
        },
        {
          blockingTaskId: "missing",
          blockingTaskSerial: "TASK-X",
          type: "finish_to_start",
          lagMinutes: 0,
        },
      ],
    }),
    task({
      id: "c",
      serial: "TASK-3",
      title: "Review",
      dueDate: "2026-07-29T12:00:00.000Z",
    }),
    task({
      id: "d",
      serial: "TASK-4",
      title: "Invalid",
      startDate: "2026-08-03T12:00:00.000Z",
      dueDate: "2026-08-02T12:00:00.000Z",
    }),
    task({ id: "e", serial: "TASK-5", title: "Unscheduled" }),
  ];

  await t.test("uses only real task dates and inclusive durations", () => {
    const model = buildTaskGanttModel(tasks);
    assert.equal(calendarDayKey(model.rangeStart!), "2026-07-28");
    assert.equal(calendarDayKey(model.rangeEnd!), "2026-08-02");
    assert.equal(model.totalDays, 6);
    assert.deepEqual(
      model.bars.map((bar) => [bar.task.id, bar.startOffset, bar.durationDays]),
      [
        ["a", 0, 3],
        ["c", 1, 1],
        ["b", 3, 3],
      ],
    );
    assert.deepEqual(model.unscheduledTaskIds, ["e"]);
    assert.deepEqual(model.invalidTaskIds, ["d"]);
  });

  await t.test("maps actual dependency serials to scheduled task rows", () => {
    const model = buildTaskGanttModel(tasks);
    assert.equal(model.dependencyReferences, 2);
    assert.deepEqual(model.missingDependencySerials, ["TASK-X"]);
    assert.deepEqual(model.links, [
      {
        blockingTaskId: "a",
        dependentTaskId: "b",
        type: "start_to_start",
        lagMinutes: 120,
        blockingRow: 0,
        dependentRow: 2,
      },
    ]);
  });

  await t.test("builds calendar-aligned week and real month segments", () => {
    const model = buildTaskGanttModel(tasks);
    const weeks = buildTaskGanttSegments(model.rangeStart!, model.totalDays, "weeks", 6);
    assert.deepEqual(
      weeks.map((segment) => [calendarDayKey(segment.periodStart), segment.startOffset, segment.dayCount]),
      [
        ["2026-07-25", 0, 4],
        ["2026-08-01", 4, 2],
      ],
    );
    const months = buildTaskGanttSegments(model.rangeStart!, model.totalDays, "months", 6);
    assert.deepEqual(
      months.map((segment) => [calendarDayKey(segment.periodStart), segment.startOffset, segment.dayCount]),
      [
        ["2026-07-01", 0, 4],
        ["2026-08-01", 4, 2],
      ],
    );
  });
});
