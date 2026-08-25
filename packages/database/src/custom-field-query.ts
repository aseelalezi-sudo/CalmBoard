import { sql, type SQL } from "drizzle-orm";
import { TenantConflictError } from "./errors.js";
import type { CustomFieldOption, CustomFieldRecord } from "./repositories/custom-fields.js";
import {
  normalizeCustomFieldType,
  validateCustomFieldKey,
  type SupportedCustomFieldType,
} from "./custom-field-contract.js";

export const CUSTOM_FIELD_OPERATORS = [
  "equals",
  "not_equals",
  "contains",
  "starts_with",
  "ends_with",
  "greater_than",
  "greater_than_or_equal",
  "less_than",
  "less_than_or_equal",
  "before",
  "after",
  "on_or_before",
  "on_or_after",
  "is_empty",
  "is_not_empty",
] as const;

export type CustomFieldOperator = (typeof CUSTOM_FIELD_OPERATORS)[number];

export const OPERATORS_BY_TYPE: Record<SupportedCustomFieldType, readonly CustomFieldOperator[]> = {
  short_text: ["equals", "not_equals", "contains", "starts_with", "ends_with", "is_empty", "is_not_empty"],
  url: ["equals", "not_equals", "contains", "starts_with", "ends_with", "is_empty", "is_not_empty"],
  number: [
    "equals",
    "not_equals",
    "greater_than",
    "greater_than_or_equal",
    "less_than",
    "less_than_or_equal",
    "is_empty",
    "is_not_empty",
  ],
  date: ["equals", "before", "after", "on_or_before", "on_or_after", "is_empty", "is_not_empty"],
  single_select: ["equals", "not_equals", "is_empty", "is_not_empty"],
  checkbox: ["equals", "not_equals", "is_empty", "is_not_empty"],
};

export type CustomFieldFilter = {
  fieldKey: string;
  operator: CustomFieldOperator;
  value?: unknown;
};

export type CustomFieldSort = {
  fieldKey: string;
  direction: "asc" | "desc";
};

const ISO_DATE_ONLY_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_DATETIME_REGEX =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(?:Z|([+-]\d{2}(?::?\d{2})?))$/i;

function parseAndValidateIsoDate(trimmed: string): string | null {
  const dateOnlyMatch = ISO_DATE_ONLY_REGEX.exec(trimmed);
  if (dateOnlyMatch) {
    const year = Number(dateOnlyMatch[1]);
    const month = Number(dateOnlyMatch[2]);
    const day = Number(dateOnlyMatch[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) {
      return null;
    }
    const parsed = new Date(`${dateOnlyMatch[1]}-${dateOnlyMatch[2]}-${dateOnlyMatch[3]}T00:00:00.000Z`);
    if (
      Number.isNaN(parsed.getTime()) ||
      parsed.getUTCFullYear() !== year ||
      parsed.getUTCMonth() + 1 !== month ||
      parsed.getUTCDate() !== day
    ) {
      return null;
    }
    return parsed.toISOString();
  }

  const datetimeMatch = ISO_DATETIME_REGEX.exec(trimmed);
  if (datetimeMatch) {
    const year = Number(datetimeMatch[1]);
    const month = Number(datetimeMatch[2]);
    const day = Number(datetimeMatch[3]);
    const hours = Number(datetimeMatch[4]);
    const minutes = Number(datetimeMatch[5]);
    const seconds = datetimeMatch[6] !== undefined ? Number(datetimeMatch[6]) : 0;
    if (
      month < 1 ||
      month > 12 ||
      day < 1 ||
      day > 31 ||
      hours < 0 ||
      hours > 23 ||
      minutes < 0 ||
      minutes > 59 ||
      seconds < 0 ||
      seconds > 59
    ) {
      return null;
    }
    const calTest = new Date(`${datetimeMatch[1]}-${datetimeMatch[2]}-${datetimeMatch[3]}T00:00:00.000Z`);
    if (
      Number.isNaN(calTest.getTime()) ||
      calTest.getUTCFullYear() !== year ||
      calTest.getUTCMonth() + 1 !== month ||
      calTest.getUTCDate() !== day
    ) {
      return null;
    }
    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) {
      return null;
    }
    return parsed.toISOString();
  }

  return null;
}

