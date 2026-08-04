import type { Task } from "@/lib/types";

export type TaskCalendarMode = "day" | "week" | "month";

export function calendarDayStart(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

export function addCalendarDays(value: Date, amount: number) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate() + amount);
}

export function startOfCalendarWeek(value: Date, weekStartsOn: 0 | 6) {
  const start = calendarDayStart(value);
  const offset = (start.getDay() - weekStartsOn + 7) % 7;
  return addCalendarDays(start, -offset);
}

export function calendarDaysForView(anchor: Date, mode: TaskCalendarMode, weekStartsOn: 0 | 6) {
  if (mode === "day") return [calendarDayStart(anchor)];
  if (mode === "week") {
    const start = startOfCalendarWeek(anchor, weekStartsOn);
    return Array.from({ length: 7 }, (_, index) => addCalendarDays(start, index));
  }
  const monthStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const gridStart = startOfCalendarWeek(monthStart, weekStartsOn);
  return Array.from({ length: 42 }, (_, index) => addCalendarDays(gridStart, index));
}

export function shiftCalendarAnchor(anchor: Date, mode: TaskCalendarMode, direction: -1 | 1) {
  if (mode === "day") return addCalendarDays(anchor, direction);
  if (mode === "week") return addCalendarDays(anchor, direction * 7);
  return new Date(anchor.getFullYear(), anchor.getMonth() + direction, 1);
}

export function calendarDayKey(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function calendarDayFromKey(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return calendarDayKey(date) === value ? date : null;
}

export function calendarDayDifference(target: Date, source: Date) {
  const targetSerial = Date.UTC(target.getFullYear(), target.getMonth(), target.getDate());
  const sourceSerial = Date.UTC(source.getFullYear(), source.getMonth(), source.getDate());
  return Math.round((targetSerial - sourceSerial) / 86_400_000);
}

function shiftDate(value: string, dayDelta: number) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  date.setDate(date.getDate() + dayDelta);
  return date.toISOString();
}

function moveDateToDay(value: string, target: Date) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  date.setFullYear(target.getFullYear(), target.getMonth(), target.getDate());
  return date.toISOString();
}

export function shiftTaskCalendarDates(
  task: Pick<Task, "startDate" | "dueDate">,
  targetDay: Date,
  sourceDay: Date,
): Pick<Task, "startDate" | "dueDate"> | null {
  if (!task.startDate && !task.dueDate) return null;
  const dayDelta = calendarDayDifference(targetDay, sourceDay);
  const startDate = task.startDate ? shiftDate(task.startDate, dayDelta) : undefined;
  const dueDate = task.dueDate ? shiftDate(task.dueDate, dayDelta) : undefined;
  if ((task.startDate && !startDate) || (task.dueDate && !dueDate)) return null;
  return { startDate: startDate ?? undefined, dueDate: dueDate ?? undefined };
}

export function resizeTaskCalendarEnd(
  task: Pick<Task, "startDate" | "dueDate">,
  targetDay: Date,
): Pick<Task, "startDate" | "dueDate"> | null {
  const effectiveStartText = task.startDate ?? task.dueDate;
  if (!effectiveStartText) return null;
  const effectiveStart = new Date(effectiveStartText);
  if (Number.isNaN(effectiveStart.getTime())) return null;
  if (calendarDayDifference(targetDay, effectiveStart) < 0) return null;

  const dueDate = moveDateToDay(task.dueDate ?? effectiveStartText, targetDay);
  if (!dueDate) return null;
  return {
    startDate: task.startDate ?? effectiveStart.toISOString(),
    dueDate,
  };
}

export function taskOccursOnCalendarDay(task: Pick<Task, "startDate" | "dueDate">, day: Date) {
  if (!task.startDate && !task.dueDate) return false;
  const start = calendarDayStart(new Date(task.startDate ?? task.dueDate!));
  const end = calendarDayStart(new Date(task.dueDate ?? task.startDate!));
  const target = calendarDayStart(day);
  if ([start, end, target].some((value) => Number.isNaN(value.getTime()))) return false;
  const lower = start <= end ? start : end;
  const upper = start <= end ? end : start;
  return target >= lower && target <= upper;
}
