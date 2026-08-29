import { BadRequestException } from "@nestjs/common";
import {
  canonicalizeCustomFieldFilters,
  canonicalizeAdvancedFilterAst,
  validateAndNormalizeAdvancedFilterAst,
  CUSTOM_FIELD_OPERATORS,
  type AdvancedFilterNode,
  type CreateSavedViewInput,
  type CustomFieldFilter,
  type CustomFieldOperator,
  type SavedViewBoardConfiguration,
  type SavedViewCalendarConfiguration,
  type SavedViewConfiguration,
  type SavedViewFilters,
  type SavedViewListConfiguration,
  type SavedViewTableConfiguration,
  type SavedViewTimelineConfiguration,
  type SavedViewType,
  type UpdateSavedViewInput,
} from "@calmboard/database";
import { isJsonObject, requiredString, type JsonObject } from "./request-validation.js";

const viewTypes = new Set<SavedViewType>(["board", "list", "table", "calendar", "timeline", "workload"]);
const filterKeys = new Set<string>([
  "search",
  "status",
  "priority",
  "assignee",
  "assigneeId",
  "customFields",
  "advancedFilter",
]);
const customFieldOpsSet = new Set<string>(CUSTOM_FIELD_OPERATORS);
const taskStatuses = new Set(["backlog", "todo", "in_progress", "review", "done", "canceled"]);
const taskPriorities = new Set(["low", "medium", "high", "urgent"]);
const tableColumnIds = new Set([
  "select",
  "title",
  "status",
  "priority",
  "assignee",
  "points",
  "estimate",
  "logged",
  "due",
]);

const allowedCustomGroupColors = new Set(["indigo", "emerald", "amber", "rose", "violet", "cyan", "slate"]);

function parseName(value: unknown) {
  const name = requiredString(value, "name");
  if (name.length > 255) throw new BadRequestException("name is too long");
  return name;
}

function parseViewType(value: unknown): SavedViewType {
  const viewType = requiredString(value, "viewType") as SavedViewType;
  if (!viewTypes.has(viewType)) throw new BadRequestException("viewType is invalid");
  return viewType;
}

export function parseCustomFieldFiltersArray(value: unknown): CustomFieldFilter[] {
  if (!Array.isArray(value)) {
    throw new BadRequestException("filters.customFields must be an array");
  }
  if (value.length > 50) {
    throw new BadRequestException("filters.customFields exceeds maximum limit of 50 filters");
  }
  return value.map((entry, index) => {
    if (!isJsonObject(entry)) {
      throw new BadRequestException(`filters.customFields[${index}] must be an object`);
    }
    const fieldKey = requiredString(entry.fieldKey, `filters.customFields[${index}].fieldKey`);
    const operator = requiredString(entry.operator, `filters.customFields[${index}].operator`) as CustomFieldOperator;
    if (!customFieldOpsSet.has(operator)) {
      throw new BadRequestException(`filters.customFields[${index}].operator is invalid`);
    }
    let parsedVal = entry.value;
    if (operator === "is_empty" || operator === "is_not_empty") {
      parsedVal = undefined;
    } else if (typeof parsedVal === "string") {
      if (
        operator === "greater_than" ||
        operator === "greater_than_or_equal" ||
        operator === "less_than" ||
        operator === "less_than_or_equal"
      ) {
        const trimmed = parsedVal.trim();
        if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
          const num = Number(trimmed);
          if (Number.isFinite(num)) parsedVal = num;
        }
      }
    }
    return {
      fieldKey,
      operator,
      value: parsedVal,
    };
  });
}

export function parseSavedViewFilters(value: unknown): SavedViewFilters {
  if (!isJsonObject(value)) throw new BadRequestException("filters must be an object");
  const filters: SavedViewFilters = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!filterKeys.has(key)) throw new BadRequestException(`filters.${key} is unsupported`);
    if (entry === undefined || entry === null || entry === "") continue;
    if (key === "customFields") {
      filters.customFields = canonicalizeCustomFieldFilters(parseCustomFieldFiltersArray(entry));
      continue;
    }
    if (key === "advancedFilter") {
      try {
        const normalized = validateAndNormalizeAdvancedFilterAst(entry);
        filters.advancedFilter = canonicalizeAdvancedFilterAst(normalized);
      } catch (err: any) {
        throw new BadRequestException(err?.message ?? "filters.advancedFilter is invalid");
      }
      continue;
    }
    const parsed = requiredString(entry, `filters.${key}`);
    if (parsed.length > 200) throw new BadRequestException(`filters.${key} is too long`);
    if (key === "status" && !taskStatuses.has(parsed)) throw new BadRequestException("filters.status is invalid");
    if (key === "priority" && !taskPriorities.has(parsed)) throw new BadRequestException("filters.priority is invalid");
    if (key === "assignee" || key === "assigneeId") {
      filters.assigneeId = parsed;
      filters.assignee = parsed;
    } else {
      filters[key as "search" | "status" | "priority"] = parsed;
    }
  }
  return filters;
}

