import { TenantConflictError } from "../errors.js";
import type {
  TaskPriority,
  TaskRecurrenceFrequency,
  TaskRecurrenceInput,
  TaskRecurrenceStatus,
  TaskStatus,
} from "./tasks.js";

export const VALID_TASK_STATUSES = new Set<TaskStatus>([
  "backlog",
  "todo",
  "in_progress",
  "review",
  "done",
  "canceled",
]);

export const VALID_TASK_PRIORITIES = new Set<TaskPriority>(["low", "medium", "high", "urgent"]);
export const VALID_RECURRENCE_FREQUENCIES = new Set<TaskRecurrenceFrequency>(["daily", "weekly", "monthly", "yearly"]);
export const VALID_RECURRENCE_STATUSES = new Set<TaskRecurrenceStatus>(["active", "paused", "completed"]);

export type TaskStateInput = {
  status?: TaskStatus;
  priority?: TaskPriority;
  progress?: number;
  startDate?: Date | null;
  dueDate?: Date | null;
  timezone?: string;
  isMilestone?: boolean | null;
  isRecurring?: boolean | null;
  recurrence?: TaskRecurrenceInput | null;
};

export type TaskStateCurrent = {
  status: TaskStatus;
  priority: TaskPriority;
  progress: number;
  startDate: Date | null;
  dueDate: Date | null;
  timezone: string;
  isMilestone: boolean | null;
  isRecurring: boolean | null;
};

export type NormalizedRecurrence = {
  frequency: TaskRecurrenceFrequency;
  interval: number;
  timezone: string;
  weekdays: number[];
  monthDay: number | null;
  startsAt: Date;
  endsAt: Date | null;
  maxOccurrences: number | null;
  nextOccurrenceAt: Date;
  status: TaskRecurrenceStatus;
};

export type CanonicalTaskState = {
  status: TaskStatus;
  priority: TaskPriority;
  progress: number;
  startDate: Date | null;
  dueDate: Date | null;
  timezone: string;
  isMilestone: boolean;
  isRecurring: boolean;
  recurrence?: NormalizedRecurrence | null;
};

export type ResolvedTaskStateUpdate = {
  state: CanonicalTaskState;
  statusChanged: boolean;
  priorityChanged: boolean;
  progressChanged: boolean;
  datesChanged: boolean;
  milestoneChanged: boolean;
  recurrenceChanged: boolean;
  hasStateChange: boolean;
};

export function assertValidTaskStatus(status: unknown): asserts status is TaskStatus {
  if (typeof status !== "string" || !VALID_TASK_STATUSES.has(status as TaskStatus)) {
    throw new TenantConflictError("Task status is invalid");
  }
}

export function assertValidTaskPriority(priority: unknown): asserts priority is TaskPriority {
  if (typeof priority !== "string" || !VALID_TASK_PRIORITIES.has(priority as TaskPriority)) {
    throw new TenantConflictError("Task priority is invalid");
  }
}

export function assertValidTaskProgress(progress: unknown): asserts progress is number {
  if (
    typeof progress !== "number" ||
    !Number.isFinite(progress) ||
    !Number.isInteger(progress) ||
    progress < 0 ||
    progress > 100
  ) {
    throw new TenantConflictError("Task progress must be an integer between 0 and 100");
  }
}

export function assertValidTaskDates(startDate: Date | null | undefined, dueDate: Date | null | undefined): void {
  if (startDate !== null && startDate !== undefined) {
    if (!(startDate instanceof Date) || Number.isNaN(startDate.getTime())) {
      throw new TenantConflictError("Task startDate is invalid");
    }
  }
  if (dueDate !== null && dueDate !== undefined) {
    if (!(dueDate instanceof Date) || Number.isNaN(dueDate.getTime())) {
      throw new TenantConflictError("Task dueDate is invalid");
    }
  }
  if (startDate !== null && startDate !== undefined && dueDate !== null && dueDate !== undefined) {
    if (startDate.getTime() > dueDate.getTime()) {
      throw new TenantConflictError("Task startDate cannot be after dueDate");
    }
  }
}