export function validateAndNormalizeCustomFieldOperator(
  rawOperator: unknown,
  fieldType: SupportedCustomFieldType,
  fieldKey: string,
): CustomFieldOperator {
  if (typeof rawOperator !== "string") {
    throw new TenantConflictError(`Operator for custom field '${fieldKey}' must be a string`);
  }
  const normalized = rawOperator.trim().toLowerCase() as CustomFieldOperator;
  const allowed = OPERATORS_BY_TYPE[fieldType];
  if (!allowed || !allowed.includes(normalized)) {
    throw new TenantConflictError(
      `Operator '${rawOperator}' is not supported for custom field '${fieldKey}' of type '${fieldType}'`,
    );
  }
  return normalized;
}

export function validateAndNormalizeCustomFilterValue(
  def: CustomFieldRecord,
  operator: CustomFieldOperator,
  value: unknown,
): unknown {
  const type = normalizeCustomFieldType(def.type);

  if (operator === "is_empty" || operator === "is_not_empty") {
    return undefined;
  }

  if (value === undefined || value === null) {
    throw new TenantConflictError(`Value is required for operator '${operator}' on custom field '${def.key}'`);
  }

  switch (type) {
    case "short_text":
    case "url": {
      if (typeof value !== "string") {
        throw new TenantConflictError(`Query value for custom field '${def.key}' must be a string`);
      }
      const trimmed = value.trim();
      if (!trimmed && (operator === "equals" || operator === "not_equals")) {
        return "";
      }
      if (!trimmed) {
        throw new TenantConflictError(`Query value for custom field '${def.key}' cannot be empty`);
      }
      if (trimmed.length > 10_000) {
        throw new TenantConflictError(`Query value for custom field '${def.key}' exceeds maximum length`);
      }
      return trimmed;
    }

    case "number": {
      let num: number;
      if (typeof value === "number") {
        num = value;
      } else if (typeof value === "string" && value.trim() !== "") {
        num = Number(value.trim());
      } else {
        throw new TenantConflictError(`Query value for custom field '${def.key}' must be a valid number`);
      }
      if (!Number.isFinite(num)) {
        throw new TenantConflictError(`Query value for custom field '${def.key}' must be a finite number`);
      }
      return num;
    }

    case "date": {
      if (value instanceof Date) {
        if (Number.isNaN(value.getTime())) {
          throw new TenantConflictError(`Query value for custom field '${def.key}' must be a valid date`);
        }
        return value.toISOString();
      }
      if (typeof value === "string") {
        const trimmed = value.trim();
        if (!trimmed) {
          throw new TenantConflictError(`Query value for custom field '${def.key}' cannot be empty`);
        }
        const iso = parseAndValidateIsoDate(trimmed);
        if (!iso) {
          throw new TenantConflictError(`Query value for custom field '${def.key}' must be a valid date`);
        }
        return iso;
      }
      throw new TenantConflictError(`Query value for custom field '${def.key}' must be a valid date`);
    }

    case "single_select": {
      if (typeof value !== "string") {
        throw new TenantConflictError(`Query value for custom field '${def.key}' must be a string`);
      }
      const trimmed = value.trim();
      if (!trimmed) {
        throw new TenantConflictError(`Query value for custom field '${def.key}' cannot be empty`);
      }
      const options = (def.options ?? []) as CustomFieldOption[];
      const matched = options.find((opt) => opt.value === trimmed || opt.label === trimmed);
      if (!matched) {
        throw new TenantConflictError(`Invalid option '${trimmed}' for custom field '${def.key}'`);
      }
      return matched.value;
    }

    case "checkbox": {
      if (typeof value === "boolean") {
        return value;
      }
      if (typeof value === "string") {
        const lower = value.trim().toLowerCase();
        if (lower === "true" || lower === "1") return true;
        if (lower === "false" || lower === "0") return false;
      }
      throw new TenantConflictError(`Query value for custom field '${def.key}' must be a boolean`);
    }
  }
}

