import { sql, type SQL } from "drizzle-orm";
import { TenantConflictError } from "./errors.js";
import type { CustomFieldOption, CustomFieldRecord } from "./repositories/custom-fields.js";
import {
  normalizeCustomFieldType,
  parseAndValidateIsoDate,
  validateCustomFieldKey,
  type SupportedCustomFieldType,
} from "./custom-field-contract.js";

export { parseAndValidateIsoDate };

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
      if (typeof value === "number" && Number.isFinite(value)) {
        return value;
      }
      if (typeof value === "string") {
        const trimmed = value.trim();
        if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
          const num = Number(trimmed);
          if (Number.isFinite(num)) return num;
        }
      }
      throw new TenantConflictError(`Query value for custom field '${def.key}' must be a finite number`);
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
        const trimmed = value.trim().toLowerCase();
        if (trimmed === "true") return true;
        if (trimmed === "false") return false;
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

  const operator = validateAndNormalizeCustomFieldOperator(f.operator, normalizeCustomFieldType(def.type), fieldKey);
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
  const rawDirection = typeof s.direction === "string" ? s.direction.trim().toLowerCase() : "";
  if (rawDirection !== "asc" && rawDirection !== "desc") {
    throw new TenantConflictError("Custom field sort direction must be 'asc' or 'desc'");
  }
  return { fieldKey, direction: rawDirection as "asc" | "desc", definition: def };
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

export function buildCustomFieldSafeNumberSql(customFieldsColumn: SQL | any, key: string): SQL {
  return sql`(CASE WHEN ${customFieldsColumn}->>${key} ~ '^-?[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?$' THEN (${customFieldsColumn}->>${key})::numeric ELSE NULL END)`;
}

export const SAFE_DATE_SQL_REGEX =
  "^(?:[0-9]{4}-(?:(?:0[1-9]|1[0-2])-(?:0[1-9]|1[0-9]|2[0-8])|(?:0[13578]|1[02])-(?:29|30|31)|(?:0[469]|11)-(?:29|30))|(?:[0-9]{2}(?:[02468][48]|[2468]0|[13579][26])|(?:0[48]|[2468][048]|[13579][26])00)-02-29)(?:[Tt](?:[01][0-9]|2[0-3]):[0-5][0-9](?::[0-5][0-9](?:\\.[0-9]{1,9})?)?(?:[Zz]|[+-](?:0[0-9]|1[0-4])(?::?[0-5][0-9])?))?$";

export function buildCustomFieldSafeDateSql(customFieldsColumn: SQL | any, key: string): SQL {
  return sql`(CASE WHEN ${customFieldsColumn}->>${key} ~ ${SAFE_DATE_SQL_REGEX} THEN (${customFieldsColumn}->>${key})::timestamptz ELSE NULL END)`;
}