function parseColumnIds(value: unknown, field: string) {
  if (!Array.isArray(value) || value.length > tableColumnIds.size) {
    throw new BadRequestException(`${field} must be a bounded column array`);
  }
  const result = value.map((entry, index) => {
    const id = requiredString(entry, `${field}[${index}]`);
    if (!tableColumnIds.has(id)) throw new BadRequestException(`${field}[${index}] is invalid`);
    return id;
  });
  if (new Set(result).size !== result.length) throw new BadRequestException(`${field} contains duplicates`);
  return result;
}

function parseBooleanMap(value: unknown, field: string, maxEntries = 50) {
  if (!isJsonObject(value)) throw new BadRequestException(`${field} must be an object`);
  const entries = Object.entries(value);
  if (entries.length > maxEntries) throw new BadRequestException(`${field} exceeds maximum entries`);
  const result: Record<string, boolean> = {};
  for (const [id, entry] of entries) {
    if (typeof entry !== "boolean") throw new BadRequestException(`${field}.${id} must be a boolean`);
    result[id] = entry;
  }
  return result;
}

function parseTableColumnBooleanMap(value: unknown, field: string) {
  if (!isJsonObject(value)) throw new BadRequestException(`${field} must be an object`);
  const result: Record<string, boolean> = {};
  for (const [id, entry] of Object.entries(value)) {
    if (!tableColumnIds.has(id) || typeof entry !== "boolean")
      throw new BadRequestException(`${field}.${id} is invalid`);
    result[id] = entry;
  }
  return result;
}

function parseSizing(value: unknown) {
  if (!isJsonObject(value)) throw new BadRequestException("configuration.table.columnSizing must be an object");
  const result: Record<string, number> = {};
  for (const [id, entry] of Object.entries(value)) {
    if (!tableColumnIds.has(id) || typeof entry !== "number" || !Number.isFinite(entry) || entry < 40 || entry > 1000) {
      throw new BadRequestException(`configuration.table.columnSizing.${id} is invalid`);
    }
    result[id] = Math.round(entry);
  }
  return result;
}

function parseSorting(value: unknown, field: string) {
  if (!Array.isArray(value) || value.length > 3) {
    throw new BadRequestException(`${field} must be an array of at most 3 sort items`);
  }
  return value.map((entry, index) => {
    if (!isJsonObject(entry) || !tableColumnIds.has(entry.id as string) || typeof entry.desc !== "boolean") {
      throw new BadRequestException(`${field}[${index}] is invalid`);
    }
    return { id: entry.id as string, desc: entry.desc };
  });
}

function parseCustomGroups(value: unknown) {
  if (!Array.isArray(value) || value.length > 50) {
    throw new BadRequestException("configuration.table.customGroups must be an array of at most 50 groups");
  }
  return value.map((entry, index) => {
    if (!isJsonObject(entry)) throw new BadRequestException(`configuration.table.customGroups[${index}] is invalid`);
    const id = requiredString(entry.id, `configuration.table.customGroups[${index}].id`);
    const name = requiredString(entry.name, `configuration.table.customGroups[${index}].name`);
    const color = requiredString(entry.color, `configuration.table.customGroups[${index}].color`);
    if (name.length > 100) {
      throw new BadRequestException(`configuration.table.customGroups[${index}].name is too long`);
    }
    if (!allowedCustomGroupColors.has(color)) {
      throw new BadRequestException(`configuration.table.customGroups[${index}].color is invalid`);
    }
    if (!Array.isArray(entry.taskIds) || entry.taskIds.length > 200) {
      throw new BadRequestException(`configuration.table.customGroups[${index}].taskIds must be a bounded array`);
    }
    const taskIds = entry.taskIds.map((taskId, tIndex) =>
      requiredString(taskId, `configuration.table.customGroups[${index}].taskIds[${tIndex}]`),
    );
    return { id, name, color, taskIds };
  });
}

