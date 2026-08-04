import assert from "node:assert/strict";
import test from "node:test";
import type { Task, User, WorkloadCapacity, WorkloadTimeOff } from "@/lib/types";
import { calculateWeeklyWorkload } from "./workload-analysis";

const users: User[] = [
  { id: "a", name: "A", email: "a@example.com" },
  { id: "b", name: "B", email: "b@example.com" },
];

const task = (value: Partial<Task> & Pick<Task, "id">): Task => ({
  serial: value.id.toUpperCase(),
  title: value.id,
  organizationId: "o",
  workspaceId: "w",
  projectId: "p",
  status: "todo",
  priority: "medium",
  progress: 0,
  order: 0,
  tags: [],
  timezone: "UTC",
  version: 1,
  createdAt: "2026-07-01T00:00:00Z",
  ...value,
});

test("weekly workload uses persisted capacity, assignments, time off, and real task dates", () => {
  const capacities: WorkloadCapacity[] = [
    {
      id: "c",
      organizationId: "o",
      workspaceId: "w",
      userId: "a",
      weeklyMinutes: 2400,
      workdayMask: 62,
      createdAt: "2026-07-01T00:00:00Z",
      updatedAt: "2026-07-01T00:00:00Z",
    },
  ];
  const timeOff: WorkloadTimeOff[] = [
    {
      id: "holiday",
      organizationId: "o",
      workspaceId: "w",
      kind: "public_holiday",
      status: "approved",
      startsOn: "2026-07-27",
      endsOn: "2026-07-27",
      createdAt: "2026-07-01T00:00:00Z",
      updatedAt: "2026-07-01T00:00:00Z",
    },
    {
      id: "leave",
      organizationId: "o",
      workspaceId: "w",
      userId: "a",
      kind: "personal",
      status: "approved",
      startsOn: "2026-07-28",
      endsOn: "2026-07-28",
      minutesPerDay: 240,
      createdAt: "2026-07-01T00:00:00Z",
      updatedAt: "2026-07-01T00:00:00Z",
    },
  ];
  const result = calculateWeeklyWorkload({
    users,
    capacities,
    timeOff,
    weekStart: new Date("2026-07-29T12:00:00Z"),
    tasks: [
      task({
        id: "one",
        assigneeId: "a",
        estimatedHours: 10,
        startDate: "2026-07-27T00:00:00Z",
        dueDate: "2026-07-28T00:00:00Z",
      }),
      task({
        id: "shared",
        assigneeIds: ["a", "b"],
        estimatedHours: 8,
        dueDate: "2026-07-30T00:00:00Z",
      }),
      task({ id: "unscheduled", assigneeId: "a", estimatedHours: 20 }),
      task({
        id: "done",
        assigneeId: "a",
        estimatedHours: 20,
        status: "done",
        dueDate: "2026-07-30T00:00:00Z",
      }),
    ],
  });

  assert.equal(result.weekStart, "2026-07-27");
  assert.equal(result.weekEnd, "2026-08-02");
  assert.equal(result.unscheduledTaskCount, 1);
  assert.equal(result.rows[0]!.allocatedMinutes, 840);
  assert.equal(result.rows[0]!.effectiveCapacityMinutes, 1680);
  assert.equal(result.rows[0]!.timeOffDays, 2);
  assert.equal(result.rows[0]!.utilizationPercent, 50);
  assert.equal(result.rows[1]!.allocatedMinutes, 240);
  assert.equal(result.rows[1]!.effectiveCapacityMinutes, 1920);
});