export function buildCustomFieldSafeBooleanSql(customFieldsColumn: SQL | any, key: string): SQL {
  return sql`(CASE WHEN lower(${customFieldsColumn}->>${key}) IN ('true', 't', '1') THEN true WHEN lower(${customFieldsColumn}->>${key}) IN ('false', 'f', '0') THEN false ELSE NULL END)`;
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
      const numCol = buildCustomFieldSafeNumberSql(customFieldsColumn, key);
      switch (op) {
        case "equals":
          return sql`${numCol} = ${numVal}`;
        case "not_equals":
          return sql`(${numCol} IS NULL OR ${numCol} <> ${numVal})`;
        case "greater_than":
          return sql`${numCol} > ${numVal}`;
        case "greater_than_or_equal":
          return sql`${numCol} >= ${numVal}`;
        case "less_than":
          return sql`${numCol} < ${numVal}`;
        case "less_than_or_equal":
          return sql`${numCol} <= ${numVal}`;
        default:
          throw new TenantConflictError(`Unsupported operator '${op}' for number`);
      }
    }

    case "date": {
      const dateVal = String(val);
      const dateCol = buildCustomFieldSafeDateSql(customFieldsColumn, key);
      switch (op) {
        case "equals":
          return sql`${dateCol} = ${dateVal}::timestamptz`;
        case "not_equals":
          return sql`(${dateCol} IS NULL OR ${dateCol} <> ${dateVal}::timestamptz)`;
        case "before":
          return sql`${dateCol} < ${dateVal}::timestamptz`;
        case "after":
          return sql`${dateCol} > ${dateVal}::timestamptz`;
        case "on_or_before":
          return sql`${dateCol} <= ${dateVal}::timestamptz`;
        case "on_or_after":
          return sql`${dateCol} >= ${dateVal}::timestamptz`;
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
      const boolCol = buildCustomFieldSafeBooleanSql(customFieldsColumn, key);
      switch (op) {
        case "equals":
          return sql`${boolCol} = ${boolVal}`;
        case "not_equals":
          return sql`(${boolCol} IS NULL OR ${boolCol} <> ${boolVal})`;
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
      return buildCustomFieldSafeNumberSql(customFieldsColumn, key);
    case "date":
      return buildCustomFieldSafeDateSql(customFieldsColumn, key);
    case "checkbox":
      return buildCustomFieldSafeBooleanSql(customFieldsColumn, key);
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
  const key = def.key;
  const op = filter.operator;
  const target = filter.value;

  const raw = customFields?.[key];

  if (op === "is_empty") {
    if (raw === undefined || raw === null) return true;
    if (typeof raw === "string" && raw.trim() === "") return true;
    return false;
  }
  if (op === "is_not_empty") {
    if (raw === undefined || raw === null) return false;
    if (typeof raw === "string" && raw.trim() === "") return false;
    return true;
  }

  switch (type) {
    case "short_text":
    case "url": {
      const strVal = raw !== undefined && raw !== null ? String(raw) : "";
      const tgtStr = target !== undefined && target !== null ? String(target) : "";
      switch (op) {
        case "equals":
          return strVal === tgtStr;
        case "not_equals":
          return strVal === "" || strVal !== tgtStr;
        case "contains":
          return strVal.toLowerCase().includes(tgtStr.toLowerCase());
        case "starts_with":
          return strVal.toLowerCase().startsWith(tgtStr.toLowerCase());
        case "ends_with":
          return strVal.toLowerCase().endsWith(tgtStr.toLowerCase());
        default:
          return false;
      }
    }

    case "number": {
      let numVal: number;
      if (typeof raw === "number") {
        numVal = raw;
      } else if (typeof raw === "string" && /^-?[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?$/.test(raw.trim())) {
        numVal = Number(raw.trim());
      } else {
        numVal = NaN;
      }
      const tgtNum = Number(target);
      if (!Number.isFinite(numVal) || !Number.isFinite(tgtNum)) {
        return op === "not_equals";
      }
      switch (op) {
        case "equals":
          return numVal === tgtNum;
        case "not_equals":
          return numVal !== tgtNum;
        case "greater_than":
          return numVal > tgtNum;
        case "greater_than_or_equal":
          return numVal >= tgtNum;
        case "less_than":
          return numVal < tgtNum;
        case "less_than_or_equal":
          return numVal <= tgtNum;
        default:
          return false;
      }
    }

    case "date": {
      let dateVal: number = NaN;
      if (raw instanceof Date) {
        if (!Number.isNaN(raw.getTime())) {
          dateVal = raw.getTime();
        }
      } else if (typeof raw === "string" && raw.trim() !== "") {
        const iso = parseAndValidateIsoDate(raw.trim());
        if (iso) {
          dateVal = new Date(iso).getTime();
        }
      }
      const tgtIso = typeof target === "string" ? parseAndValidateIsoDate(target.trim()) : null;
      const tgtDate = tgtIso
        ? new Date(tgtIso).getTime()
        : target instanceof Date && !Number.isNaN(target.getTime())
          ? target.getTime()
          : NaN;
      if (Number.isNaN(dateVal) || Number.isNaN(tgtDate)) {
        return op === "not_equals";
      }
      switch (op) {
        case "equals":
          return dateVal === tgtDate;
        case "not_equals":
          return dateVal !== tgtDate;
        case "before":
          return dateVal < tgtDate;
        case "after":
          return dateVal > tgtDate;
        case "on_or_before":
          return dateVal <= tgtDate;
        case "on_or_after":
          return dateVal >= tgtDate;
        default:
          return false;
      }
    }

    case "single_select": {
      const selVal = raw !== undefined && raw !== null ? String(raw) : "";
      const tgtSel = target !== undefined && target !== null ? String(target) : "";
      switch (op) {
        case "equals":
          return selVal === tgtSel;
        case "not_equals":
          return selVal === "" || selVal !== tgtSel;
        default:
          return false;
      }
    }

    case "checkbox": {
      let boolVal: boolean | null = null;
      if (typeof raw === "boolean") {
        boolVal = raw;
      } else if (typeof raw === "string") {
        const lower = raw.trim().toLowerCase();
        if (lower === "true" || lower === "t" || lower === "1") boolVal = true;
        else if (lower === "false" || lower === "f" || lower === "0") boolVal = false;
      }
      const tgtBool = Boolean(target);
      if (boolVal === null) {
        return op === "not_equals";
      }
      switch (op) {
        case "equals":
          return boolVal === tgtBool;
        case "not_equals":
          return boolVal !== tgtBool;
        default:
          return false;
      }
    }
  }
}