export function assertValidMilestone(
  isMilestone: boolean | undefined,
  startDate: Date | null | undefined,
  dueDate: Date | null | undefined,
): void {
  if (isMilestone === true) {
    if (
      !startDate ||
      !dueDate ||
      !(startDate instanceof Date) ||
      !(dueDate instanceof Date) ||
      Number.isNaN(startDate.getTime()) ||
      Number.isNaN(dueDate.getTime()) ||
      startDate.getTime() !== dueDate.getTime()
    ) {
      throw new TenantConflictError("A milestone requires identical startDate and dueDate");
    }
  }
}

export function normalizeTaskRecurrence(input: TaskRecurrenceInput, fallbackStart: Date): NormalizedRecurrence {
  if (!VALID_RECURRENCE_FREQUENCIES.has(input.frequency)) {
    throw new TenantConflictError("Task recurrence frequency is invalid");
  }
  const interval = input.interval ?? 1;
  const timezone = input.timezone?.trim() || "UTC";
  const weekdays = [...new Set(input.weekdays ?? [])].sort((left, right) => left - right);
  const startsAt = input.startsAt ?? fallbackStart;
  if (!Number.isInteger(interval) || interval < 1) {
    throw new TenantConflictError("Task recurrence interval must be a positive integer");
  }
  if (weekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
    throw new TenantConflictError("Task recurrence weekdays must be between 0 and 6");
  }
  if (
    input.monthDay !== undefined &&
    input.monthDay !== null &&
    (!Number.isInteger(input.monthDay) || input.monthDay < 1 || input.monthDay > 31)
  ) {
    throw new TenantConflictError("Task recurrence month day must be between 1 and 31");
  }
  if (
    input.maxOccurrences !== undefined &&
    input.maxOccurrences !== null &&
    (!Number.isInteger(input.maxOccurrences) || input.maxOccurrences < 1)
  ) {
    throw new TenantConflictError("Task recurrence maximum must be a positive integer");
  }
  if (input.status !== undefined && !VALID_RECURRENCE_STATUSES.has(input.status)) {
    throw new TenantConflictError("Task recurrence status is invalid");
  }
  if (input.endsAt && input.endsAt <= startsAt) {
    throw new TenantConflictError("Task recurrence end must be after its start");
  }
  return {
    frequency: input.frequency,
    interval,
    timezone,
    weekdays,
    monthDay: input.monthDay ?? null,
    startsAt,
    endsAt: input.endsAt ?? null,
    maxOccurrences: input.maxOccurrences ?? null,
    nextOccurrenceAt: startsAt,
    status: input.status ?? "active",
  };
}

export function assertCanonicalTaskState(state: CanonicalTaskState): void {
  assertValidTaskStatus(state.status);
  assertValidTaskPriority(state.priority);
  assertValidTaskProgress(state.progress);
  assertValidTaskDates(state.startDate, state.dueDate);
  assertValidMilestone(state.isMilestone, state.startDate, state.dueDate);
  if (state.status === "done" && state.progress !== 100) {
    throw new TenantConflictError("Completed task must have 100% progress");
  }
  if (state.isRecurring && !state.recurrence) {
    throw new TenantConflictError("Recurring task requires an active recurrence configuration");
  }
}

/**
 * Pure domain resolver for task creation state.
 */
export function resolveTaskStateCreation(input: TaskStateInput): CanonicalTaskState {
  const status: TaskStatus = input.status ?? "todo";
  assertValidTaskStatus(status);

  const priority: TaskPriority = input.priority ?? "medium";
  assertValidTaskPriority(priority);

  const progress: number = status === "done" ? 100 : (input.progress ?? 0);
  assertValidTaskProgress(progress);

  const startDate: Date | null = input.startDate ?? null;
  const dueDate: Date | null = input.dueDate ?? null;
  assertValidTaskDates(startDate, dueDate);

  const timezone: string = input.timezone?.trim() || "UTC";
  const isMilestone: boolean = input.isMilestone ?? false;
  assertValidMilestone(isMilestone, startDate, dueDate);

  let isRecurring = false;
  let recurrence: NormalizedRecurrence | null = null;

  if (input.isRecurring === false && input.recurrence) {
    throw new TenantConflictError("isRecurring cannot be false when recurrence is provided");
  }

  if (input.recurrence) {
    isRecurring = true;
    recurrence = normalizeTaskRecurrence(input.recurrence, dueDate ?? new Date());
  } else if (input.isRecurring === true) {
    isRecurring = true;
    recurrence = normalizeTaskRecurrence({ frequency: "weekly" }, dueDate ?? new Date());
  }

  const canonical: CanonicalTaskState = {
    status,
    priority,
    progress,
    startDate,
    dueDate,
    timezone,
    isMilestone,
    isRecurring,
    recurrence,
  };

  assertCanonicalTaskState(canonical);
  return canonical;
}

