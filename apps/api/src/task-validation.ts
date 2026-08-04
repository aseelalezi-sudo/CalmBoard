import { BadRequestException } from "@nestjs/common";
import { z } from "@calmboard/validation";
import type {
  CreateTaskInput,
  TaskMetadata,
  TaskPriority,
  TaskRecurrenceFrequency,
  TaskRecurrenceInput,
  TaskRecurrenceStatus,
  TaskReminder,
  TaskStatus,
  UpdateTaskInput,
  MoveTaskInput,
} from "@calmboard/database";
import { isJsonObject, requiredString, type JsonObject } from "./request-validation.js";

const taskStatuses = new Set<TaskStatus>(["backlog", "todo", "in_progress", "review", "done", "canceled"]);
const taskPriorities = new Set<TaskPriority>(["low", "medium", "high", "urgent"]);
const taskRecurrenceFrequencies = new Set<TaskRecurrenceFrequency>(["daily", "weekly", "monthly", "yearly"]);
const taskRecurrenceStatuses = new Set<TaskRecurrenceStatus>(["active", "paused", "completed"]);

export function parseTaskStatus(value: unknown, field = "status"): TaskStatus {
  if (typeof value !== "string" || !taskStatuses.has(value as TaskStatus)) {
    throw new BadRequestException(`${field} is invalid`);
  }
  return value as TaskStatus;
}

export function parseTaskPriority(value: unknown, field = "priority"): TaskPriority {
  if (typeof value !== "string" || !taskPriorities.has(value as TaskPriority)) {
    throw new BadRequestException(`${field} is invalid`);
  }
  return value as TaskPriority;
}

export function parseMoveTaskInput(body: JsonObject): MoveTaskInput {
  const allowed = new Set([
    "organizationId",
    "workspaceId",
    "actorId",
    "status",
    "targetIndex",
    "beforeTaskId",
    "afterTaskId",
    "expectedVersion",
  ]);
  rejectUnknownFields(body, allowed);
  if (!Number.isInteger(body.targetIndex) || Number(body.targetIndex) < 0) {
    throw new BadRequestException("targetIndex must be a non-negative integer");
  }
  if (!Number.isInteger(body.expectedVersion) || Number(body.expectedVersion) < 1) {
    throw new BadRequestException("expectedVersion must be a positive integer");
  }
  return {
    status: parseTaskStatus(body.status),
    targetIndex: Number(body.targetIndex),
    ...(body.beforeTaskId !== undefined ? { beforeTaskId: readNullableString(body.beforeTaskId, "beforeTaskId") } : {}),
    ...(body.afterTaskId !== undefined ? { afterTaskId: readNullableString(body.afterTaskId, "afterTaskId") } : {}),
    expectedVersion: Number(body.expectedVersion),
  };
}

function readNullableString(value: unknown, field: string) {
  if (value === null || value === "") return null;
  return requiredString(value, field);
}

function readNumber(value: unknown, field: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new BadRequestException(`${field} must be a finite number`);
  }
  return value;
}

function readDate(value: unknown, field: string) {
  if (value === null || value === "") return null;
  if (typeof value !== "string" && !(value instanceof Date)) {
    throw new BadRequestException(`${field} must be a date`);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new BadRequestException(`${field} must be a valid date`);
  return date;
}

function readStringArray(value: unknown, field: string) {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new BadRequestException(`${field} must be an array of strings`);
  }
  const normalized = value.map((item) => item.trim());
  if (normalized.some((item) => !item)) throw new BadRequestException(`${field} cannot contain empty values`);
  if (new Set(normalized).size !== normalized.length) {
    throw new BadRequestException(`${field} must contain unique values`);
  }
  return normalized;
}

function readTimezone(value: unknown, field: string) {
  const timezone = requiredString(value, field);
  if (timezone.length > 100) throw new BadRequestException(`${field} is too long`);
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone }).format();
  } catch {
    throw new BadRequestException(`${field} must be a valid IANA timezone`);
  }
  return timezone;
}