function parseTableConfiguration(value: unknown): SavedViewTableConfiguration {
  if (!isJsonObject(value)) throw new BadRequestException("configuration.table must be an object");
  const allowed = new Set([
    "sorting",
    "columnVisibility",
    "columnOrder",
    "columnPinning",
    "columnSizing",
    "groupBy",
    "collapsedGroups",
    "customGroups",
  ]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new BadRequestException(`configuration.table.${key} is unsupported`);
  }
  const table: SavedViewTableConfiguration = {};
  if (value.sorting !== undefined) table.sorting = parseSorting(value.sorting, "configuration.table.sorting");
  if (value.columnVisibility !== undefined) {
    table.columnVisibility = parseTableColumnBooleanMap(value.columnVisibility, "configuration.table.columnVisibility");
  }
  if (value.columnOrder !== undefined) {
    table.columnOrder = parseColumnIds(value.columnOrder, "configuration.table.columnOrder");
  }
  if (value.columnPinning !== undefined) {
    if (!isJsonObject(value.columnPinning)) {
      throw new BadRequestException("configuration.table.columnPinning must be an object");
    }
    table.columnPinning = {
      left:
        value.columnPinning.left === undefined
          ? []
          : parseColumnIds(value.columnPinning.left, "configuration.table.columnPinning.left"),
      right:
        value.columnPinning.right === undefined
          ? []
          : parseColumnIds(value.columnPinning.right, "configuration.table.columnPinning.right"),
    };
  }
  if (value.columnSizing !== undefined) table.columnSizing = parseSizing(value.columnSizing);
  if (value.groupBy !== undefined) {
    const groupBy = requiredString(value.groupBy, "configuration.table.groupBy");
    if (!["none", "status", "priority", "custom"].includes(groupBy)) {
      throw new BadRequestException("configuration.table.groupBy is invalid");
    }
    table.groupBy = groupBy as "none" | "status" | "priority" | "custom";
  }
  if (value.collapsedGroups !== undefined) {
    table.collapsedGroups = parseBooleanMap(value.collapsedGroups, "configuration.table.collapsedGroups");
  }
  if (value.customGroups !== undefined) {
    table.customGroups = parseCustomGroups(value.customGroups);
  }
  return table;
}

function parseBoardConfiguration(value: unknown): SavedViewBoardConfiguration {
  if (!isJsonObject(value)) throw new BadRequestException("configuration.board must be an object");
  const allowed = new Set(["groupBy", "collapsedColumns"]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new BadRequestException(`configuration.board.${key} is unsupported`);
  }
  const board: SavedViewBoardConfiguration = {};
  if (value.groupBy !== undefined) {
    const groupBy = requiredString(value.groupBy, "configuration.board.groupBy");
    if (!["status", "priority", "assignee"].includes(groupBy)) {
      throw new BadRequestException("configuration.board.groupBy is invalid");
    }
    board.groupBy = groupBy as "status" | "priority" | "assignee";
  }
  if (value.collapsedColumns !== undefined) {
    board.collapsedColumns = parseBooleanMap(value.collapsedColumns, "configuration.board.collapsedColumns");
  }
  return board;
}

function parseCalendarConfiguration(value: unknown): SavedViewCalendarConfiguration {
  if (!isJsonObject(value)) throw new BadRequestException("configuration.calendar must be an object");
  const allowed = new Set(["mode"]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new BadRequestException(`configuration.calendar.${key} is unsupported`);
  }
  const calendar: SavedViewCalendarConfiguration = {};
  if (value.mode !== undefined) {
    const mode = requiredString(value.mode, "configuration.calendar.mode");
    if (!["month", "week", "day"].includes(mode)) {
      throw new BadRequestException("configuration.calendar.mode is invalid");
    }
    calendar.mode = mode as "month" | "week" | "day";
  }
  return calendar;
}

function parseTimelineConfiguration(value: unknown): SavedViewTimelineConfiguration {
  if (!isJsonObject(value)) throw new BadRequestException("configuration.timeline must be an object");
  const allowed = new Set(["zoom", "showCritical"]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new BadRequestException(`configuration.timeline.${key} is unsupported`);
  }
  const timeline: SavedViewTimelineConfiguration = {};
  if (value.zoom !== undefined) {
    const zoom = requiredString(value.zoom, "configuration.timeline.zoom");
    if (!["days", "weeks", "months"].includes(zoom)) {
      throw new BadRequestException("configuration.timeline.zoom is invalid");
    }
    timeline.zoom = zoom as "days" | "weeks" | "months";
  }
  if (value.showCritical !== undefined) {
    if (typeof value.showCritical !== "boolean") {
      throw new BadRequestException("configuration.timeline.showCritical must be a boolean");
    }
    timeline.showCritical = value.showCritical;
  }
  return timeline;
}

