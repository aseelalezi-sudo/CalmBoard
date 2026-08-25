import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { db } from "../client.js";
import { TenantConflictError, TenantResourceNotFoundError } from "../errors.js";
import {
  projects,
  projectSections,
  projectWipLimits,
  automationEvents,
  customFields,
  memberships,
  taskAssignees,
  taskDependencies,
  taskFollowers,
  taskRecurrenceRules,
  taskReminders,
  tasks,
  users,
  sprints,
  taskSprintAssignments,
} from "../schema.js";
import { allocateTaskSerialNumbers, FIRST_TASK_SERIAL_NUMBER, formatTaskSerial } from "../task-serials.js";
import { assertWorkspaceTenantContext, type DatabaseTenantContext } from "../tenant-context.js";
import { createNotificationsRepository } from "./notifications.js";
import { createTaskFollowersRepository } from "./task-followers.js";
import { createTaskDependenciesRepository, type TaskDependencyLink } from "./task-dependencies.js";
import { resolveTaskAssignmentCreation, resolveTaskAssignmentUpdate } from "./task-assignments.js";
import {
  assertValidTaskStatus,
  assertValidTaskPriority,
  assertValidTaskProgress,
  assertValidTaskDates,
  assertValidMilestone,
  normalizeTaskRecurrence,
  resolveTaskStateCreation,
  resolveTaskStateUpdate,
} from "./task-states.js";
import {
  normalizeCustomFieldType,
  validateAndNormalizeTaskCustomFields,
  type ValidateTaskCustomFieldsOptions,
} from "../custom-field-contract.js";
import {
  buildCustomFieldSqlCondition,
  buildCustomFieldSqlSortColumn,
  validateAndNormalizeCustomFieldFilter,
  type CustomFieldFilter,
  type CustomFieldSort,
} from "../custom-field-query.js";
import type { CustomFieldRecord } from "./custom-fields.js";

export type TaskRecord = typeof tasks.$inferSelect;
export type TaskStatus = TaskRecord["status"];
export type TaskPriority = TaskRecord["priority"];
export type TaskReminder = {
  id: string;
  time: string;
  label: string;
  sent?: boolean;
};
export type TaskRecurrenceFrequency = (typeof taskRecurrenceRules.$inferSelect)["frequency"];
export type TaskRecurrenceStatus = (typeof taskRecurrenceRules.$inferSelect)["status"];
export type TaskRecurrenceInput = {
  frequency: TaskRecurrenceFrequency;
  interval?: number;
  timezone?: string;
  weekdays?: number[];
  monthDay?: number | null;
  startsAt?: Date;
  endsAt?: Date | null;
  maxOccurrences?: number | null;
  status?: TaskRecurrenceStatus;
};
export type TaskRecurrence = {
  frequency: TaskRecurrenceFrequency;
  interval: number;
  timezone: string;
  weekdays: number[];
  monthDay: number | null;
  startsAt: string;
  endsAt: string | null;
  maxOccurrences: number | null;
  occurrencesCreated: number;
  nextOccurrenceAt: string;
  lastOccurrenceAt: string | null;
  status: TaskRecurrenceStatus;
};
export type TaskMetadata = {
  dependencies?: string[];
  reminders?: TaskReminder[];
};
export type { TaskDependencyLink } from "./task-dependencies.js";

export type TaskListFilters = {
  projectId?: string;
  parentId?: string;
  search?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  assigneeId?: string;
  sectionId?: string;
  tag?: string;
  dueFrom?: Date;
  dueTo?: Date;
  calendarFrom?: Date;
  calendarTo?: Date;
  sortBy?:
    | "order"
    | "createdAt"
    | "updatedAt"
    | "dueDate"
    | "priority"
    | "title"
    | "status"
    | "assigneeId"
    | "storyPoints"
    | "estimatedHours"
    | "loggedHours";
  sortDirection?: "asc" | "desc";
  customSort?: CustomFieldSort;
  customFieldFilters?: CustomFieldFilter[];
  includeSubtasks?: boolean;
};

export type TaskPageFilters = TaskListFilters & {
  cursor?: string;
  limit: number;
};

type TaskSortField = NonNullable<TaskListFilters["sortBy"]>;
type TaskSortDirection = NonNullable<TaskListFilters["sortDirection"]>;
type TaskCursor = {
  version: 1;
  sortBy: TaskSortField | "customField";
  sortDirection: TaskSortDirection;
  value: string | number | boolean | null;
  id: string;
  customFieldKey?: string;
  customFieldType?: string;
};

type ResolvedPageSort =
  | {
      isCustom: false;
      sortBy: TaskSortField;
      sortDirection: TaskSortDirection;
    }
  | {
      isCustom: true;
      sortBy: "customField";
      customFieldKey: string;
      customFieldType: string;
      sortDirection: TaskSortDirection;
    };

function pageSort(filters: TaskListFilters, defsByKey?: Map<string, CustomFieldRecord>): ResolvedPageSort {
  if (filters.customSort) {
    const def = defsByKey?.get(filters.customSort.fieldKey);
    return {
      isCustom: true,
      sortBy: "customField",
      customFieldKey: filters.customSort.fieldKey,
      customFieldType: def ? normalizeCustomFieldType(def.type) : "short_text",
      sortDirection: filters.customSort.direction,
    };
  }
  return {
    isCustom: false,
    sortBy: filters.sortBy ?? ("createdAt" as const),
    sortDirection: filters.sortDirection ?? ("desc" as const),
  };
}

function taskSortValue(task: TaskRecord, sort: ResolvedPageSort): string | number | boolean | null {
  if (sort.isCustom) {
    const raw = (task.customFields as Record<string, unknown> | null | undefined)?.[sort.customFieldKey];
    if (raw === undefined || raw === null || raw === "") return null;
    if (typeof raw === "number" || typeof raw === "boolean" || typeof raw === "string") return raw;
    if (raw instanceof Date) return raw.toISOString();
    return String(raw);
  }
  switch (sort.sortBy) {
    case "order":
      return task.order;
    case "createdAt":
      return task.createdAt.toISOString();
    case "updatedAt":
      return task.updatedAt.toISOString();
    case "dueDate":
      return task.dueDate?.toISOString() ?? null;
    case "priority":
      return task.priority;
    case "title":
      return task.title;
    case "status":
      return task.status;
    case "assigneeId":
      return task.assigneeId;
    case "storyPoints":
      return task.storyPoints;
    case "estimatedHours":
      return task.estimatedHours;
    case "loggedHours":
      return task.loggedHours;
  }
}

function encodeTaskCursor(task: TaskRecord, filters: TaskListFilters, defsByKey?: Map<string, CustomFieldRecord>) {
  const sort = pageSort(filters, defsByKey);
  const cursorObj: TaskCursor = {
    version: 1,
    sortBy: sort.sortBy,
    sortDirection: sort.sortDirection,
    value: taskSortValue(task, sort),
    id: task.id,
    ...(sort.isCustom
      ? {
          customFieldKey: sort.customFieldKey,
          customFieldType: sort.customFieldType,
        }
      : {}),
  };
  return Buffer.from(JSON.stringify(cursorObj)).toString("base64url");
}

function decodeTaskCursor(
  cursor: string,
  filters: TaskListFilters,
  defsByKey?: Map<string, CustomFieldRecord>,
): TaskCursor {
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Partial<TaskCursor>;
    const expected = pageSort(filters, defsByKey);
    if (
      value.version !== 1 ||
      !value.id ||
      value.sortBy !== expected.sortBy ||
      value.sortDirection !== expected.sortDirection ||
      (expected.isCustom && value.customFieldKey !== expected.customFieldKey) ||
      (expected.isCustom && value.customFieldType !== expected.customFieldType) ||
      (!expected.isCustom && value.customFieldKey !== undefined) ||
      (value.value !== null &&
        typeof value.value !== "string" &&
        typeof value.value !== "number" &&
        typeof value.value !== "boolean")
    ) {
      throw new Error("invalid cursor");
    }
    return value as TaskCursor;
  } catch {
    throw new TenantConflictError("Task cursor is invalid");
  }
}

export type CreateTaskInput = {
  projectId: string;
  title: string;
  sectionId?: string | null;
  parentId?: string | null;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  assigneeId?: string | null;
  assigneeIds?: string[];
  followerIds?: string[];
  reporterId?: string | null;
  startDate?: Date | null;
  order?: number;
  tags?: string[];
  customFields?: Record<string, unknown>;
  estimatedHours?: number | null;
  loggedHours?: number;
  dueDate?: Date | null;
  timezone?: string;
  progress?: number;
  storyPoints?: number | null;
  delayReason?: string | null;
  reminders?: TaskReminder[];
  recurrence?: TaskRecurrenceInput;
  isRecurring?: boolean;
  isMilestone?: boolean;
  dependencies?: string[];
  metadata?: Partial<TaskMetadata>;
};

export type UpdateTaskInput = Partial<
  Pick<
    TaskRecord,
    | "title"
    | "description"
    | "sectionId"
    | "parentId"
    | "status"
    | "priority"
    | "assigneeId"
    | "reporterId"
    | "dueDate"
    | "startDate"
    | "timezone"
    | "estimatedHours"
    | "loggedHours"
    | "progress"
    | "order"
    | "tags"
    | "customFields"
    | "isRecurring"
    | "isMilestone"
    | "storyPoints"
    | "delayReason"
  >