function rejectUnknownFields(body: JsonObject, allowed: ReadonlySet<string>) {
  const unknown = Object.keys(body).find((key) => !allowed.has(key));
  if (unknown) throw new BadRequestException(`${unknown} is not supported`);
}

const taskContextFields = ["organizationId", "workspaceId", "actorId", "id"];
const createTaskFields = new Set([
  ...taskContextFields,
  "projectId",
  "title",
  "sectionId",
  "parentId",
  "description",
  "status",
  "priority",
  "assigneeId",
  "assigneeIds",
  "followerIds",
  "reporterId",
  "startDate",
  "dueDate",
  "timezone",
  "estimatedHours",
  "loggedHours",
  "progress",
  "order",
  "tags",
  "customFields",
  "storyPoints",
  "delayReason",
  "reminders",
  "recurrence",
  "isRecurring",
  "isMilestone",
]);
const updateTaskFields = new Set([...createTaskFields, "dependencies", "expectedVersion"]);

const taskContextShape = {
  organizationId: z.string().optional(),
  workspaceId: z.string().optional(),
  actorId: z.string().optional(),
  id: z.string().optional(),
};
const nullableDateValue = z.union([z.string(), z.date(), z.null()]);
const createTaskSchema = z
  .object({
    ...taskContextShape,
    projectId: z.string(),
    title: z.string(),
    sectionId: z.string().nullable().optional(),
    parentId: z.string().nullable().optional(),
    description: z.string().optional(),
    status: z.string().optional(),
    priority: z.string().optional(),
    assigneeId: z.string().nullable().optional(),
    assigneeIds: z.array(z.string()).optional(),
    followerIds: z.array(z.string()).optional(),
    reporterId: z.string().nullable().optional(),
    startDate: nullableDateValue.optional(),
    dueDate: nullableDateValue.optional(),
    timezone: z.string().optional(),
    estimatedHours: z.number().nullable().optional(),
    loggedHours: z.number().optional(),
    progress: z.number().optional(),
    order: z.number().optional(),
    tags: z.array(z.string()).optional(),
    customFields: z.record(z.string(), z.unknown()).optional(),
    storyPoints: z.number().nullable().optional(),
    delayReason: z.string().nullable().optional(),
    reminders: z.array(z.unknown()).optional(),
    recurrence: z.unknown().optional(),
    isRecurring: z.boolean().optional(),
    isMilestone: z.boolean().optional(),
  })
  .strict();
const updateTaskSchema = createTaskSchema.partial().extend({
  dependencies: z.array(z.string()).optional(),
  expectedVersion: z.number().int().positive().optional(),
});
const taskImportSchema = z
  .object({
    organizationId: z.string().trim().min(1),
    workspaceId: z.string().trim().min(1),
    actorId: z.string().trim().min(1).optional(),
    tasks: z
      .array(
        createTaskSchema.omit({
          organizationId: true,
          workspaceId: true,
          actorId: true,
          id: true,
        }),
      )
      .min(1)
      .max(100),
  })
  .strict();

function validateTaskSchema(schema: typeof createTaskSchema | typeof updateTaskSchema, body: JsonObject) {
  const result = schema.safeParse(body);
  if (!result.success) {
    const issue = result.error.issues[0];
    const field = issue?.path.length ? `${issue.path.join(".")} ` : "";
    throw new BadRequestException(`${field}${issue?.message ?? "is invalid"}`.trim());
  }
}

