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

test("workload calculation handles zero capacity, overloaded state, overlapping time off, and deleted tasks", () => {
  const capacities: WorkloadCapacity[] = [
    {
      id: "c-zero",
      organizationId: "o",
      workspaceId: "w",
      userId: "a",
      weeklyMinutes: 0,
      workdayMask: 62,
      createdAt: "2026-07-01T00:00:00Z",
      updatedAt: "2026-07-01T00:00:00Z",
    },
    {
      id: "c-normal",
      organizationId: "o",
      workspaceId: "w",
      userId: "b",
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
      id: "vacation-overlap",
      organizationId: "o",
      workspaceId: "w",
      userId: "b",
      kind: "vacation",
      status: "approved",
      startsOn: "2026-07-27",
      endsOn: "2026-07-27",
      createdAt: "2026-07-01T00:00:00Z",
      updatedAt: "2026-07-01T00:00:00Z",
    },
  ];

  const result = calculateWeeklyWorkload({
    users,
    capacities,
    timeOff,
    weekStart: new Date("2026-07-27T00:00:00Z"),
    tasks: [
      task({
        id: "overload-b",
        assigneeId: "b",
        estimatedHours: 50,
        startDate: "2026-07-28T00:00:00Z",
        dueDate: "2026-07-27T00:00:00Z", // Inverted dates
      }),
      task({
        id: "deleted-task",
        assigneeId: "b",
        estimatedHours: 40,
        dueDate: "2026-07-29T00:00:00Z",
        deletedAt: "2026-07-28T00:00:00Z",
      }),
      task({
        id: "cancelled-task",
        assigneeId: "b",
        estimatedHours: 30,
        dueDate: "2026-07-29T00:00:00Z",
        status: "canceled",
      }),
    ],
  });

  // User A has 0 capacity -> level is unavailable
  const rowA = result.rows.find((r) => r.user.id === "a");
  assert.equal(rowA?.configuredCapacityMinutes, 0);
  assert.equal(rowA?.effectiveCapacityMinutes, 0);
  assert.equal(rowA?.level, "unavailable");
  assert.equal(rowA?.utilizationPercent, 0);

  // User B: overlapping public holiday + vacation on 2026-07-27 caps reduction to 1 dailyCapacity (480 mins)
  const rowB = result.rows.find((r) => r.user.id === "b");
  assert.equal(rowB?.configuredCapacityMinutes, 2400);
  assert.equal(rowB?.timeOffMinutes, 480);
  assert.equal(rowB?.effectiveCapacityMinutes, 1920);
  assert.equal(rowB?.allocatedMinutes, 3000);
  assert.equal(rowB?.level, "overloaded");
  assert.ok(rowB?.utilizationPercent && rowB.utilizationPercent > 100);
  assert.ok(Number.isFinite(result.totalAllocatedMinutes));
  assert.ok(Number.isFinite(result.totalEffectiveCapacityMinutes));
});
