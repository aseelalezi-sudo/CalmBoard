import type { Task, User, WorkloadCapacity, WorkloadTimeOff } from "@/lib/types";

const DAY_MS = 86_400_000;
export const DEFAULT_WEEKLY_CAPACITY_MINUTES = 40 * 60;
export const DEFAULT_WORKDAY_MASK = 62;

export type WorkloadRow = {
  user: User;
  taskIds: string[];
  taskCount: number;
  allocatedMinutes: number;
  configuredCapacityMinutes: number;
  effectiveCapacityMinutes: number;
  timeOffMinutes: number;
  timeOffDays: number;
  utilizationPercent: number;
  level: "available" | "full" | "overloaded" | "unavailable";
};

export type WeeklyWorkload = {
  weekStart: string;
  weekEnd: string;
  rows: WorkloadRow[];
  unscheduledTaskCount: number;
  totalAllocatedMinutes: number;
  totalEffectiveCapacityMinutes: number;
};

export function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function startOfIsoWeek(value: Date) {
  const date = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  const day = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() - (day === 0 ? 6 : day - 1));
  return date;
}

export function addUtcDays(value: Date, days: number) {
  return new Date(value.getTime() + days * DAY_MS);
}

function taskRange(task: Task) {
  const start = task.startDate ? task.startDate.slice(0, 10) : task.dueDate?.slice(0, 10);
  const end = task.dueDate ? task.dueDate.slice(0, 10) : task.startDate?.slice(0, 10);
  return start && end ? { start, end } : null;
}

function assignedUserIds(task: Task) {
  return [...new Set([...(task.assigneeIds ?? []), task.assigneeId].filter(Boolean))] as string[];
}

function workdays(mask: number) {
  return Array.from({ length: 7 }, (_, day) => day).filter((day) => (mask & (1 << day)) !== 0);
}

export function calculateWeeklyWorkload(input: {
  tasks: Task[];
  users: User[];
  capacities: WorkloadCapacity[];
  timeOff: WorkloadTimeOff[];
  weekStart: Date;
}): WeeklyWorkload {
  const weekStartDate = startOfIsoWeek(input.weekStart);
  const weekEndDate = addUtcDays(weekStartDate, 6);
  const weekStart = isoDate(weekStartDate);
  const weekEnd = isoDate(weekEndDate);
  const capacityByUser = new Map(input.capacities.map((capacity) => [capacity.userId, capacity]));
  const allocatedByUser = new Map<string, { taskIds: string[]; minutes: number }>();
  let unscheduledTaskCount = 0;

  for (const task of input.tasks) {
    if (task.status === "done" || task.status === "canceled") continue;
    const range = taskRange(task);
    if (!range) {
      unscheduledTaskCount += 1;
      continue;
    }
    if (range.start > weekEnd || range.end < weekStart) continue;
    const assignees = assignedUserIds(task);
    if (!assignees.length) continue;
    const minutesPerAssignee = Math.max(0, (task.estimatedHours ?? 0) * 60) / assignees.length;
    for (const userId of assignees) {
      const current = allocatedByUser.get(userId) ?? { taskIds: [], minutes: 0 };
      current.taskIds.push(task.id);
      current.minutes += minutesPerAssignee;
      allocatedByUser.set(userId, current);
    }
  }

  const rows = input.users.map((user): WorkloadRow => {
    const capacity = capacityByUser.get(user.id);
    const configuredCapacityMinutes = capacity?.weeklyMinutes ?? DEFAULT_WEEKLY_CAPACITY_MINUTES;
    const workdayMask = capacity?.workdayMask ?? DEFAULT_WORKDAY_MASK;
    const selectedWorkdays = workdays(workdayMask);
    const dailyCapacity = selectedWorkdays.length ? configuredCapacityMinutes / selectedWorkdays.length : 0;
    const reductions = new Map<string, number>();
    for (const entry of input.timeOff) {
      if (
        entry.status !== "approved" ||
        (entry.userId !== null && entry.userId !== undefined && entry.userId !== user.id)
      ) {
        continue;
      }
      for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
        const date = addUtcDays(weekStartDate, dayIndex);
        const key = isoDate(date);
        if (key < entry.startsOn || key > entry.endsOn || (workdayMask & (1 << date.getUTCDay())) === 0) continue;
        const reduction = Math.min(dailyCapacity, entry.minutesPerDay ?? dailyCapacity);
        reductions.set(key, Math.min(dailyCapacity, (reductions.get(key) ?? 0) + reduction));
      }
    }
    const timeOffMinutes = [...reductions.values()].reduce((total, minutes) => total + minutes, 0);
    const effectiveCapacityMinutes = Math.max(0, configuredCapacityMinutes - timeOffMinutes);
    const allocation = allocatedByUser.get(user.id) ?? { taskIds: [], minutes: 0 };
    const utilizationPercent =
      effectiveCapacityMinutes > 0
        ? Math.round((allocation.minutes / effectiveCapacityMinutes) * 100)
        : allocation.minutes > 0
          ? 100
          : 0;
    const level =
      effectiveCapacityMinutes === 0
        ? "unavailable"
        : allocation.minutes > effectiveCapacityMinutes
          ? "overloaded"
          : utilizationPercent >= 70
            ? "full"
            : "available";
    return {
      user,
      taskIds: allocation.taskIds,
      taskCount: allocation.taskIds.length,
      allocatedMinutes: allocation.minutes,
      configuredCapacityMinutes,
      effectiveCapacityMinutes,
      timeOffMinutes,
      timeOffDays: reductions.size,
      utilizationPercent,
      level,
    };
  });

  return {
    weekStart,
    weekEnd,
    rows,
    unscheduledTaskCount,
    totalAllocatedMinutes: rows.reduce((total, row) => total + row.allocatedMinutes, 0),
    totalEffectiveCapacityMinutes: rows.reduce((total, row) => total + row.effectiveCapacityMinutes, 0),
  };
}
