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

export function visibleCalendarQueryRange(anchor: Date, mode: TaskCalendarMode, weekStartsOn: 0 | 6) {
  const days = calendarDaysForView(anchor, mode, weekStartsOn);
  const firstDay = days[0]!;
  const lastDay = days[days.length - 1]!;
  const rangeStart = new Date(Date.UTC(firstDay.getFullYear(), firstDay.getMonth(), firstDay.getDate(), 0, 0, 0, 0));
  const rangeEnd = new Date(Date.UTC(lastDay.getFullYear(), lastDay.getMonth(), lastDay.getDate(), 23, 59, 59, 999));
  return {
    days,
    rangeStart,
    rangeEnd,
    calendarFrom: rangeStart.toISOString(),
    calendarTo: rangeEnd.toISOString(),
  };
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

export function taskDayKey(value: string | Date | null | undefined, timezone?: string | null): string | null {
  if (!value) return null;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return null;

  try {
    const tz = timezone?.trim() || "UTC";
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    return formatter.format(date);
  } catch {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const day = String(date.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
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

export type CalendarTaskInput = {
  startDate?: string | null;
  dueDate?: string | null;
  timezone?: string | null;
};

export function shiftTaskCalendarDates(
  task: CalendarTaskInput,
  targetDay: Date,
  sourceDay: Date,
): { startDate?: string; dueDate?: string } | null {
  if (!task.startDate && !task.dueDate) return null;
  const dayDelta = calendarDayDifference(targetDay, sourceDay);
  const startDate = task.startDate ? shiftDate(task.startDate, dayDelta) : undefined;
  const dueDate = task.dueDate ? shiftDate(task.dueDate, dayDelta) : undefined;
  if ((task.startDate && !startDate) || (task.dueDate && !dueDate)) return null;
  return { startDate: startDate ?? undefined, dueDate: dueDate ?? undefined };
}

export function resizeTaskCalendarEnd(
  task: CalendarTaskInput,
  targetDay: Date,
): { startDate?: string; dueDate: string } | null {
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

export function taskOccursOnCalendarDay(task: CalendarTaskInput, day: Date, calendarTimezone?: string): boolean {
  if (!task.startDate && !task.dueDate) return false;
  const tz = task.timezone || calendarTimezone || "UTC";
  const startKey = task.startDate ? taskDayKey(task.startDate, tz) : taskDayKey(task.dueDate!, tz);
  const dueKey = task.dueDate ? taskDayKey(task.dueDate, tz) : taskDayKey(task.startDate!, tz);
  if (!startKey || !dueKey) return false;

  const targetKey = calendarDayKey(day);
  const lower = startKey <= dueKey ? startKey : dueKey;
  const upper = startKey <= dueKey ? dueKey : startKey;
  return targetKey >= lower && targetKey <= upper;
}