function readReminders(value: unknown): TaskReminder[] {
  if (!Array.isArray(value)) throw new BadRequestException("reminders must be an array");
  const ids = new Set<string>();
  return value.map((reminder, index) => {
    if (!isJsonObject(reminder)) throw new BadRequestException(`reminders.${index} must be an object`);
    const id = requiredString(reminder.id, `reminders.${index}.id`);
    const time = requiredString(reminder.time, `reminders.${index}.time`);
    const label = requiredString(reminder.label, `reminders.${index}.label`);
    if (id.length > 128) throw new BadRequestException(`reminders.${index}.id is too long`);
    if (label.length > 255) throw new BadRequestException(`reminders.${index}.label is too long`);
    if (Number.isNaN(new Date(time).getTime())) {
      throw new BadRequestException(`reminders.${index}.time must be a valid date`);
    }
    if (ids.has(id)) throw new BadRequestException("reminder ids must be unique");
    ids.add(id);
    return {
      id,
      time: new Date(time).toISOString(),
      label,
      ...(typeof reminder.sent === "boolean" ? { sent: reminder.sent } : {}),
    };
  });
}

function readOptionalInteger(value: unknown, field: string, minimum: number, maximum?: number) {
  if (
    !Number.isInteger(value) ||
    (value as number) < minimum ||
    (maximum !== undefined && (value as number) > maximum)
  ) {
    throw new BadRequestException(`${field} is invalid`);
  }
  return value as number;
}

function readRecurrence(value: unknown): TaskRecurrenceInput {
  if (!isJsonObject(value)) throw new BadRequestException("recurrence must be an object or null");
  if (
    typeof value.frequency !== "string" ||
    !taskRecurrenceFrequencies.has(value.frequency as TaskRecurrenceFrequency)
  ) {
    throw new BadRequestException("recurrence.frequency is invalid");
  }
  const recurrence: TaskRecurrenceInput = { frequency: value.frequency as TaskRecurrenceFrequency };
  if (value.interval !== undefined) recurrence.interval = readOptionalInteger(value.interval, "recurrence.interval", 1);
  if (value.timezone !== undefined) {
    recurrence.timezone = requiredString(value.timezone, "recurrence.timezone");
    if (recurrence.timezone.length > 100) throw new BadRequestException("recurrence.timezone is too long");
  }
  if (value.weekdays !== undefined) {
    if (!Array.isArray(value.weekdays)) throw new BadRequestException("recurrence.weekdays must be an array");
    recurrence.weekdays = value.weekdays.map((day) => readOptionalInteger(day, "recurrence.weekdays", 0, 6));
    if (new Set(recurrence.weekdays).size !== recurrence.weekdays.length) {
      throw new BadRequestException("recurrence.weekdays must be unique");
    }
  }
  if (value.monthDay !== undefined) {
    recurrence.monthDay =
      value.monthDay === null ? null : readOptionalInteger(value.monthDay, "recurrence.monthDay", 1, 31);
  }
  if (value.startsAt !== undefined) {
    const startsAt = readDate(value.startsAt, "recurrence.startsAt");
    if (!startsAt) throw new BadRequestException("recurrence.startsAt must be a date");
    recurrence.startsAt = startsAt;
  }
  if (value.endsAt !== undefined) recurrence.endsAt = readDate(value.endsAt, "recurrence.endsAt");
  if (value.maxOccurrences !== undefined) {
    recurrence.maxOccurrences =
      value.maxOccurrences === null ? null : readOptionalInteger(value.maxOccurrences, "recurrence.maxOccurrences", 1);
  }
  if (value.status !== undefined) {
    if (typeof value.status !== "string" || !taskRecurrenceStatuses.has(value.status as TaskRecurrenceStatus)) {
      throw new BadRequestException("recurrence.status is invalid");
    }
    recurrence.status = value.status as TaskRecurrenceStatus;
  }
  if (recurrence.startsAt && recurrence.endsAt && recurrence.endsAt <= recurrence.startsAt) {
    throw new BadRequestException("recurrence.endsAt must be after recurrence.startsAt");
  }
  return recurrence;
}

