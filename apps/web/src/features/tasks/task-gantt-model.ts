import type { Task } from "@/lib/types";
import {
  addCalendarDays,
  calendarDayDifference,
  calendarDayKey,
  calendarDayStart,
  startOfCalendarWeek,
} from "./task-calendar-range";

export type TaskGanttZoom = "days" | "weeks" | "months";

export type TaskGanttBar = {
  task: Task;
  start: Date;
  end: Date;
  startOffset: number;
  durationDays: number;
};

export type TaskGanttLink = {
  blockingTaskId: string;
  dependentTaskId: string;
  type: "finish_to_start" | "start_to_start" | "finish_to_finish" | "start_to_finish";
  lagMinutes: number;
  blockingRow: number;
  dependentRow: number;
};

export type TaskGanttModel = {
  rangeStart: Date | null;
  rangeEnd: Date | null;
  totalDays: number;
  bars: TaskGanttBar[];
  links: TaskGanttLink[];
  dependencyReferences: number;
  unscheduledTaskIds: string[];
  invalidTaskIds: string[];
  missingDependencySerials: string[];
  unrenderedDependencyCount: number;
};

export type TaskGanttSegment = {
  key: string;
  startDate: Date;
  endDate: Date;
  periodStart: Date;
  startOffset: number;
  dayCount: number;
};

function taskDateRange(task: Pick<Task, "startDate" | "dueDate">) {
  if (!task.startDate && !task.dueDate) return { kind: "unscheduled" as const };
  const startValue = new Date(task.startDate ?? task.dueDate!);
  const endValue = new Date(task.dueDate ?? task.startDate!);
  if (Number.isNaN(startValue.getTime()) || Number.isNaN(endValue.getTime())) {
    return { kind: "invalid" as const };
  }
  const start = calendarDayStart(startValue);
  const end = calendarDayStart(endValue);
  if (calendarDayDifference(end, start) < 0) return { kind: "invalid" as const };
  return { kind: "scheduled" as const, start, end };
}

export function buildTaskGanttModel(tasks: Task[]): TaskGanttModel {
  const scheduled: Array<{ task: Task; start: Date; end: Date }> = [];
  const unscheduledTaskIds: string[] = [];
  const invalidTaskIds: string[] = [];

  for (const task of tasks) {
    const range = taskDateRange(task);
    if (range.kind === "unscheduled") {
      unscheduledTaskIds.push(task.id);
    } else if (range.kind === "invalid") {
      invalidTaskIds.push(task.id);
    } else {
      scheduled.push({ task, start: range.start, end: range.end });
    }
  }

  scheduled.sort(
    (left, right) =>
      left.start.getTime() - right.start.getTime() ||
      left.end.getTime() - right.end.getTime() ||
      left.task.order - right.task.order ||
      left.task.serial.localeCompare(right.task.serial),
  );

  const rangeStart = scheduled[0]?.start ?? null;
  const rangeEnd = scheduled.reduce<Date | null>(
    (latest, item) => (!latest || item.end > latest ? item.end : latest),
    null,
  );
  const totalDays = rangeStart && rangeEnd ? calendarDayDifference(rangeEnd, rangeStart) + 1 : 0;
  const bars = scheduled.map<TaskGanttBar>((item) => ({
    ...item,
    startOffset: rangeStart ? calendarDayDifference(item.start, rangeStart) : 0,
    durationDays: calendarDayDifference(item.end, item.start) + 1,
  }));

  const taskBySerial = new Map(tasks.map((task) => [task.serial, task]));
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const rowByTaskId = new Map(bars.map((bar, index) => [bar.task.id, index]));
  const links: TaskGanttLink[] = [];
  const missingDependencySerials = new Set<string>();
  let dependencyReferences = 0;
  let unrenderedDependencyCount = 0;

  for (const [dependentRow, bar] of bars.entries()) {
    const dependencies =
      bar.task.dependencyLinks !== undefined
        ? bar.task.dependencyLinks
        : [...new Set(bar.task.dependencies ?? [])].map((blockingTaskSerial) => ({
            blockingTaskId: taskBySerial.get(blockingTaskSerial)?.id ?? "",
            blockingTaskSerial,
            type: "finish_to_start" as const,
            lagMinutes: 0,
          }));
    const uniqueDependencies = new Map(
      dependencies.map((link) => [
        `${link.blockingTaskId}:${link.blockingTaskSerial}:${link.type}:${link.lagMinutes}`,
        link,
      ]),
    );
    for (const dependency of uniqueDependencies.values()) {
      dependencyReferences += 1;
      const blockingTask = taskById.get(dependency.blockingTaskId) ?? taskBySerial.get(dependency.blockingTaskSerial);
      if (!blockingTask) {
        missingDependencySerials.add(dependency.blockingTaskSerial);
        continue;
      }
      const blockingRow = rowByTaskId.get(blockingTask.id);
      if (blockingRow === undefined) {
        unrenderedDependencyCount += 1;
        continue;
      }
      links.push({
        blockingTaskId: blockingTask.id,
        dependentTaskId: bar.task.id,
        type: dependency.type,
        lagMinutes: dependency.lagMinutes,
        blockingRow,
        dependentRow,
      });
    }
  }

  return {
    rangeStart,
    rangeEnd,
    totalDays,
    bars,
    links,
    dependencyReferences,
    unscheduledTaskIds,
    invalidTaskIds,
    missingDependencySerials: [...missingDependencySerials].sort(),
    unrenderedDependencyCount,
  };
}

export function buildTaskGanttSegments(rangeStart: Date, totalDays: number, zoom: TaskGanttZoom, weekStartsOn: 0 | 6) {
  const segments: TaskGanttSegment[] = [];
  for (let offset = 0; offset < totalDays; offset += 1) {
    const day = addCalendarDays(rangeStart, offset);
    const periodStart =
      zoom === "days"
        ? day
        : zoom === "weeks"
          ? startOfCalendarWeek(day, weekStartsOn)
          : new Date(day.getFullYear(), day.getMonth(), 1);
    const key =
      zoom === "days"
        ? calendarDayKey(day)
        : zoom === "weeks"
          ? `week:${calendarDayKey(periodStart)}`
          : `month:${day.getFullYear()}-${day.getMonth() + 1}`;
    const previous = segments.at(-1);
    if (previous?.key === key) {
      previous.endDate = day;
      previous.dayCount += 1;
    } else {
      segments.push({
        key,
        startDate: day,
        endDate: day,
        periodStart,
        startOffset: offset,
        dayCount: 1,
      });
    }
  }
  return segments;
}