export function validateAndNormalizeCustomFieldFilter(
  rawFilter: unknown,
  defsByKey: Map<string, CustomFieldRecord>,
  context: { organizationId: string; workspaceId: string; projectId?: string | null },
): { fieldKey: string; operator: CustomFieldOperator; value?: unknown; definition: CustomFieldRecord } {
  if (!rawFilter || typeof rawFilter !== "object") {
    throw new TenantConflictError("Custom field filter must be an object");
  }
  const f = rawFilter as Partial<CustomFieldFilter>;
  const fieldKey = validateCustomFieldKey(f.fieldKey);
  const def = defsByKey.get(fieldKey);
  if (!def) {
    throw new TenantConflictError(`Unknown custom field '${fieldKey}'`);
  }
  if (def.organizationId !== context.organizationId || def.workspaceId !== context.workspaceId) {
    throw new TenantConflictError(`Custom field '${fieldKey}' belongs to another workspace`);
  }
  if (def.projectId !== null && context.projectId && def.projectId !== context.projectId) {
    throw new TenantConflictError(`Custom field '${fieldKey}' belongs to another project`);
  }
  if (def.deletedAt !== null && def.deletedAt !== undefined) {
    throw new TenantConflictError(`Custom field '${fieldKey}' is deleted`);
  }
  if (def.sensitive === true) {
    throw new TenantConflictError("Querying sensitive custom fields is not supported");
  }

  const type = normalizeCustomFieldType(def.type);
  const operator = validateAndNormalizeCustomFieldOperator(f.operator, type, fieldKey);
  const value = validateAndNormalizeCustomFilterValue(def, operator, f.value);

  return {
    fieldKey,
    operator,
    value,
    definition: def,
  };
}

export function validateAndNormalizeCustomFieldSort(
  rawSort: unknown,
  defsByKey: Map<string, CustomFieldRecord>,
  context: { organizationId: string; workspaceId: string; projectId?: string | null },
): { fieldKey: string; direction: "asc" | "desc"; definition: CustomFieldRecord } {
  if (!rawSort || typeof rawSort !== "object") {
    throw new TenantConflictError("Custom field sort must be an object");
  }
  const s = rawSort as Partial<CustomFieldSort>;
  const fieldKey = validateCustomFieldKey(s.fieldKey);
  const def = defsByKey.get(fieldKey);
  if (!def) {
    throw new TenantConflictError(`Unknown custom field '${fieldKey}'`);
  }
  if (def.organizationId !== context.organizationId || def.workspaceId !== context.workspaceId) {
    throw new TenantConflictError(`Custom field '${fieldKey}' belongs to another workspace`);
  }
  if (def.projectId !== null && context.projectId && def.projectId !== context.projectId) {
    throw new TenantConflictError(`Custom field '${fieldKey}' belongs to another project`);
  }
  if (def.deletedAt !== null && def.deletedAt !== undefined) {
    throw new TenantConflictError(`Custom field '${fieldKey}' is deleted`);
  }
  if (def.sensitive === true) {
    throw new TenantConflictError("Querying sensitive custom fields is not supported");
  }
  const direction = s.direction?.toLowerCase() === "desc" ? "desc" : "asc";
  return { fieldKey, direction, definition: def };
}

export function canonicalizeCustomFieldFilters(filters?: CustomFieldFilter[]): CustomFieldFilter[] | undefined {
  if (!filters || filters.length === 0) return undefined;
  return [...filters].sort((a, b) => {
    const keyComp = a.fieldKey.localeCompare(b.fieldKey);
    if (keyComp !== 0) return keyComp;
    const opComp = a.operator.localeCompare(b.operator);
    if (opComp !== 0) return opComp;
    return JSON.stringify(a.value ?? null).localeCompare(JSON.stringify(b.value ?? null));
  });
}

