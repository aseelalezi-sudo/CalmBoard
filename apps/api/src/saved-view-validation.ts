import { BadRequestException } from "@nestjs/common";
import type {
  CreateSavedViewInput,
  SavedViewConfiguration,
  SavedViewFilters,
  SavedViewType,
  UpdateSavedViewInput,
} from "@calmboard/database";
import { isJsonObject, requiredString, type JsonObject } from "./request-validation.js";

const viewTypes = new Set<SavedViewType>(["board", "list", "table", "calendar", "timeline", "workload"]);
const filterKeys = new Set<keyof SavedViewFilters>(["search", "status", "priority", "assignee"]);
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

export function parseSavedViewFilters(value: unknown): SavedViewFilters {
  if (!isJsonObject(value)) throw new BadRequestException("filters must be an object");
  const filters: SavedViewFilters = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!filterKeys.has(key as keyof SavedViewFilters)) throw new BadRequestException(`filters.${key} is unsupported`);
    if (entry === undefined || entry === null || entry === "") continue;
    const parsed = requiredString(entry, `filters.${key}`);
    if (parsed.length > 200) throw new BadRequestException(`filters.${key} is too long`);
    if (key === "status" && !taskStatuses.has(parsed)) throw new BadRequestException("filters.status is invalid");
    if (key === "priority" && !taskPriorities.has(parsed)) throw new BadRequestException("filters.priority is invalid");
    filters[key as keyof SavedViewFilters] = parsed;
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

function parseBooleanMap(value: unknown, field: string) {
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

export function parseSavedViewConfiguration(value: unknown, viewType: SavedViewType): SavedViewConfiguration {
  if (!isJsonObject(value)) throw new BadRequestException("configuration must be an object");
  const allowedRoot = new Set(["schemaVersion", "table"]);
  for (const key of Object.keys(value)) {
    if (!allowedRoot.has(key)) throw new BadRequestException(`configuration.${key} is unsupported`);
  }
  if (value.schemaVersion !== 1) throw new BadRequestException("configuration.schemaVersion must be 1");
  const configuration: SavedViewConfiguration = { schemaVersion: 1 };
  if (value.table !== undefined) {
    if (viewType !== "table" || !isJsonObject(value.table)) {
      throw new BadRequestException("configuration.table is only valid for table views");
    }
    const allowedTable = new Set(["sorting", "columnVisibility", "columnOrder", "columnPinning", "columnSizing"]);
    for (const key of Object.keys(value.table)) {
      if (!allowedTable.has(key)) throw new BadRequestException(`configuration.table.${key} is unsupported`);
    }
    const table: NonNullable<SavedViewConfiguration["table"]> = {};
    if (value.table.sorting !== undefined) {
      if (!Array.isArray(value.table.sorting) || value.table.sorting.length > 3) {
        throw new BadRequestException("configuration.table.sorting is invalid");
      }
      table.sorting = value.table.sorting.map((entry, index) => {
        if (!isJsonObject(entry) || !tableColumnIds.has(entry.id as string) || typeof entry.desc !== "boolean") {
          throw new BadRequestException(`configuration.table.sorting[${index}] is invalid`);
        }
        return { id: entry.id as string, desc: entry.desc };
      });
    }
    if (value.table.columnVisibility !== undefined) {
      table.columnVisibility = parseBooleanMap(value.table.columnVisibility, "configuration.table.columnVisibility");
    }
    if (value.table.columnOrder !== undefined) {
      table.columnOrder = parseColumnIds(value.table.columnOrder, "configuration.table.columnOrder");
    }
    if (value.table.columnPinning !== undefined) {
      if (!isJsonObject(value.table.columnPinning)) {
        throw new BadRequestException("configuration.table.columnPinning must be an object");
      }
      table.columnPinning = {
        left:
          value.table.columnPinning.left === undefined
            ? []
            : parseColumnIds(value.table.columnPinning.left, "configuration.table.columnPinning.left"),
        right:
          value.table.columnPinning.right === undefined
            ? []
            : parseColumnIds(value.table.columnPinning.right, "configuration.table.columnPinning.right"),
      };
    }
    if (value.table.columnSizing !== undefined) table.columnSizing = parseSizing(value.table.columnSizing);
    configuration.table = table;
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
    configuration: parseSavedViewConfiguration(body.configuration ?? { schemaVersion: 1 }, viewType),
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
