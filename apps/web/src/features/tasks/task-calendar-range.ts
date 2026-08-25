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

export function zonedTimeToUtc(
  year: number,
  month: number, // 1-12
  day: number,
  hours: number,
  minutes: number,
  seconds: number,
  ms: number,
  timezone: string = "UTC",
): Date {
  const tz = timezone?.trim() || "UTC";
  let guess = Date.UTC(year, month - 1, day, hours, minutes, seconds, ms);
  try {
    for (let i = 0; i < 4; i++) {
      const d = new Date(guess);
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "numeric",
        second: "numeric",
        fractionalSecondDigits: 3,
        hour12: false,
      }).formatToParts(d);

      let py = year;
      let pm = month;
      let pd = day;
      let ph = hours;
      let pmin = minutes;
      let ps = seconds;
      let pms = ms;

      for (const p of parts) {
        if (p.type === "year") py = Number(p.value);
        else if (p.type === "month") pm = Number(p.value);
        else if (p.type === "day") pd = Number(p.value);
        else if (p.type === "hour") ph = Number(p.value) === 24 ? 0 : Number(p.value);
        else if (p.type === "minute") pmin = Number(p.value);
        else if (p.type === "second") ps = Number(p.value);
        else if (p.type === "fractionalSecond") pms = Number(p.value);
      }

      const zonedAsUtc = Date.UTC(py, pm - 1, pd, ph, pmin, ps, pms);
      const targetAsUtc = Date.UTC(year, month - 1, day, hours, minutes, seconds, ms);
      const diff = zonedAsUtc - targetAsUtc;
      if (diff === 0) break;
      guess -= diff;
    }
  } catch {
    return new Date(Date.UTC(year, month - 1, day, hours, minutes, seconds, ms));
  }
  return new Date(guess);
}

export function visibleCalendarQueryRange(
  anchor: Date,
  mode: TaskCalendarMode,
  weekStartsOn: 0 | 6,
  calendarTimezone: string = "UTC",
) {
  const days = calendarDaysForView(anchor, mode, weekStartsOn);
  const firstDay = days[0]!;
  const lastDay = days[days.length - 1]!;
  const tz = calendarTimezone?.trim() || "UTC";

  const rangeStart = zonedTimeToUtc(
    firstDay.getFullYear(),
    firstDay.getMonth() + 1,
    firstDay.getDate(),
    0,
    0,
    0,
    0,
    tz,
  );
  const rangeEnd = zonedTimeToUtc(
    lastDay.getFullYear(),
    lastDay.getMonth() + 1,
    lastDay.getDate(),
    23,
    59,
    59,
    999,
    tz,
  );

  return {
    days,
    rangeStart,
    rangeEnd,
    calendarFrom: rangeStart.toISOString(),
    calendarTo: rangeEnd.toISOString(),
    calendarTimezone: tz,
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

export type CalendarCommonFilters = {
  search?: string;
  status?: string;
  priority?: string;
  assigneeId?: string;
};

export function matchesTaskFilters(
  task: CalendarTaskInput & {
    title?: string;
    description?: string | null;
    serial?: string | null;
    status?: string;
    priority?: string;
    assigneeId?: string | null;
    assigneeIds?: string[];
    assignees?: Array<{ id: string }>;
  },
  filters: CalendarCommonFilters = {},
): boolean {
  if (filters.status && task.status && task.status !== filters.status) return false;
  if (filters.priority && task.priority && task.priority !== filters.priority) return false;
  if (filters.assigneeId) {
    const directMatch = task.assigneeId === filters.assigneeId;
    const arrayMatch = Array.isArray(task.assigneeIds) && task.assigneeIds.includes(filters.assigneeId);
    const objectsMatch = Array.isArray(task.assignees) && task.assignees.some((a) => a.id === filters.assigneeId);
    if (!directMatch && !arrayMatch && !objectsMatch) return false;
  }
  if (filters.search) {
    const q = filters.search.toLowerCase().trim();
    if (q) {
      const titleMatch = task.title ? task.title.toLowerCase().includes(q) : false;
      const descMatch = task.description ? task.description.toLowerCase().includes(q) : false;
      const serialMatch = task.serial ? task.serial.toLowerCase().includes(q) : false;
      if (!titleMatch && !descMatch && !serialMatch) return false;
    }
  }
  return true;
}

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
  const tz = calendarTimezone || task.timezone || "UTC";
  const startKey = task.startDate ? taskDayKey(task.startDate, tz) : taskDayKey(task.dueDate!, tz);
  const dueKey = task.dueDate ? taskDayKey(task.dueDate, tz) : taskDayKey(task.startDate!, tz);
  if (!startKey || !dueKey) return false;

  const targetKey = calendarDayKey(day);
  const lower = startKey <= dueKey ? startKey : dueKey;
  const upper = startKey <= dueKey ? dueKey : startKey;
  return targetKey >= lower && targetKey <= upper;
}

export function taskOccursWithinVisibleRange(
  task: CalendarTaskInput,
  days: Date[],
  calendarTimezone?: string,
): boolean {
  return days.some((day) => taskOccursOnCalendarDay(task, day, calendarTimezone));
}