export function buildCustomFieldSqlCondition(
  filter: { fieldKey: string; operator: CustomFieldOperator; value?: unknown },
  def: CustomFieldRecord,
  customFieldsColumn: SQL | any,
): SQL {
  const type = normalizeCustomFieldType(def.type);
  const key = def.key;
  const op = filter.operator;
  const val = filter.value;

  if (op === "is_empty") {
    return sql`(${customFieldsColumn}->>${key} IS NULL OR ${customFieldsColumn}->>${key} = '')`;
  }
  if (op === "is_not_empty") {
    return sql`(${customFieldsColumn}->>${key} IS NOT NULL AND ${customFieldsColumn}->>${key} <> '')`;
  }

  switch (type) {
    case "short_text":
    case "url": {
      const textVal = String(val);
      switch (op) {
        case "equals":
          return sql`${customFieldsColumn}->>${key} = ${textVal}`;
        case "not_equals":
          return sql`(${customFieldsColumn}->>${key} IS NULL OR ${customFieldsColumn}->>${key} = '' OR ${customFieldsColumn}->>${key} <> ${textVal})`;
        case "contains":
          return sql`${customFieldsColumn}->>${key} ILIKE ${`%${textVal}%`}`;
        case "starts_with":
          return sql`${customFieldsColumn}->>${key} ILIKE ${`${textVal}%`}`;
        case "ends_with":
          return sql`${customFieldsColumn}->>${key} ILIKE ${`%${textVal}`}`;
        default:
          throw new TenantConflictError(`Unsupported operator '${op}' for ${type}`);
      }
    }

    case "number": {
      const numVal = Number(val);
      switch (op) {
        case "equals":
          return sql`(${customFieldsColumn}->>${key})::numeric = ${numVal}`;
        case "not_equals":
          return sql`(${customFieldsColumn}->>${key} IS NULL OR ${customFieldsColumn}->>${key} = '' OR (${customFieldsColumn}->>${key})::numeric <> ${numVal})`;
        case "greater_than":
          return sql`(${customFieldsColumn}->>${key})::numeric > ${numVal}`;
        case "greater_than_or_equal":
          return sql`(${customFieldsColumn}->>${key})::numeric >= ${numVal}`;
        case "less_than":
          return sql`(${customFieldsColumn}->>${key})::numeric < ${numVal}`;
        case "less_than_or_equal":
          return sql`(${customFieldsColumn}->>${key})::numeric <= ${numVal}`;
        default:
          throw new TenantConflictError(`Unsupported operator '${op}' for number`);
      }
    }

    case "date": {
      const dateVal = String(val);
      switch (op) {
        case "equals":
          return sql`(${customFieldsColumn}->>${key})::timestamptz = ${dateVal}::timestamptz`;
        case "not_equals":
          return sql`(${customFieldsColumn}->>${key} IS NULL OR ${customFieldsColumn}->>${key} = '' OR (${customFieldsColumn}->>${key})::timestamptz <> ${dateVal}::timestamptz)`;
        case "before":
          return sql`(${customFieldsColumn}->>${key})::timestamptz < ${dateVal}::timestamptz`;
        case "after":
          return sql`(${customFieldsColumn}->>${key})::timestamptz > ${dateVal}::timestamptz`;
        case "on_or_before":
          return sql`(${customFieldsColumn}->>${key})::timestamptz <= ${dateVal}::timestamptz`;
        case "on_or_after":
          return sql`(${customFieldsColumn}->>${key})::timestamptz >= ${dateVal}::timestamptz`;
        default:
          throw new TenantConflictError(`Unsupported operator '${op}' for date`);
      }
    }

    case "single_select": {
      const selectVal = String(val);
      switch (op) {
        case "equals":
          return sql`${customFieldsColumn}->>${key} = ${selectVal}`;
        case "not_equals":
          return sql`(${customFieldsColumn}->>${key} IS NULL OR ${customFieldsColumn}->>${key} = '' OR ${customFieldsColumn}->>${key} <> ${selectVal})`;
        default:
          throw new TenantConflictError(`Unsupported operator '${op}' for single_select`);
      }
    }

    case "checkbox": {
      const boolVal = Boolean(val);
      switch (op) {
        case "equals":
          return sql`(${customFieldsColumn}->>${key})::boolean = ${boolVal}`;
        case "not_equals":
          return sql`(${customFieldsColumn}->>${key} IS NULL OR (${customFieldsColumn}->>${key})::boolean <> ${boolVal})`;
        default:
          throw new TenantConflictError(`Unsupported operator '${op}' for checkbox`);
      }
    }
  }
}