/**
 * Pure domain resolver for task update state.
 */
export function resolveTaskStateUpdate(current: TaskStateCurrent, input: TaskStateInput): ResolvedTaskStateUpdate {
  const status: TaskStatus = input.status !== undefined ? input.status : current.status;
  assertValidTaskStatus(status);

  const priority: TaskPriority = input.priority !== undefined ? input.priority : current.priority;
  assertValidTaskPriority(priority);

  const startDate: Date | null = input.startDate !== undefined ? input.startDate : current.startDate;
  const dueDate: Date | null = input.dueDate !== undefined ? input.dueDate : current.dueDate;
  assertValidTaskDates(startDate, dueDate);

  const timezone: string = input.timezone !== undefined ? input.timezone?.trim() || "UTC" : current.timezone;

  const isMilestone: boolean =
    input.isMilestone !== undefined ? Boolean(input.isMilestone) : Boolean(current.isMilestone);
  assertValidMilestone(isMilestone, startDate, dueDate);

  let progress: number;
  if (input.status === "done" && current.status !== "done") {
    progress = 100;
  } else if (input.status === "done" && input.progress === undefined) {
    progress = 100;
  } else if (input.progress !== undefined) {
    progress = input.progress;
  } else {
    progress = current.progress;
  }
  if (status === "done") {
    progress = 100;
  }
  assertValidTaskProgress(progress);

  let isRecurring = Boolean(current.isRecurring);
  let recurrence: NormalizedRecurrence | null | undefined = undefined;

  if (input.isRecurring === false && input.recurrence) {
    throw new TenantConflictError("isRecurring cannot be false when recurrence is provided");
  }

  if (input.recurrence !== undefined) {
    if (input.recurrence === null) {
      isRecurring = false;
      recurrence = null;
    } else {
      isRecurring = true;
      recurrence = normalizeTaskRecurrence(input.recurrence, dueDate ?? current.dueDate ?? new Date());
    }
  } else if (input.isRecurring !== undefined) {
    if (input.isRecurring === false) {
      isRecurring = false;
      recurrence = null;
    } else if (!current.isRecurring) {
      isRecurring = true;
      recurrence = normalizeTaskRecurrence({ frequency: "weekly" }, dueDate ?? current.dueDate ?? new Date());
    }
  }

  const canonical: CanonicalTaskState = {
    status,
    priority,
    progress,
    startDate,
    dueDate,
    timezone,
    isMilestone,
    isRecurring,
    ...(recurrence !== undefined ? { recurrence } : {}),
  };

  assertCanonicalTaskState({
    ...canonical,
    recurrence: recurrence ?? (isRecurring ? ({} as NormalizedRecurrence) : null),
  });

  const statusChanged = status !== current.status;
  const priorityChanged = priority !== current.priority;
  const progressChanged = progress !== current.progress;
  const datesChanged =
    (startDate ? startDate.toISOString() : null) !==
      (current.startDate ? new Date(current.startDate).toISOString() : null) ||
    (dueDate ? dueDate.toISOString() : null) !== (current.dueDate ? new Date(current.dueDate).toISOString() : null);
  const timezoneChanged = timezone !== current.timezone;
  const milestoneChanged = isMilestone !== Boolean(current.isMilestone);
  const recurrenceChanged =
    recurrence !== undefined || (input.isRecurring !== undefined && input.isRecurring !== Boolean(current.isRecurring));

  const hasStateChange =
    statusChanged ||
    priorityChanged ||
    progressChanged ||
    datesChanged ||
    timezoneChanged ||
    milestoneChanged ||
    recurrenceChanged;

  return {
    state: canonical,
    statusChanged,
    priorityChanged,
    progressChanged,
    datesChanged,
    milestoneChanged,
    recurrenceChanged,
    hasStateChange,
  };
}