> & {
  expectedVersion?: number;
  assigneeIds?: string[];
  followerIds?: string[];
  dependencies?: string[];
  metadata?: Partial<TaskMetadata>;
  recurrence?: TaskRecurrenceInput | null;
};

export type MoveTaskInput = {
  status: TaskStatus;
  targetIndex: number;
  beforeTaskId?: string | null;
  afterTaskId?: string | null;
  expectedVersion: number;
};

type TaskReminderRecord = typeof taskReminders.$inferSelect;
type TaskRecurrenceRecord = typeof taskRecurrenceRules.$inferSelect;

function withTaskMetadata(
  task: TaskRecord,
  reminderRows?: TaskReminderRecord[],
  recurrenceRow?: TaskRecurrenceRecord | null,
) {
  const metadata = task.customFields ?? {};
  const reminders = reminderRows
    ? reminderRows.map((reminder) => ({
        id: reminder.externalId,
        time: reminder.remindAt.toISOString(),
        label: reminder.label,
        sent: reminder.status === "sent",
      }))
    : Array.isArray(metadata.reminders)
      ? (metadata.reminders as TaskReminder[])
      : undefined;
  const recurrence: TaskRecurrence | undefined = recurrenceRow
    ? {
        frequency: recurrenceRow.frequency,
        interval: recurrenceRow.interval,
        timezone: recurrenceRow.timezone,
        weekdays: recurrenceRow.weekdays,
        monthDay: recurrenceRow.monthDay,
        startsAt: recurrenceRow.startsAt.toISOString(),
        endsAt: recurrenceRow.endsAt?.toISOString() ?? null,
        maxOccurrences: recurrenceRow.maxOccurrences,
        occurrencesCreated: recurrenceRow.occurrencesCreated,
        nextOccurrenceAt: recurrenceRow.nextOccurrenceAt.toISOString(),
        lastOccurrenceAt: recurrenceRow.lastOccurrenceAt?.toISOString() ?? null,
        status: recurrenceRow.status,
      }
    : undefined;
  return {
    ...task,
    delayReason: task.delayReason ?? (typeof metadata.delayReason === "string" ? metadata.delayReason : null),
    dependencies: Array.isArray(metadata.dependencies)
      ? metadata.dependencies.filter((value): value is string => typeof value === "string")
      : undefined,
    reminders,
    recurrence,
    ...(recurrenceRow === undefined ? {} : { isRecurring: recurrenceRow !== null }),
  };
}

function normalizeReminders(reminders: TaskReminder[]) {
  const ids = new Set<string>();
  return reminders.map((reminder) => {
    const id = reminder.id.trim();
    const label = reminder.label.trim();
    const remindAt = new Date(reminder.time);
    if (!id || id.length > 128 || !label || label.length > 255 || Number.isNaN(remindAt.getTime())) {
      throw new TenantConflictError("Task reminder data is invalid");
    }
    if (ids.has(id)) throw new TenantConflictError("Task reminder ids must be unique");
    ids.add(id);
    return { ...reminder, id, label, remindAt };
  });
}