export function buildCustomFieldSqlSortColumn(def: CustomFieldRecord, customFieldsColumn: SQL | any): SQL {
  const type = normalizeCustomFieldType(def.type);
  const key = def.key;

  switch (type) {
    case "number":
      return sql`(${customFieldsColumn}->>${key})::numeric`;
    case "date":
      return sql`(${customFieldsColumn}->>${key})::timestamptz`;
    case "checkbox":
      return sql`(${customFieldsColumn}->>${key})::boolean`;
    case "short_text":
    case "url":
    case "single_select":
    default:
      return sql`${customFieldsColumn}->>${key}`;
  }
}

export function evaluateTaskCustomFieldFilter(
  customFields: Record<string, unknown> | null | undefined,
  filter: CustomFieldFilter,
  def: CustomFieldRecord,
): boolean {
  const type = normalizeCustomFieldType(def.type);
  const raw = customFields ? customFields[def.key] : undefined;
  const op = filter.operator;

  const isMissingOrEmpty = raw === undefined || raw === null || (typeof raw === "string" && raw.trim() === "");

  if (op === "is_empty") {
    return isMissingOrEmpty;
  }
  if (op === "is_not_empty") {
    return !isMissingOrEmpty;
  }

  if (isMissingOrEmpty) {
    if (op === "not_equals") return true;
    return false;
  }

  switch (type) {
    case "short_text":
    case "url": {
      const strVal = String(raw);
      const target = String(filter.value);
      switch (op) {
        case "equals":
          return strVal === target;
        case "not_equals":
          return strVal !== target;
        case "contains":
          return strVal.toLowerCase().includes(target.toLowerCase());
        case "starts_with":
          return strVal.toLowerCase().startsWith(target.toLowerCase());
        case "ends_with":
          return strVal.toLowerCase().endsWith(target.toLowerCase());
        default:
          return false;
      }
    }

    case "number": {
      const numVal = Number(raw);
      const target = Number(filter.value);
      if (!Number.isFinite(numVal) || !Number.isFinite(target)) return false;
      switch (op) {
        case "equals":
          return numVal === target;
        case "not_equals":
          return numVal !== target;
        case "greater_than":
          return numVal > target;
        case "greater_than_or_equal":
          return numVal >= target;
        case "less_than":
          return numVal < target;
        case "less_than_or_equal":
          return numVal <= target;
        default:
          return false;
      }
    }

    case "date": {
      const dateVal = new Date(String(raw)).getTime();
      const target = new Date(String(filter.value)).getTime();
      if (Number.isNaN(dateVal) || Number.isNaN(target)) return false;
      switch (op) {
        case "equals":
          return dateVal === target;
        case "before":
          return dateVal < target;
        case "after":
          return dateVal > target;
        case "on_or_before":
          return dateVal <= target;
        case "on_or_after":
          return dateVal >= target;
        default:
          return false;
      }
    }

    case "single_select": {
      const selVal = String(raw);
      const target = String(filter.value);
      switch (op) {
        case "equals":
          return selVal === target;
        case "not_equals":
          return selVal !== target;
        default:
          return false;
      }
    }

    case "checkbox": {
      const boolVal = Boolean(raw);
      const target = Boolean(filter.value);
      switch (op) {
        case "equals":
          return boolVal === target;
        case "not_equals":
          return boolVal !== target;
        default:
          return false;
      }
    }
  }
}