export function parseCreateTaskInput(body: JsonObject): CreateTaskInput {
  rejectUnknownFields(body, createTaskFields);
  validateTaskSchema(createTaskSchema, body);
  const input: CreateTaskInput = {
    projectId: requiredString(body.projectId, "projectId"),
    title: requiredString(body.title, "title"),
  };
  if (body.sectionId !== undefined) input.sectionId = readNullableString(body.sectionId, "sectionId");
  if (body.parentId !== undefined) input.parentId = readNullableString(body.parentId, "parentId");
  if (body.description !== undefined) {
    if (typeof body.description !== "string") throw new BadRequestException("description must be a string");
    input.description = body.description;
  }
  if (body.status !== undefined) input.status = parseTaskStatus(body.status);
  if (body.priority !== undefined) input.priority = parseTaskPriority(body.priority);
  if (body.assigneeId !== undefined) input.assigneeId = readNullableString(body.assigneeId, "assigneeId");
  if (body.assigneeIds !== undefined) input.assigneeIds = readStringArray(body.assigneeIds, "assigneeIds");
  if (body.followerIds !== undefined) input.followerIds = readStringArray(body.followerIds, "followerIds");
  if (body.reporterId !== undefined) input.reporterId = readNullableString(body.reporterId, "reporterId");
  if (body.startDate !== undefined) input.startDate = readDate(body.startDate, "startDate");
  if (body.timezone !== undefined) input.timezone = readTimezone(body.timezone, "timezone");
  if (body.order !== undefined) input.order = readNumber(body.order, "order");
  if (body.tags !== undefined) input.tags = readStringArray(body.tags, "tags");
  if (body.estimatedHours !== undefined) {
    input.estimatedHours = body.estimatedHours === null ? null : readNumber(body.estimatedHours, "estimatedHours");
  }
  if (body.loggedHours !== undefined) input.loggedHours = readNumber(body.loggedHours, "loggedHours");
  if (body.dueDate !== undefined) input.dueDate = readDate(body.dueDate, "dueDate");
  if (body.progress !== undefined) input.progress = readNumber(body.progress, "progress");
  if (body.customFields !== undefined) {
    if (!isJsonObject(body.customFields)) throw new BadRequestException("customFields must be an object");
    input.customFields = body.customFields;
  }
  if (body.storyPoints !== undefined) {
    input.storyPoints = body.storyPoints === null ? null : readNumber(body.storyPoints, "storyPoints");
  }
  if (body.delayReason !== undefined) input.delayReason = readNullableString(body.delayReason, "delayReason");
  if (body.reminders !== undefined) input.reminders = readReminders(body.reminders);
  if (body.recurrence !== undefined) {
    if (body.recurrence === null) throw new BadRequestException("recurrence cannot be null when creating a task");
    input.recurrence = readRecurrence(body.recurrence);
  }
  if (body.isRecurring !== undefined) {
    if (typeof body.isRecurring !== "boolean") throw new BadRequestException("isRecurring must be a boolean");
    if (body.isRecurring === false && input.recurrence) {
      throw new BadRequestException("isRecurring cannot be false when recurrence is provided");
    }
    input.isRecurring = body.isRecurring;
  }
  if (body.isMilestone !== undefined) {
    if (typeof body.isMilestone !== "boolean") throw new BadRequestException("isMilestone must be a boolean");
    input.isMilestone = body.isMilestone;
  }
  if (
    input.isMilestone &&
    (!input.startDate || !input.dueDate || input.startDate.getTime() !== input.dueDate.getTime())
  ) {
    throw new BadRequestException("A milestone requires identical startDate and dueDate");
  }
  return input;
}

export function parseTaskImportInput(body: JsonObject): CreateTaskInput[] {
  const result = taskImportSchema.safeParse(body);
  if (!result.success) {
    const issue = result.error.issues[0];
    const field = issue?.path.length ? `${issue.path.join(".")} ` : "";
    throw new BadRequestException(`${field}${issue?.message ?? "is invalid"}`.trim());
  }
  return result.data.tasks.map((task) => parseCreateTaskInput(task));
}