function parseListConfiguration(value: unknown): SavedViewListConfiguration {
  if (!isJsonObject(value)) throw new BadRequestException("configuration.list must be an object");
  const allowed = new Set(["sorting", "groupBy"]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new BadRequestException(`configuration.list.${key} is unsupported`);
  }
  const list: SavedViewListConfiguration = {};
  if (value.sorting !== undefined) list.sorting = parseSorting(value.sorting, "configuration.list.sorting");
  if (value.groupBy !== undefined) {
    const groupBy = requiredString(value.groupBy, "configuration.list.groupBy");
    if (!["none", "status", "priority"].includes(groupBy)) {
      throw new BadRequestException("configuration.list.groupBy is invalid");
    }
    list.groupBy = groupBy as "none" | "status" | "priority";
  }
  return list;
}

export function parseSavedViewConfiguration(value: unknown, viewType: SavedViewType): SavedViewConfiguration {
  if (!isJsonObject(value)) throw new BadRequestException("configuration must be an object");
  const allowedRoot = new Set(["schemaVersion", "table", "board", "calendar", "timeline", "list"]);
  for (const key of Object.keys(value)) {
    if (!allowedRoot.has(key)) throw new BadRequestException(`configuration.${key} is unsupported`);
  }
  if (value.schemaVersion !== 1 && value.schemaVersion !== 2) {
    throw new BadRequestException("configuration.schemaVersion must be 1 or 2");
  }

  const configuration: SavedViewConfiguration = { schemaVersion: 2 };

  if (value.table !== undefined) {
    if (viewType !== "table" && value.schemaVersion === 2) {
      throw new BadRequestException("configuration.table is only valid for table views");
    }
    if (viewType === "table") {
      configuration.table = parseTableConfiguration(value.table);
    }
  }
  if (value.board !== undefined) {
    if (viewType !== "board") throw new BadRequestException("configuration.board is only valid for board views");
    configuration.board = parseBoardConfiguration(value.board);
  }
  if (value.calendar !== undefined) {
    if (viewType !== "calendar")
      throw new BadRequestException("configuration.calendar is only valid for calendar views");
    configuration.calendar = parseCalendarConfiguration(value.calendar);
  }
  if (value.timeline !== undefined) {
    if (viewType !== "timeline")
      throw new BadRequestException("configuration.timeline is only valid for timeline views");
    configuration.timeline = parseTimelineConfiguration(value.timeline);
  }
  if (value.list !== undefined) {
    if (viewType !== "list") throw new BadRequestException("configuration.list is only valid for list views");
    configuration.list = parseListConfiguration(value.list);
  }

  return configuration;
}

export function parseCreateSavedViewInput(body: JsonObject): CreateSavedViewInput {
  const viewType = parseViewType(body.viewType);
  return {
    projectId: requiredString(body.projectId, "projectId"),
    name: parseName(body.name),
    viewType,
    filters: parseSavedViewFilters(body.filters ?? {}),
    configuration: parseSavedViewConfiguration(body.configuration ?? { schemaVersion: 2 }, viewType),
    isShared: body.isShared === true,
    isDefault: body.isDefault === true,
  };
}

export function parseUpdateSavedViewInput(body: JsonObject, currentViewType: SavedViewType): UpdateSavedViewInput {
  const input: UpdateSavedViewInput = {};
  if (body.name !== undefined) input.name = parseName(body.name);
  if (body.filters !== undefined) input.filters = parseSavedViewFilters(body.filters);
  if (body.configuration !== undefined) {
    input.configuration = parseSavedViewConfiguration(body.configuration, currentViewType);
  }
  if (body.isShared !== undefined) {
    if (typeof body.isShared !== "boolean") throw new BadRequestException("isShared must be boolean");
    input.isShared = body.isShared;
  }
  if (body.isDefault !== undefined) {
    if (typeof body.isDefault !== "boolean") throw new BadRequestException("isDefault must be boolean");
    input.isDefault = body.isDefault;
  }
  if (!Object.keys(input).length) throw new BadRequestException("saved view update is empty");
  return input;
}