function normalizeRecurrence(input: TaskRecurrenceInput, fallbackStart: Date) {
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

export function createTasksRepository(context: DatabaseTenantContext) {
  assertWorkspaceTenantContext(context);
  const { organizationId, workspaceId, actorId } = context;

  const tenantScope = and(eq(tasks.organizationId, organizationId), eq(tasks.workspaceId, workspaceId))!;
  const maxSubtaskDepth = 5;
  const automationDepth = context.automation ? context.automation.depth + 1 : 0;

  function automationEventValues(
    task: TaskRecord,
    trigger: "task_created" | "task_status_changed" | "task_assignee_changed" | "task_priority_changed",
    previous?: TaskRecord,
    assignmentContext?: {
      assigneeId: string | null;
      assigneeIds: string[];
      previousAssigneeId?: string | null;
      previousAssigneeIds?: string[];
      addedAssigneeIds?: string[];
      removedAssigneeIds?: string[];
    },
  ) {
    const currentAssigneeId = assignmentContext ? assignmentContext.assigneeId : task.assigneeId;
    const currentAssigneeIds = assignmentContext
      ? assignmentContext.assigneeIds
      : task.assigneeId
        ? [task.assigneeId]
        : [];
    const previousAssigneeId =
      assignmentContext?.previousAssigneeId !== undefined
        ? assignmentContext.previousAssigneeId
        : previous
          ? previous.assigneeId
          : null;
    const previousAssigneeIds =
      assignmentContext?.previousAssigneeIds !== undefined
        ? assignmentContext.previousAssigneeIds
        : previous?.assigneeId
          ? [previous.assigneeId]
          : [];

    return {
      organizationId,
      workspaceId,
      taskId: task.id,
      trigger,
      taskVersion: task.version,
      actorId: actorId ?? null,
      previous: previous
        ? {
            status: previous.status,
            priority: previous.priority,
            assigneeId: previousAssigneeId,
            assigneeIds: previousAssigneeIds,
            version: previous.version,
          }
        : null,
      current: {
        status: task.status,
        priority: task.priority,
        projectId: task.projectId,
        assigneeId: currentAssigneeId,
        assigneeIds: currentAssigneeIds,
        ...(assignmentContext?.addedAssigneeIds ? { addedAssigneeIds: assignmentContext.addedAssigneeIds } : {}),
        ...(assignmentContext?.removedAssigneeIds ? { removedAssigneeIds: assignmentContext.removedAssigneeIds } : {}),
        tags: task.tags,
        version: task.version,
      },
      depth: automationDepth,
      parentEventId: context.automation?.parentEventId ?? null,
      deduplicationKey: `task/${task.id}/version/${task.version}/${trigger}`,
    };
  }

  async function loadParticipants(taskIds: string[]) {
    if (!taskIds.length) return { assigneeRows: [], followerRows: [] };
    const assigneeRows = await db
      .select()
      .from(taskAssignees)
      .where(
        and(
          eq(taskAssignees.organizationId, organizationId),
          eq(taskAssignees.workspaceId, workspaceId),
          inArray(taskAssignees.taskId, taskIds),
          isNull(taskAssignees.unassignedAt),
        ),
      )
      .orderBy(desc(taskAssignees.isPrimary), asc(taskAssignees.assignedAt), asc(taskAssignees.userId));
    const followerRows = await db
      .select()
      .from(taskFollowers)
      .where(
        and(
          eq(taskFollowers.organizationId, organizationId),
          eq(taskFollowers.workspaceId, workspaceId),
          inArray(taskFollowers.taskId, taskIds),
          isNull(taskFollowers.unfollowedAt),
        ),
      )
      .orderBy(asc(taskFollowers.followedAt), asc(taskFollowers.userId));
    return { assigneeRows, followerRows };
  }

  async function requireActiveMembers(userIds: string[]) {
    const uniqueUserIds = [...new Set(userIds)];
    if (!uniqueUserIds.length) return;
    const rows = await db
      .select({ id: users.id })
      .from(users)
      .innerJoin(memberships, and(eq(memberships.userId, users.id), eq(memberships.organizationId, organizationId)))
      .where(
        and(
          inArray(users.id, uniqueUserIds),
          eq(memberships.status, "active"),
          or(isNull(memberships.workspaceId), eq(memberships.workspaceId, workspaceId)),
        ),
      );
    if (new Set(rows.map((row) => row.id)).size !== uniqueUserIds.length) {
      throw new TenantResourceNotFoundError("task participant");
    }
  }

  async function parentChain(parentId: string | null | undefined) {
    const ancestors: string[] = [];
    let currentId = parentId;
    while (currentId) {
      if (ancestors.includes(currentId)) throw new TenantConflictError("Task parent hierarchy contains a cycle");
      ancestors.push(currentId);
      const parent = await getById(currentId);
      currentId = parent.parentId;
    }
    return ancestors;
  }

  async function loadSchedules(taskIds: string[]) {
    if (!taskIds.length) {
      return {
        remindersByTask: new Map<string, TaskReminderRecord[]>(),
        recurrenceByTask: new Map<string, TaskRecurrenceRecord>(),
      };
    }
    const reminderRows = await db
      .select()
      .from(taskReminders)
      .where(
        and(
          eq(taskReminders.organizationId, organizationId),
          eq(taskReminders.workspaceId, workspaceId),
          inArray(taskReminders.taskId, taskIds),
          isNull(taskReminders.deletedAt),
        ),
      )
      .orderBy(asc(taskReminders.remindAt));
    const recurrenceRows = await db
      .select()
      .from(taskRecurrenceRules)
      .where(
        and(
          eq(taskRecurrenceRules.organizationId, organizationId),
          eq(taskRecurrenceRules.workspaceId, workspaceId),
          inArray(taskRecurrenceRules.taskId, taskIds),
          isNull(taskRecurrenceRules.deletedAt),
        ),
      );
    const remindersByTask = new Map<string, TaskReminderRecord[]>();
    for (const reminder of reminderRows) {
      const rows = remindersByTask.get(reminder.taskId) ?? [];
      rows.push(reminder);
      remindersByTask.set(reminder.taskId, rows);
    }
    return {
      remindersByTask,
      recurrenceByTask: new Map(recurrenceRows.map((recurrence) => [recurrence.taskId, recurrence])),
    };
  }

  async function loadDependencyLinks(taskIds: string[]) {
    const linksByTask = new Map<string, TaskDependencyLink[]>();
    if (!taskIds.length) return linksByTask;
    const rows = await db
      .select({
        dependentTaskId: taskDependencies.dependentTaskId,
        blockingTaskId: taskDependencies.blockingTaskId,
        blockingTaskSerial: tasks.serial,
        type: taskDependencies.type,
        lagMinutes: taskDependencies.lagMinutes,
      })
      .from(taskDependencies)
      .innerJoin(
        tasks,
        and(
          eq(tasks.id, taskDependencies.blockingTaskId),
          eq(tasks.organizationId, organizationId),
          eq(tasks.workspaceId, workspaceId),
          isNull(tasks.deletedAt),
        ),
      )
      .where(
        and(
          eq(taskDependencies.organizationId, organizationId),
          eq(taskDependencies.workspaceId, workspaceId),
          inArray(taskDependencies.dependentTaskId, taskIds),
          isNull(taskDependencies.deletedAt),
        ),
      )
      .orderBy(asc(taskDependencies.createdAt), asc(taskDependencies.id));
    for (const row of rows) {
      const links = linksByTask.get(row.dependentTaskId) ?? [];
      links.push({
        blockingTaskId: row.blockingTaskId,
        blockingTaskSerial: row.blockingTaskSerial,
        type: row.type,
        lagMinutes: row.lagMinutes,
      });
      linksByTask.set(row.dependentTaskId, links);
    }
    return linksByTask;
  }

  async function getById(taskId: string, includeDeleted = false) {
    const conditions = [eq(tasks.id, taskId), tenantScope];
    if (!includeDeleted) {
      conditions.push(isNull(tasks.deletedAt));
    }

    const [task] = await db
      .select()
      .from(tasks)
      .where(and(...conditions))
      .limit(1);

    if (!task) {
      throw new TenantResourceNotFoundError("task");
    }
    const [hydrated] = await hydrateTaskRows([task]);
    return hydrated!;
  }

  async function validateCreateInput(input: CreateTaskInput) {
    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(
        and(
          eq(projects.id, input.projectId),
          eq(projects.organizationId, organizationId),
          eq(projects.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    if (!project) {
      throw new TenantResourceNotFoundError("project");
    }

    if (input.parentId) {
      const parent = await getById(input.parentId);
      if (parent.projectId !== input.projectId) {
        throw new TenantResourceNotFoundError("parent task");
      }
      if ((await parentChain(input.parentId)).length > maxSubtaskDepth) {
        throw new TenantConflictError(`Task nesting cannot exceed ${maxSubtaskDepth} levels`);
      }
    }

    if (input.sectionId) {
      const [section] = await db
        .select({ id: projectSections.id })
        .from(projectSections)
        .where(
          and(
            eq(projectSections.id, input.sectionId),
            eq(projectSections.projectId, input.projectId),
            isNull(projectSections.deletedAt),
          ),
        )
        .limit(1);
      if (!section) {
        throw new TenantResourceNotFoundError("project section");
      }
    }
    await resolveCustomFields(input.projectId, input.customFields, { isCreate: true });
    resolveTaskStateCreation(input);
    const resolvedAssignments = resolveTaskAssignmentCreation(input);
    await requireActiveMembers([
      ...resolvedAssignments.assigneeIds,
      ...(input.followerIds ?? []),
      ...(input.reporterId ? [input.reporterId] : []),
    ]);
    const rawDependencies = input.dependencies ?? input.metadata?.dependencies;
    if (rawDependencies !== undefined) {
      const taskDependenciesRepo = createTaskDependenciesRepository(context, db);
      await taskDependenciesRepo.validateTaskDependenciesInput(null, rawDependencies);
    }
  }

  async function resolveCustomFields(
    projectId: string,
    customFieldsInput?: Record<string, unknown> | null,
    options?: ValidateTaskCustomFieldsOptions,
  ) {
    const definitions = await db
      .select()
      .from(customFields)
      .where(
        and(
          eq(customFields.organizationId, organizationId),
          eq(customFields.workspaceId, workspaceId),
          isNull(customFields.deletedAt),
        ),
      );

    return validateAndNormalizeTaskCustomFields(
      { organizationId, workspaceId, projectId },
      customFieldsInput,
      definitions,
      options,
    );
  }

  async function validateUpdateInput(taskId: string, projectId: string, input: UpdateTaskInput) {
    if (input.parentId) {
      if (input.parentId === taskId) {
        throw new TenantConflictError("A task cannot be its own parent");
      }
      const parent = await getById(input.parentId);
      if (parent.projectId !== projectId) {
        throw new TenantResourceNotFoundError("parent task");
      }
      const ancestors = await parentChain(input.parentId);
      if (ancestors.includes(taskId)) throw new TenantConflictError("Task parent would create a cycle");
      if (ancestors.length > maxSubtaskDepth) {
        throw new TenantConflictError(`Task nesting cannot exceed ${maxSubtaskDepth} levels`);
      }
    }

    if (input.sectionId) {
      const [section] = await db
        .select({ id: projectSections.id })
        .from(projectSections)
        .where(
          and(
            eq(projectSections.id, input.sectionId),
            eq(projectSections.projectId, projectId),
            isNull(projectSections.deletedAt),
          ),
        )
        .limit(1);
      if (!section) {
        throw new TenantResourceNotFoundError("project section");
      }
    }
    const before = await getById(taskId);
    if (input.customFields !== undefined) {
      await resolveCustomFields(projectId, input.customFields, {
        existingCustomFields: before.customFields,
      });
    }
    resolveTaskStateUpdate(before, input);
    const resolvedAssignments = resolveTaskAssignmentUpdate(before, input);
    await requireActiveMembers([
      ...resolvedAssignments.assigneeIds,
      ...(input.followerIds ?? []),
      ...(input.reporterId ? [input.reporterId] : []),
    ]);
  }

  async function loadDefinitionsForFilters(filters: TaskListFilters) {
    const referencedKeys = new Set<string>();
    if (filters.customSort?.fieldKey) {
      referencedKeys.add(filters.customSort.fieldKey);
    }
    if (filters.customFieldFilters) {
      for (const f of filters.customFieldFilters) {
        if (f.fieldKey) referencedKeys.add(f.fieldKey);
      }
    }
    if (referencedKeys.size === 0) {
      return new Map<string, CustomFieldRecord>();
    }
    const keyList = [...referencedKeys];
    const rows = await db
      .select()
      .from(customFields)
      .where(
        and(
          eq(customFields.organizationId, organizationId),
          eq(customFields.workspaceId, workspaceId),
          filters.projectId
            ? or(isNull(customFields.projectId), eq(customFields.projectId, filters.projectId))
            : undefined,
          inArray(customFields.key, keyList),
          isNull(customFields.deletedAt),
        ),
      );
    const defsByKey = new Map<string, CustomFieldRecord>();
    for (const row of rows) {
      defsByKey.set(row.key, row);
    }
    for (const key of keyList) {
      const def = defsByKey.get(key);
      if (!def) {
        throw new TenantConflictError(`Unknown custom field '${key}'`);
      }
      if (def.projectId !== null && filters.projectId && def.projectId !== filters.projectId) {
        throw new TenantConflictError(`Custom field '${key}' belongs to another project`);
      }
      if (def.sensitive === true) {
        throw new TenantConflictError("Querying sensitive custom fields is not supported");
      }
    }
    return defsByKey;
  }

  function buildListConditions(filters: TaskListFilters, defsByKey: Map<string, CustomFieldRecord> = new Map()) {
    const conditions: SQL[] = [tenantScope, isNull(tasks.deletedAt)];
    if (filters.projectId) conditions.push(eq(tasks.projectId, filters.projectId));
    if (filters.status) conditions.push(eq(tasks.status, filters.status));
    if (filters.priority) conditions.push(eq(tasks.priority, filters.priority));
    if (filters.sectionId) conditions.push(eq(tasks.sectionId, filters.sectionId));
    if (filters.assigneeId) {
      conditions.push(
        sql`exists (
          select 1 from ${taskAssignees} participant
          where participant.task_id = ${tasks.id}
            and participant.organization_id = ${organizationId}
            and participant.workspace_id = ${workspaceId}
            and participant.user_id = ${filters.assigneeId}
            and participant.unassigned_at is null
        )`,
      );
    }
    if (filters.tag) conditions.push(sql`${tasks.tags} @> ${JSON.stringify([filters.tag])}::jsonb`);
    if (filters.dueFrom) conditions.push(gte(tasks.dueDate, filters.dueFrom));
    if (filters.dueTo) conditions.push(lte(tasks.dueDate, filters.dueTo));
    if (filters.calendarFrom && filters.calendarTo) {
      conditions.push(
        and(
          or(isNotNull(tasks.startDate), isNotNull(tasks.dueDate)),
          lte(sql`coalesce(${tasks.startDate}, ${tasks.dueDate})`, filters.calendarTo),
          gte(sql`coalesce(${tasks.dueDate}, ${tasks.startDate})`, filters.calendarFrom),
        )!,
      );
    } else if (filters.calendarFrom) {
      conditions.push(
        and(
          or(isNotNull(tasks.startDate), isNotNull(tasks.dueDate)),
          gte(sql`coalesce(${tasks.dueDate}, ${tasks.startDate})`, filters.calendarFrom),
        )!,
      );
    } else if (filters.calendarTo) {
      conditions.push(
        and(
          or(isNotNull(tasks.startDate), isNotNull(tasks.dueDate)),
          lte(sql`coalesce(${tasks.startDate}, ${tasks.dueDate})`, filters.calendarTo),
        )!,
      );
    }
    if (filters.parentId) conditions.push(eq(tasks.parentId, filters.parentId));
    else if (!filters.includeSubtasks) conditions.push(isNull(tasks.parentId));
    if (filters.search) {
      const pattern = `%${filters.search}%`;
      const searchCondition = or(ilike(tasks.title, pattern), ilike(tasks.serial, pattern));
      if (searchCondition) conditions.push(searchCondition);
    }

    if (filters.customFieldFilters && filters.customFieldFilters.length > 0) {
      for (const rawFilter of filters.customFieldFilters) {
        const validated = validateAndNormalizeCustomFieldFilter(rawFilter, defsByKey, {
          organizationId,
          workspaceId,
          projectId: filters.projectId,
        });
        const cond = buildCustomFieldSqlCondition(validated, validated.definition, tasks.customFields);
        conditions.push(cond);
      }
    }

    return conditions;
  }

  function taskSort(filters: TaskListFilters, defsByKey: Map<string, CustomFieldRecord> = new Map()) {
    if (filters.customSort) {
      const def = defsByKey.get(filters.customSort.fieldKey)!;
      const col = buildCustomFieldSqlSortColumn(def, tasks.customFields);
      return filters.customSort.direction === "desc"
        ? [sql`${col} desc nulls last`, desc(tasks.createdAt), desc(tasks.id)]
        : [sql`${col} asc nulls last`, desc(tasks.createdAt), desc(tasks.id)];
    }
    const direction = filters.sortDirection === "desc" ? desc : asc;
    const column =
      filters.sortBy === "createdAt"
        ? tasks.createdAt
        : filters.sortBy === "updatedAt"
          ? tasks.updatedAt
          : filters.sortBy === "dueDate"
            ? tasks.dueDate
            : filters.sortBy === "priority"
              ? tasks.priority
              : filters.sortBy === "title"
                ? tasks.title
                : filters.sortBy === "status"
                  ? tasks.status
                  : filters.sortBy === "assigneeId"
                    ? tasks.assigneeId
                    : filters.sortBy === "storyPoints"
                      ? tasks.storyPoints
                      : filters.sortBy === "estimatedHours"
                        ? tasks.estimatedHours
                        : filters.sortBy === "loggedHours"
                          ? tasks.loggedHours
                          : tasks.order;
    return [direction(column), desc(tasks.createdAt), desc(tasks.id)] as const;
  }

  function taskPageColumn(sortBy: TaskSortField) {
    switch (sortBy) {
      case "order":
        return tasks.order;
      case "createdAt":
        return tasks.createdAt;
      case "updatedAt":
        return tasks.updatedAt;
      case "dueDate":
        return tasks.dueDate;
      case "priority":
        return tasks.priority;
      case "title":
        return tasks.title;
      case "status":
        return tasks.status;
      case "assigneeId":
        return tasks.assigneeId;
      case "storyPoints":
        return tasks.storyPoints;
      case "estimatedHours":
        return tasks.estimatedHours;
      case "loggedHours":
        return tasks.loggedHours;
    }
  }

  function taskPageOrder(filters: TaskListFilters, defsByKey: Map<string, CustomFieldRecord> = new Map()) {
    const sort = pageSort(filters);
    if (sort.isCustom) {
      const def = defsByKey.get(sort.customFieldKey)!;
      const col = buildCustomFieldSqlSortColumn(def, tasks.customFields);
      return sort.sortDirection === "asc"
        ? ([sql`${col} asc nulls last`, asc(tasks.id)] as const)
        : ([sql`${col} desc nulls last`, desc(tasks.id)] as const);
    }
    const column = taskPageColumn(sort.sortBy);
    return sort.sortDirection === "asc"
      ? ([sql`${column} asc nulls last`, asc(tasks.id)] as const)
      : ([sql`${column} desc nulls last`, desc(tasks.id)] as const);
  }

  function taskPageCursorCondition(cursor: TaskCursor, defsByKey: Map<string, CustomFieldRecord> = new Map()): SQL {
    if (cursor.sortBy === "customField") {
      const def = defsByKey.get(cursor.customFieldKey!);
      if (!def) throw new TenantConflictError("Task cursor is invalid");
      const col = buildCustomFieldSqlSortColumn(def, tasks.customFields);
      const rawVal = cursor.value;
      if (rawVal === null) {
        return cursor.sortDirection === "asc"
          ? sql`(${tasks.customFields}->>${def.key} is null or ${tasks.customFields}->>${def.key} = '') and ${tasks.id} > ${cursor.id}`
          : sql`(${tasks.customFields}->>${def.key} is null or ${tasks.customFields}->>${def.key} = '') and ${tasks.id} < ${cursor.id}`;
      }
      let decodedValue: SQL;
      if (def.type === "number") {
        decodedValue = sql`${Number(rawVal)}`;
      } else if (def.type === "date") {
        const d = new Date(String(rawVal));
        if (Number.isNaN(d.getTime())) throw new TenantConflictError("Task cursor is invalid");
        decodedValue = sql`${d.toISOString()}::timestamptz`;
      } else if (def.type === "checkbox") {
        decodedValue = sql`${Boolean(rawVal)}`;
      } else {
        decodedValue = sql`${String(rawVal)}`;
      }

      return cursor.sortDirection === "asc"
        ? sql`(${col} > ${decodedValue} or (${tasks.customFields}->>${def.key} is null or ${tasks.customFields}->>${def.key} = '') or (${col} = ${decodedValue} and ${tasks.id} > ${cursor.id}))`
        : sql`(${col} < ${decodedValue} or (${tasks.customFields}->>${def.key} is null or ${tasks.customFields}->>${def.key} = '') or (${col} = ${decodedValue} and ${tasks.id} < ${cursor.id}))`;
    }

    const column = taskPageColumn(cursor.sortBy);
    const decodedValue =
      cursor.value !== null &&
      (cursor.sortBy === "createdAt" || cursor.sortBy === "updatedAt" || cursor.sortBy === "dueDate")
        ? new Date(String(cursor.value))
        : cursor.value;
    if (decodedValue instanceof Date && Number.isNaN(decodedValue.getTime())) {
      throw new TenantConflictError("Task cursor is invalid");
    }
    if (decodedValue === null) {
      return cursor.sortDirection === "asc"
        ? sql`${column} is null and ${tasks.id} > ${cursor.id}`
        : sql`${column} is null and ${tasks.id} < ${cursor.id}`;
    }
    return cursor.sortDirection === "asc"
      ? sql`(${column} > ${decodedValue} or ${column} is null or (${column} = ${decodedValue} and ${tasks.id} > ${cursor.id}))`
      : sql`(${column} < ${decodedValue} or ${column} is null or (${column} = ${decodedValue} and ${tasks.id} < ${cursor.id}))`;
  }

  async function hydrateTaskRows(rows: TaskRecord[]) {
    const primaryAssigneeIds = [...new Set(rows.flatMap((task) => (task.assigneeId ? [task.assigneeId] : [])))];
    const sectionIds = [...new Set(rows.flatMap((task) => (task.sectionId ? [task.sectionId] : [])))];

    const primaryAssignees = primaryAssigneeIds.length
      ? await db.select().from(users).where(inArray(users.id, primaryAssigneeIds))
      : [];
    const sections = sectionIds.length
      ? await db
          .select()
          .from(projectSections)
          .where(and(inArray(projectSections.id, sectionIds), isNull(projectSections.deletedAt)))
      : [];
    const taskIds = rows.map((task) => task.id);
    const childRows = taskIds.length
      ? await db
          .select({
            parentId: tasks.parentId,
            total: count(),
            done: sql<number>`count(*) filter (where ${tasks.status} = 'done')::int`,
          })
          .from(tasks)
          .where(and(tenantScope, inArray(tasks.parentId, taskIds), isNull(tasks.deletedAt)))
          .groupBy(tasks.parentId)
      : [];
    const schedules = await loadSchedules(rows.map((task) => task.id));
    const dependencyLinksByTask = await loadDependencyLinks(rows.map((task) => task.id));
    const participants = await loadParticipants(rows.map((task) => task.id));

    const participantIds = [
      ...participants.assigneeRows.map((row) => row.userId),
      ...participants.followerRows.map((row) => row.userId),
    ];
    const participantUsers = participantIds.length
      ? await db
          .select()
          .from(users)
          .where(inArray(users.id, [...new Set(participantIds)]))
      : [];
    const userMap = new Map([...primaryAssignees, ...participantUsers].map((user) => [user.id, user]));
    const assigneesByTask = new Map<string, (typeof participantUsers)[number][]>();
    const followersByTask = new Map<string, (typeof participantUsers)[number][]>();
    for (const row of participants.assigneeRows) {
      const user = userMap.get(row.userId);
      if (user) assigneesByTask.set(row.taskId, [...(assigneesByTask.get(row.taskId) ?? []), user]);
    }
    for (const row of participants.followerRows) {
      const user = userMap.get(row.userId);
      if (user) followersByTask.set(row.taskId, [...(followersByTask.get(row.taskId) ?? []), user]);
    }
    const sectionMap = new Map(sections.map((section) => [section.id, section]));
    const childrenByParent = new Map<string, { total: number; done: number }>();
    for (const child of childRows) {
      if (child.parentId) childrenByParent.set(child.parentId, { total: child.total, done: child.done });
    }

    return rows.map((task) => {
      const dependencyLinks = dependencyLinksByTask.get(task.id) ?? [];
      return {
        ...withTaskMetadata(
          task,
          schedules.remindersByTask.get(task.id) ?? [],
          schedules.recurrenceByTask.get(task.id) ?? null,
        ),
        dependencies: dependencyLinks.map((link) => link.blockingTaskSerial),
        dependencyLinks,
        assignee: task.assigneeId ? (userMap.get(task.assigneeId) ?? null) : null,
        assigneeIds: (assigneesByTask.get(task.id) ?? []).map((user) => user.id),
        followerIds: (followersByTask.get(task.id) ?? []).map((user) => user.id),
        assignees: assigneesByTask.get(task.id) ?? [],
        followers: followersByTask.get(task.id) ?? [],
        section: task.sectionId ? (sectionMap.get(task.sectionId) ?? null) : null,
        subtaskStats: childrenByParent.get(task.id) ?? { total: 0, done: 0 },
      };
    });
  }

  return {
    getById,

    async list(filters: TaskListFilters = {}) {
      const defsByKey = await loadDefinitionsForFilters(filters);
      const rows = await db
        .select()
        .from(tasks)
        .where(and(...buildListConditions(filters, defsByKey)))
        .orderBy(...taskSort(filters, defsByKey));
      return hydrateTaskRows(rows);
    },

    async listPage(filters: TaskPageFilters) {
      if (!Number.isInteger(filters.limit) || filters.limit < 1 || filters.limit > 100) {
        throw new TenantConflictError("Task page limit must be between 1 and 100");
      }
      const defsByKey = await loadDefinitionsForFilters(filters);
      const conditions = buildListConditions(filters, defsByKey);
      const countConditions = [...conditions];
      if (filters.cursor) {
        conditions.push(taskPageCursorCondition(decodeTaskCursor(filters.cursor, filters, defsByKey), defsByKey));
      }
      const rows = await db
        .select()
        .from(tasks)
        .where(and(...conditions))
        .orderBy(...taskPageOrder(filters, defsByKey))
        .limit(filters.limit + 1);
      const totals = await db
        .select({ total: count() })
        .from(tasks)
        .where(and(...countConditions));
      const hasMore = rows.length > filters.limit;
      const pageRows = hasMore ? rows.slice(0, filters.limit) : rows;
      return {
        items: await hydrateTaskRows(pageRows),
        nextCursor:
          hasMore && pageRows.length ? encodeTaskCursor(pageRows[pageRows.length - 1]!, filters, defsByKey) : null,
        total: totals[0]?.total ?? 0,
      };
    },

    async create(input: CreateTaskInput) {
      await validateCreateInput(input);
      const canonicalCustomFields = await resolveCustomFields(input.projectId, input.customFields, { isCreate: true });
      const [serialNumber] = await allocateTaskSerialNumbers(organizationId);
      const reminders = input.reminders ? normalizeReminders(input.reminders) : [];
      const canonicalState = resolveTaskStateCreation(input);
      const recurrence = canonicalState.recurrence;

      const { assigneeId: primaryAssigneeId, assigneeIds: finalAssigneeIds } = resolveTaskAssignmentCreation(input);
      const followerIds = [...new Set(input.followerIds ?? [])];

      const rawDependencies = input.dependencies ?? input.metadata?.dependencies;
      const taskDependenciesRepo = createTaskDependenciesRepository(context, db);
      const validatedDependencies =
        rawDependencies !== undefined
          ? await taskDependenciesRepo.validateTaskDependenciesInput(null, rawDependencies)
          : [];

      const task = await db.transaction(async (transaction) => {
        const [created] = await transaction
          .insert(tasks)
          .values({
            organizationId,
            workspaceId,
            projectId: input.projectId,
            sectionId: input.sectionId ?? null,
            parentId: input.parentId ?? null,
            title: input.title,
            description: input.description ?? "",
            status: canonicalState.status,
            priority: canonicalState.priority,
            assigneeId: primaryAssigneeId,
            reporterId: input.reporterId ?? null,
            serial: formatTaskSerial(serialNumber),
            order: input.order ?? serialNumber - FIRST_TASK_SERIAL_NUMBER,
            tags: input.tags ?? [],
            customFields: canonicalCustomFields,
            estimatedHours: input.estimatedHours ?? 4,
            loggedHours: input.loggedHours ?? 0,
            startDate: canonicalState.startDate,
            dueDate: canonicalState.dueDate,
            timezone: canonicalState.timezone,
            progress: canonicalState.progress,
            storyPoints: input.storyPoints ?? null,
            delayReason: input.delayReason ?? null,
            isMilestone: canonicalState.isMilestone,
            isRecurring: canonicalState.isRecurring,
          })
          .returning();

        if (finalAssigneeIds.length) {
          await transaction
            .insert(taskAssignees)
            .values(
              finalAssigneeIds.map((userId) => ({
                organizationId,
                workspaceId,
                projectId: input.projectId,
                taskId: created.id,
                userId,
                isPrimary: userId === primaryAssigneeId,
                assignedBy: actorId ?? null,
              })),
            )
            .onConflictDoNothing();
        }
        const initialWatcherIds = [
          ...new Set([...(input.reporterId ? [input.reporterId] : []), ...finalAssigneeIds, ...followerIds]),
        ];
        if (initialWatcherIds.length) {
          const followersRepo = createTaskFollowersRepository(context, transaction);
          await followersRepo.ensureWatchers(created.id, initialWatcherIds);
        }

        if (reminders.length) {
          await transaction.insert(taskReminders).values(
            reminders.map((reminder) => ({
              organizationId,
              workspaceId,
              projectId: input.projectId,
              taskId: created.id,
              externalId: reminder.id,
              remindAt: reminder.remindAt,
              label: reminder.label,
              status: reminder.sent ? ("sent" as const) : ("scheduled" as const),
              sentAt: reminder.sent ? reminder.remindAt : null,
              createdBy: actorId ?? null,
            })),
          );
        }
        if (recurrence) {
          await transaction.insert(taskRecurrenceRules).values({
            organizationId,
            workspaceId,
            projectId: input.projectId,
            taskId: created.id,
            createdBy: actorId ?? null,
            ...recurrence,
          });
        }
        if (validatedDependencies.length) {
          const txDependenciesRepo = createTaskDependenciesRepository(context, transaction);
          await txDependenciesRepo.replaceTaskDependencies(created.id, validatedDependencies, actorId);
        }
        if (automationDepth <= maxSubtaskDepth) {
          await transaction.insert(automationEvents).values(
            automationEventValues(created, "task_created", undefined, {
              assigneeId: primaryAssigneeId,
              assigneeIds: finalAssigneeIds,
            }),
          );
        }
        return created;
      });

      return getById(task.id);
    },

    async move(taskId: string, input: MoveTaskInput) {
      if (!Number.isInteger(input.targetIndex) || input.targetIndex < 0) {
        throw new TenantConflictError("Task target index must be a non-negative integer");
      }
      if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
        throw new TenantConflictError("Task expected version is required");
      }
      const before = await getById(taskId);
      if (before.parentId) throw new TenantConflictError("Subtasks cannot be moved on the project board");

      const moved = await db.transaction(async (transaction) => {
        const [lockedProject] = await transaction
          .select({ id: projects.id })
          .from(projects)
          .where(
            and(
              eq(projects.id, before.projectId),
              eq(projects.organizationId, organizationId),
              eq(projects.workspaceId, workspaceId),
              isNull(projects.deletedAt),
            ),
          )
          .for("update")
          .limit(1);
        if (!lockedProject) throw new TenantResourceNotFoundError("project");

        const [lockedTask] = await transaction
          .select()
          .from(tasks)
          .where(and(eq(tasks.id, taskId), tenantScope, isNull(tasks.deletedAt)))
          .for("update")
          .limit(1);
        if (!lockedTask) throw new TenantResourceNotFoundError("task");
        if (lockedTask.version !== input.expectedVersion) {
          throw new TenantConflictError("Task was modified by another request; reload it and retry");
        }

        const usesAnchors = input.beforeTaskId !== undefined || input.afterTaskId !== undefined;
        if (usesAnchors) {
          if (
            input.beforeTaskId === lockedTask.id ||
            input.afterTaskId === lockedTask.id ||
            (input.beforeTaskId && input.beforeTaskId === input.afterTaskId)
          ) {
            throw new TenantConflictError("Task move anchors are invalid");
          }
          const requestedAnchorIds = [input.beforeTaskId, input.afterTaskId].filter(Boolean) as string[];
          const requestedAnchors = requestedAnchorIds.length
            ? await transaction
                .select({ id: tasks.id, order: tasks.order })
                .from(tasks)
                .where(
                  and(
                    tenantScope,
                    eq(tasks.projectId, lockedTask.projectId),
                    eq(tasks.status, input.status),
                    inArray(tasks.id, requestedAnchorIds),
                    isNull(tasks.parentId),
                    isNull(tasks.deletedAt),
                  ),
                )
            : [];
          if (requestedAnchors.length !== requestedAnchorIds.length) {
            throw new TenantConflictError("Task move anchor was not found in the target column");
          }
          let beforeAnchor = input.beforeTaskId
            ? requestedAnchors.find((task) => task.id === input.beforeTaskId)
            : undefined;
          let afterAnchor = input.afterTaskId
            ? requestedAnchors.find((task) => task.id === input.afterTaskId)
            : undefined;

          if (beforeAnchor && !afterAnchor) {
            [afterAnchor] = await transaction
              .select({ id: tasks.id, order: tasks.order })
              .from(tasks)
              .where(
                and(
                  tenantScope,
                  eq(tasks.projectId, lockedTask.projectId),
                  eq(tasks.status, input.status),
                  sql`(${tasks.order} > ${beforeAnchor.order} or (${tasks.order} = ${beforeAnchor.order} and ${tasks.id} > ${beforeAnchor.id}))`,
                  sql`${tasks.id} <> ${lockedTask.id}`,
                  isNull(tasks.parentId),
                  isNull(tasks.deletedAt),
                ),
              )
              .orderBy(asc(tasks.order), asc(tasks.id))
              .limit(1);
          } else if (!beforeAnchor && afterAnchor) {
            [beforeAnchor] = await transaction
              .select({ id: tasks.id, order: tasks.order })
              .from(tasks)
              .where(
                and(
                  tenantScope,
                  eq(tasks.projectId, lockedTask.projectId),
                  eq(tasks.status, input.status),
                  sql`(${tasks.order} < ${afterAnchor.order} or (${tasks.order} = ${afterAnchor.order} and ${tasks.id} < ${afterAnchor.id}))`,
                  sql`${tasks.id} <> ${lockedTask.id}`,
                  isNull(tasks.parentId),
                  isNull(tasks.deletedAt),
                ),
              )
              .orderBy(desc(tasks.order), desc(tasks.id))
              .limit(1);
          }

          if (beforeAnchor && afterAnchor && beforeAnchor.order > afterAnchor.order) {
            throw new TenantConflictError("Task move anchors are out of order");
          }
          const targetOrder =
            beforeAnchor && afterAnchor
              ? (beforeAnchor.order + afterAnchor.order) / 2
              : beforeAnchor
                ? beforeAnchor.order + 1
                : afterAnchor
                  ? afterAnchor.order - 1
                  : 0;
          if (
            !Number.isFinite(targetOrder) ||
            (beforeAnchor && targetOrder <= beforeAnchor.order) ||
            (afterAnchor && targetOrder >= afterAnchor.order)
          ) {
            throw new TenantConflictError("Task column order requires maintenance before this move can be applied");
          }

          if (lockedTask.status !== input.status) {
            const [wipLimit] = await transaction
              .select({ limit: projectWipLimits.limit })
              .from(projectWipLimits)
              .where(
                and(
                  eq(projectWipLimits.organizationId, organizationId),
                  eq(projectWipLimits.workspaceId, workspaceId),
                  eq(projectWipLimits.projectId, lockedTask.projectId),
                  eq(projectWipLimits.status, input.status),
                ),
              )
              .limit(1);
            const [targetCount] = await transaction
              .select({ total: count() })
              .from(tasks)
              .where(
                and(
                  tenantScope,
                  eq(tasks.projectId, lockedTask.projectId),
                  eq(tasks.status, input.status),
                  isNull(tasks.parentId),
                  isNull(tasks.deletedAt),
                ),
              );
            if (wipLimit && (targetCount?.total ?? 0) + 1 > wipLimit.limit) {
              throw new TenantConflictError(`WIP limit of ${wipLimit.limit} for '${input.status}' would be exceeded`);
            }
          }

          const changedAt = new Date();
          const [movedTask] = await transaction
            .update(tasks)
            .set({
              status: input.status,
              order: targetOrder,
              ...(input.status === "done" ? { progress: 100 } : {}),
              version: sql`${tasks.version} + 1`,
              updatedAt: changedAt,
            })
            .where(
              and(
                eq(tasks.id, lockedTask.id),
                tenantScope,
                isNull(tasks.deletedAt),
                eq(tasks.version, input.expectedVersion),
              ),
            )
            .returning();
          if (!movedTask) throw new TenantConflictError("Task move could not be persisted");
          if (lockedTask.status !== movedTask.status && automationDepth <= maxSubtaskDepth) {
            await transaction
              .insert(automationEvents)
              .values(automationEventValues(movedTask, "task_status_changed", lockedTask));
          }
          if (movedTask.sprintId) {
            const { deriveSprintTaskAnalyticsEvents, appendSprintAnalyticsEvents } =
              await import("./sprint-analytics.js");
            const analyticsEvents = deriveSprintTaskAnalyticsEvents(before, movedTask);
            if (analyticsEvents.length > 0) {
              const [sprint] = await transaction
                .select({ status: sprints.status })
                .from(sprints)
                .where(and(eq(sprints.id, movedTask.sprintId), eq(sprints.organizationId, organizationId)));
              if (sprint?.status === "active") {
                await appendSprintAnalyticsEvents(
                  { db: transaction, organizationId, workspaceId },
                  analyticsEvents.map((e) => ({
                    ...e,
                    projectId: movedTask.projectId,
                    sprintId: movedTask.sprintId!,
                    taskId: movedTask.id,
                    actorId: actorId ?? undefined,
                  })),
                );
              }
            }
          }
          return movedTask;
        }

        const relevantStatuses =
          lockedTask.status === input.status ? [input.status] : [lockedTask.status, input.status];
        const boardRows = await transaction
          .select()
          .from(tasks)
          .where(
            and(
              tenantScope,
              eq(tasks.projectId, lockedTask.projectId),
              inArray(tasks.status, relevantStatuses),
              isNull(tasks.parentId),
              isNull(tasks.deletedAt),
            ),
          )
          .orderBy(asc(tasks.order), asc(tasks.createdAt), asc(tasks.id));

        const sourceRows = boardRows.filter((task) => task.status === lockedTask.status && task.id !== lockedTask.id);
        const targetRows =
          lockedTask.status === input.status
            ? sourceRows
            : boardRows.filter((task) => task.status === input.status && task.id !== lockedTask.id);
        const targetIndex = Math.min(input.targetIndex, targetRows.length);
        const targetWithMoved = [...targetRows];
        targetWithMoved.splice(targetIndex, 0, { ...lockedTask, status: input.status });

        if (lockedTask.status !== input.status) {
          const [wipLimit] = await transaction
            .select({ limit: projectWipLimits.limit })
            .from(projectWipLimits)
            .where(
              and(
                eq(projectWipLimits.organizationId, organizationId),
                eq(projectWipLimits.workspaceId, workspaceId),
                eq(projectWipLimits.projectId, lockedTask.projectId),
                eq(projectWipLimits.status, input.status),
              ),
            )
            .limit(1);
          if (wipLimit && targetWithMoved.length > wipLimit.limit) {
            throw new TenantConflictError(`WIP limit of ${wipLimit.limit} for '${input.status}' would be exceeded`);
          }
        }

        const finalColumns =
          lockedTask.status === input.status
            ? [{ status: input.status, rows: targetWithMoved }]
            : [
                { status: lockedTask.status, rows: sourceRows },
                { status: input.status, rows: targetWithMoved },
              ];
        let movedTask: TaskRecord | undefined;
        const changedAt = new Date();
        for (const column of finalColumns) {
          for (const [order, row] of column.rows.entries()) {
            const [updated] = await transaction
              .update(tasks)
              .set({
                status: column.status,
                order,
                ...(row.id === lockedTask.id && column.status === "done" ? { progress: 100 } : {}),
                version: sql`${tasks.version} + 1`,
                updatedAt: changedAt,
              })
              .where(and(eq(tasks.id, row.id), tenantScope, isNull(tasks.deletedAt)))
              .returning();
            if (row.id === lockedTask.id) movedTask = updated;
          }
        }
        if (!movedTask) throw new TenantConflictError("Task move could not be persisted");
        if (lockedTask.status !== movedTask.status && automationDepth <= maxSubtaskDepth) {
          await transaction
            .insert(automationEvents)
            .values(automationEventValues(movedTask, "task_status_changed", lockedTask));
        }
        if (movedTask.sprintId) {
          const { deriveSprintTaskAnalyticsEvents, appendSprintAnalyticsEvents } =
            await import("./sprint-analytics.js");
          const analyticsEvents = deriveSprintTaskAnalyticsEvents(before, movedTask);
          if (analyticsEvents.length > 0) {
            const [sprint] = await transaction
              .select({ status: sprints.status })
              .from(sprints)
              .where(and(eq(sprints.id, movedTask.sprintId), eq(sprints.organizationId, organizationId)));
            if (sprint?.status === "active") {
              await appendSprintAnalyticsEvents(
                { db: transaction, organizationId, workspaceId },
                analyticsEvents.map((e) => ({
                  ...e,
                  projectId: movedTask.projectId,
                  sprintId: movedTask.sprintId!,
                  taskId: movedTask.id,
                  actorId: actorId ?? undefined,
                })),
              );
            }
          }
        }
        return movedTask;
      });

      assertValidTaskStatus(input.status);
      return { before, task: await getById(moved.id) };
    },

    async update(taskId: string, input: UpdateTaskInput) {
      const before = await getById(taskId);
      if (!Number.isInteger(input.expectedVersion) || input.expectedVersion! < 1) {
        throw new TenantConflictError("Task expected version is required");
      }
      await validateUpdateInput(taskId, before.projectId, input);
      const {
        metadata,
        recurrence: recurrenceInput,
        assigneeIds,
        followerIds,
        expectedVersion,
        ...taskUpdates
      } = input;

      const stateResolution = resolveTaskStateUpdate(before, input);
      const { state: canonicalState, hasStateChange } = stateResolution;

      if (stateResolution.statusChanged) taskUpdates.status = canonicalState.status;
      if (stateResolution.priorityChanged) taskUpdates.priority = canonicalState.priority;
      if (stateResolution.progressChanged) taskUpdates.progress = canonicalState.progress;
      if (stateResolution.datesChanged) {
        taskUpdates.startDate = canonicalState.startDate;
        taskUpdates.dueDate = canonicalState.dueDate;
      }
      if (stateResolution.milestoneChanged) taskUpdates.isMilestone = canonicalState.isMilestone;
      if (stateResolution.recurrenceChanged) taskUpdates.isRecurring = canonicalState.isRecurring;
      const recurrence = stateResolution.recurrenceChanged ? canonicalState.recurrence : undefined;

      const {
        assigneeId: finalAssigneeId,
        assigneeIds: finalAssigneeIds,
        addedAssigneeIds,
        removedAssigneeIds,
        primaryChanged,
        changed: assigneeChanged,
        hasAssigneeMutation,
      } = resolveTaskAssignmentUpdate(before, input);
      const primaryBefore = before.assigneeId ?? null;
      const primaryAfter = finalAssigneeId;
      const beforeAssigneeIds =
        before.assigneeIds && before.assigneeIds.length > 0
          ? before.assigneeIds
          : before.assigneeId
            ? [before.assigneeId]
            : [];

      if (hasAssigneeMutation && primaryBefore !== finalAssigneeId) {
        taskUpdates.assigneeId = finalAssigneeId;
      }
      const rawDependencies = input.dependencies ?? metadata?.dependencies;
      const taskDependenciesRepo = createTaskDependenciesRepository(context, db);
      const validatedDependencies =
        rawDependencies !== undefined
          ? await taskDependenciesRepo.validateTaskDependenciesInput(before.id, rawDependencies)
          : undefined;
      const dependencySerials =
        validatedDependencies !== undefined ? validatedDependencies.map((d) => d.blockingTaskSerial) : undefined;

      const reminderInputs = metadata?.reminders === undefined ? undefined : normalizeReminders(metadata.reminders);
      const normalizedMetadata =
        metadata || rawDependencies !== undefined
          ? {
              ...(metadata ?? {}),
              ...(dependencySerials === undefined ? {} : { dependencies: [...dependencySerials].sort() }),
              ...(reminderInputs === undefined
                ? {}
                : {
                    reminders: reminderInputs.map(({ remindAt, ...reminder }) => ({
                      ...reminder,
                      time: remindAt.toISOString(),
                    })),
                  }),
            }
          : undefined;
      let customFields: Record<string, unknown> | undefined = undefined;
      if (taskUpdates.customFields !== undefined) {
        customFields = await resolveCustomFields(before.projectId, taskUpdates.customFields, {
          existingCustomFields: before.customFields,
        });
      }
      if (normalizedMetadata) {
        customFields = {
          ...(customFields ?? before.customFields ?? {}),
          ...normalizedMetadata,
        };
      }

      function canonicalizeCustomFieldsForCompare(cf?: Record<string, unknown> | null) {
        if (!cf) return "{}";
        const copy = { ...cf };
        if (Array.isArray(copy.dependencies)) {
          copy.dependencies = [...copy.dependencies].sort();
        }
        return JSON.stringify(copy);
      }

      const hasOtherScalarChanges =
        (taskUpdates.title !== undefined && taskUpdates.title !== before.title) ||
        (taskUpdates.description !== undefined && taskUpdates.description !== before.description) ||
        (taskUpdates.parentId !== undefined && taskUpdates.parentId !== (before.parentId ?? null)) ||
        (taskUpdates.sectionId !== undefined && taskUpdates.sectionId !== (before.sectionId ?? null)) ||
        (taskUpdates.reporterId !== undefined && taskUpdates.reporterId !== (before.reporterId ?? null)) ||
        (taskUpdates.order !== undefined && taskUpdates.order !== before.order) ||
        (taskUpdates.tags !== undefined && JSON.stringify(taskUpdates.tags) !== JSON.stringify(before.tags ?? [])) ||
        (taskUpdates.estimatedHours !== undefined && taskUpdates.estimatedHours !== before.estimatedHours) ||
        (taskUpdates.loggedHours !== undefined && taskUpdates.loggedHours !== before.loggedHours) ||
        (taskUpdates.timezone !== undefined && taskUpdates.timezone !== before.timezone) ||
        (taskUpdates.storyPoints !== undefined && taskUpdates.storyPoints !== (before.storyPoints ?? null)) ||
        (taskUpdates.delayReason !== undefined && taskUpdates.delayReason !== (before.delayReason ?? null)) ||
        (customFields !== undefined &&
          canonicalizeCustomFieldsForCompare(customFields) !== canonicalizeCustomFieldsForCompare(before.customFields));

      const followerIdsChanged =
        followerIds !== undefined &&
        JSON.stringify([...followerIds].sort()) !== JSON.stringify([...(before.followerIds ?? [])].sort());

      const beforeSerials = (before.dependencies ?? []).slice().sort();
      const desiredSerials = dependencySerials !== undefined ? [...dependencySerials].sort() : undefined;
      const dependenciesChanged =
        desiredSerials !== undefined && JSON.stringify(desiredSerials) !== JSON.stringify(beforeSerials);

      const remindersChanged = reminderInputs !== undefined;

      const hasAnyChange =
        assigneeChanged ||
        hasStateChange ||
        hasOtherScalarChanges ||
        followerIdsChanged ||
        dependenciesChanged ||
        remindersChanged;

      if (!hasAnyChange) {
        return { before, task: before };
      }

      let task: TaskRecord | undefined;
      try {
        task = await db.transaction(async (transaction) => {
          if (hasAssigneeMutation && assigneeChanged) {
            // A. If Primary changes, demote current active Primary only BEFORE update(tasks)
            // (preventing the tasks table trigger from closing the old primary when retained as contributor)
            if (primaryBefore && primaryBefore !== finalAssigneeId) {
              await transaction
                .update(taskAssignees)
                .set({ isPrimary: false })
                .where(
                  and(
                    eq(taskAssignees.organizationId, organizationId),
                    eq(taskAssignees.workspaceId, workspaceId),
                    eq(taskAssignees.taskId, taskId),
                    eq(taskAssignees.isPrimary, true),
                    isNull(taskAssignees.unassignedAt),
                  ),
                );
            }
          }

          const [updated] = await transaction
            .update(tasks)
            .set({
              ...taskUpdates,
              ...(customFields === undefined ? {} : { customFields }),
              version: expectedVersion! + 1,
              updatedAt: new Date(),
            })
            .where(and(eq(tasks.id, taskId), tenantScope, isNull(tasks.deletedAt), eq(tasks.version, expectedVersion!)))
            .returning();

          if (!updated) {
            throw new TenantConflictError("Task was modified by another request; reload it and retry");
          }
          if (hasAssigneeMutation && assigneeChanged) {
            const now = new Date();

            // B. Mark removed assignees as unassignedAt = now, isPrimary = false
            if (removedAssigneeIds.length > 0) {
              await transaction
                .update(taskAssignees)
                .set({ unassignedAt: now, isPrimary: false })
                .where(
                  and(
                    eq(taskAssignees.organizationId, organizationId),
                    eq(taskAssignees.workspaceId, workspaceId),
                    eq(taskAssignees.taskId, taskId),
                    isNull(taskAssignees.unassignedAt),
                    inArray(taskAssignees.userId, removedAssigneeIds),
                  ),
                );
            }

            // C. Insert every addedAssigneeId (including brand new Lead if added)
            if (addedAssigneeIds.length > 0) {
              await transaction
                .insert(taskAssignees)
                .values(
                  addedAssigneeIds.map((userId) => ({
                    organizationId,
                    workspaceId,
                    projectId: before.projectId,
                    taskId,
                    userId,
                    isPrimary: userId === finalAssigneeId,
                    assignedBy: actorId ?? null,
                  })),
                )
                .onConflictDoUpdate({
                  target: [taskAssignees.taskId, taskAssignees.userId],
                  targetWhere: isNull(taskAssignees.unassignedAt),
                  set: {
                    isPrimary: sql`excluded.is_primary`,
                  },
                });
            }

            // D & E & F. Ensure active row primary status is strictly consistent
            if (finalAssigneeId !== null) {
              await transaction
                .update(taskAssignees)
                .set({
                  isPrimary: sql`${taskAssignees.userId} = ${finalAssigneeId}`,
                })
                .where(
                  and(
                    eq(taskAssignees.organizationId, organizationId),
                    eq(taskAssignees.workspaceId, workspaceId),
                    eq(taskAssignees.taskId, taskId),
                    isNull(taskAssignees.unassignedAt),
                  ),
                );
            } else {
              await transaction
                .update(taskAssignees)
                .set({ isPrimary: false })
                .where(
                  and(
                    eq(taskAssignees.organizationId, organizationId),
                    eq(taskAssignees.workspaceId, workspaceId),
                    eq(taskAssignees.taskId, taskId),
                    isNull(taskAssignees.unassignedAt),
                  ),
                );
            }
          }
          const followersRepo = createTaskFollowersRepository(context, transaction);
          if (followerIds !== undefined) {
            const desiredWatcherIds = [...new Set([...followerIds, ...addedAssigneeIds])];
            await followersRepo.replaceWatchersDelta(taskId, desiredWatcherIds);
          } else {
            if (addedAssigneeIds.length > 0) {
              await followersRepo.ensureWatchers(taskId, addedAssigneeIds);
            }
            const shouldNeutralizeTriggerAutoWatch =
              primaryBefore !== finalAssigneeId &&
              finalAssigneeId !== null &&
              beforeAssigneeIds.includes(finalAssigneeId) &&
              !(before.followerIds ?? []).includes(finalAssigneeId);

            if (shouldNeutralizeTriggerAutoWatch && finalAssigneeId !== null) {
              await followersRepo.unwatch(taskId, finalAssigneeId);
            }
          }
          if (validatedDependencies !== undefined) {
            const txDependenciesRepo = createTaskDependenciesRepository(context, transaction);
            await txDependenciesRepo.replaceTaskDependencies(taskId, validatedDependencies, actorId);
          }
          if (reminderInputs !== undefined) {
            const now = new Date();
            await transaction
              .update(taskReminders)
              .set({ deletedAt: now, updatedAt: now })
              .where(
                and(
                  eq(taskReminders.organizationId, organizationId),
                  eq(taskReminders.workspaceId, workspaceId),
                  eq(taskReminders.taskId, taskId),
                  isNull(taskReminders.deletedAt),
                ),
              );
            if (reminderInputs.length) {
              await transaction.insert(taskReminders).values(
                reminderInputs.map((reminder) => ({
                  organizationId,
                  workspaceId,
                  projectId: before.projectId,
                  taskId,
                  externalId: reminder.id,
                  remindAt: reminder.remindAt,
                  label: reminder.label,
                  status: reminder.sent ? ("sent" as const) : ("scheduled" as const),
                  sentAt: reminder.sent ? reminder.remindAt : null,
                  createdBy: actorId ?? null,
                })),
              );
            }
          }
          if (recurrence !== undefined) {
            const now = new Date();
            await transaction
              .update(taskRecurrenceRules)
              .set({ deletedAt: now, updatedAt: now })
              .where(
                and(
                  eq(taskRecurrenceRules.organizationId, organizationId),
                  eq(taskRecurrenceRules.workspaceId, workspaceId),
                  eq(taskRecurrenceRules.taskId, taskId),
                  isNull(taskRecurrenceRules.deletedAt),
                ),
              );
            if (recurrence) {
              await transaction.insert(taskRecurrenceRules).values({
                organizationId,
                workspaceId,
                projectId: before.projectId,
                taskId,
                createdBy: actorId ?? null,
                ...recurrence,
              });
            }
          }
          if (automationDepth <= maxSubtaskDepth) {
            const events = [];
            if (before.status !== updated.status) {
              events.push(automationEventValues(updated, "task_status_changed", before));
            }
            if (before.priority !== updated.priority) {
              events.push(automationEventValues(updated, "task_priority_changed", before));
            }
            if (assigneeChanged) {
              events.push(
                automationEventValues(updated, "task_assignee_changed", before, {
                  assigneeId: finalAssigneeId,
                  assigneeIds: finalAssigneeIds,
                  previousAssigneeId: primaryBefore,
                  previousAssigneeIds: beforeAssigneeIds,
                  addedAssigneeIds,
                  removedAssigneeIds,
                }),
              );
            }
            if (events.length) {
              await transaction.insert(automationEvents).values(events);
            }
          }

          if (updated.sprintId) {
            const { deriveSprintTaskAnalyticsEvents, appendSprintAnalyticsEvents } =
              await import("./sprint-analytics.js");
            const analyticsEvents = deriveSprintTaskAnalyticsEvents(before, updated);
            if (analyticsEvents.length > 0) {
              const [sprint] = await transaction
                .select({ status: sprints.status })
                .from(sprints)
                .where(and(eq(sprints.id, updated.sprintId), eq(sprints.organizationId, organizationId)));
              if (sprint?.status === "active") {
                await appendSprintAnalyticsEvents(
                  { db: transaction, organizationId, workspaceId },
                  analyticsEvents.map((e) => ({
                    ...e,
                    projectId: updated.projectId,
                    sprintId: updated.sprintId!,
                    taskId: updated.id,
                    actorId: actorId ?? undefined,
                  })),
                );
              }
            }
          }

          return updated;
        });
      } catch (error) {
        const causeMessage = (error as { cause?: { message?: string } })?.cause?.message;
        if (causeMessage === "Task dependency would create a cycle" || causeMessage?.startsWith("Task recurrence")) {
          throw new TenantConflictError(causeMessage);
        }
        throw error;
      }

      if (!task) {
        throw new TenantConflictError("Task was modified by another request; reload it and retry");
      }
      return { before, task: await getById(task.id) };
    },

    async softDelete(taskId: string) {
      const before = await getById(taskId);
      const now = new Date();
      const task = await db.transaction(async (transaction) => {
        const [updated] = await transaction
          .update(tasks)
          .set({ deletedAt: now, updatedAt: now, sprintId: null })
          .where(and(eq(tasks.id, taskId), tenantScope, isNull(tasks.deletedAt)))
          .returning();

        if (!updated) return undefined;

        await transaction
          .update(tasks)
          .set({ deletedAt: now, updatedAt: now, sprintId: null })
          .where(and(eq(tasks.parentId, taskId), tenantScope, isNull(tasks.deletedAt)));

        if (before.sprintId) {
          await transaction
            .update(taskSprintAssignments)
            .set({ removedAt: now })
            .where(
              and(
                eq(taskSprintAssignments.organizationId, organizationId),
                eq(taskSprintAssignments.workspaceId, workspaceId),
                eq(taskSprintAssignments.taskId, taskId),
                eq(taskSprintAssignments.sprintId, before.sprintId),
                isNull(taskSprintAssignments.removedAt),
              ),
            );

          const [sprint] = await transaction
            .select({ status: sprints.status })
            .from(sprints)
            .where(and(eq(sprints.id, before.sprintId), eq(sprints.organizationId, organizationId)));

          if (sprint?.status === "active") {
            const { appendSprintAnalyticsEvent } = await import("./sprint-analytics.js");
            await appendSprintAnalyticsEvent(
              { db: transaction, organizationId, workspaceId },
              {
                projectId: before.projectId,
                sprintId: before.sprintId,
                taskId,
                actorId: actorId ?? undefined,
                eventType: "task_removed",
                storyPointsAtEvent: before.storyPoints,
                isCompletedAtEvent: before.status === "done", // Using the literal since the helper is in sprint-analytics
                occurredAt: now,
              },
            );
          }
        }

        return updated;
      });

      if (!task) {
        throw new TenantResourceNotFoundError("task");
      }
      return before;
    },

    async createAssignmentNotifications(task: TaskRecord, userIds: string[], notifyActorId?: string | null) {
      if (!userIds.length) return;
      const notificationsRepo = createNotificationsRepository(context);
      for (const userId of userIds) {
        if (notifyActorId && userId === notifyActorId) continue;
        await notificationsRepo.create({
          userId,
          type: "task_assigned",
          title: `تم تعيين ${task.serial} لك`,
          body: task.title,
          entityType: "task",
          entityId: task.id,
          deduplicationKey: `task/${task.id}/assigned/${userId}/v${task.version}`,
        });
      }
    },

    async createAssignmentNotification(task: TaskRecord) {
      if (!task.assigneeId) return;
      await this.createAssignmentNotifications(task, [task.assigneeId], actorId);
    },
  };
}