export function parseUpdateTaskInput(body: JsonObject): UpdateTaskInput {
  rejectUnknownFields(body, updateTaskFields);
  validateTaskSchema(updateTaskSchema, body);
  const input: UpdateTaskInput = {};
  const metadata: Partial<TaskMetadata> = {};
  if (body.title !== undefined) input.title = requiredString(body.title, "title");
  if (body.description !== undefined) {
    if (body.description !== null && typeof body.description !== "string") {
      throw new BadRequestException("description must be a string or null");
    }
    input.description = body.description;
  }
  if (body.sectionId !== undefined) input.sectionId = readNullableString(body.sectionId, "sectionId");
  if (body.parentId !== undefined) input.parentId = readNullableString(body.parentId, "parentId");
  if (body.status !== undefined) input.status = parseTaskStatus(body.status);
  if (body.priority !== undefined) input.priority = parseTaskPriority(body.priority);
  if (body.assigneeId !== undefined) input.assigneeId = readNullableString(body.assigneeId, "assigneeId");
  if (body.assigneeIds !== undefined) input.assigneeIds = readStringArray(body.assigneeIds, "assigneeIds");
  if (body.followerIds !== undefined) input.followerIds = readStringArray(body.followerIds, "followerIds");
  if (body.reporterId !== undefined) input.reporterId = readNullableString(body.reporterId, "reporterId");
  if (body.dueDate !== undefined) input.dueDate = readDate(body.dueDate, "dueDate");
  if (body.startDate !== undefined) input.startDate = readDate(body.startDate, "startDate");
  if (body.timezone !== undefined) input.timezone = readTimezone(body.timezone, "timezone");
  if (body.estimatedHours !== undefined) {
    input.estimatedHours = body.estimatedHours === null ? null : readNumber(body.estimatedHours, "estimatedHours");
  }
  if (body.loggedHours !== undefined) {
    input.loggedHours = readNumber(body.loggedHours, "loggedHours");
  }
  if (body.progress !== undefined) input.progress = readNumber(body.progress, "progress");
  if (body.order !== undefined) input.order = readNumber(body.order, "order");
  if (body.tags !== undefined) input.tags = readStringArray(body.tags, "tags");
  if (body.customFields !== undefined) {
    if (!isJsonObject(body.customFields)) throw new BadRequestException("customFields must be an object");
    input.customFields = body.customFields;
  }
  if (body.isRecurring !== undefined) {
    if (typeof body.isRecurring !== "boolean") throw new BadRequestException("isRecurring must be a boolean");
    input.isRecurring = body.isRecurring;
  }
  if (body.isMilestone !== undefined) {
    if (typeof body.isMilestone !== "boolean") throw new BadRequestException("isMilestone must be a boolean");
    input.isMilestone = body.isMilestone;
    if (
      input.isMilestone &&
      (!input.startDate || !input.dueDate || input.startDate.getTime() !== input.dueDate.getTime())
    ) {
      throw new BadRequestException("A milestone requires identical startDate and dueDate");
    }
  }
  if (body.recurrence !== undefined) {
    input.recurrence = body.recurrence === null ? null : readRecurrence(body.recurrence);
    if (input.recurrence && input.isRecurring === false) {
      throw new BadRequestException("isRecurring cannot be false when recurrence is provided");
    }
  }
  if (body.storyPoints !== undefined) {
    input.storyPoints = body.storyPoints === null ? null : readNumber(body.storyPoints, "storyPoints");
  }
  if (body.delayReason !== undefined) {
    input.delayReason = readNullableString(body.delayReason, "delayReason");
  }
  if (body.dependencies !== undefined) metadata.dependencies = readStringArray(body.dependencies, "dependencies");
  if (body.reminders !== undefined) metadata.reminders = readReminders(body.reminders);
  if (Object.keys(metadata).length) input.metadata = metadata;
  if (!Object.keys(input).length) throw new BadRequestException("at least one task field is required");
  if (body.expectedVersion === undefined) throw new BadRequestException("expectedVersion is required");
  input.expectedVersion = readOptionalInteger(body.expectedVersion, "expectedVersion", 1);
  return input;
}
