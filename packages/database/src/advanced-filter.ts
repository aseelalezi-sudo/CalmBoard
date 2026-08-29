import {
  and,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  notInArray,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { TenantConflictError } from "./errors.js";
import { tasks, taskAssignees } from "./schema.js";
import {
  parseAndValidateIsoDate,
  validateCustomFieldKey,
  normalizeCustomFieldType,
  type SupportedCustomFieldType,
} from "./custom-field-contract.js";
import {
  buildCustomFieldSqlCondition,
  evaluateTaskCustomFieldFilter,
  validateAndNormalizeCustomFieldFilter,
  validateAndNormalizeCustomFilterValue,
  OPERATORS_BY_TYPE,
  type CustomFieldOperator,
} from "./custom-field-query.js";
import type { CustomFieldRecord } from "./repositories/custom-fields.js";
import { VALID_TASK_STATUSES, VALID_TASK_PRIORITIES } from "./repositories/task-states.js";

export const MAX_AST_DEPTH = 10;
export const MAX_AST_NODES = 100;
export const MAX_AST_PREDICATES = 100;

export const COMMON_TASK_FIELDS = [
  "title",
  "description",
  "timezone",
  "status",
  "priority",
  "assigneeId",
  "reporterId",
  "projectId",
  "sectionId",
  "parentId",
  "tags",
  "progress",
  "estimatedHours",
  "loggedHours",
  "storyPoints",
  "isMilestone",
  "isRecurring",
  "startDate",
  "dueDate",
  "createdAt",
  "updatedAt",
  "search",
] as const;

export type CommonTaskField = (typeof COMMON_TASK_FIELDS)[number];
export type CanonicalFilterField = CommonTaskField | "customField";

export const COMMON_FIELD_OPERATORS = [
  "equals",
  "not_equals",
  "contains",
  "not_contains",
  "starts_with",
  "ends_with",
  "in",
  "not_in",
  "greater_than",
  "greater_than_or_equal",
  "less_than",
  "less_than_or_equal",
  "between",
  "before",
  "after",
  "on_or_before",
  "on_or_after",
  "contains_any",
  "contains_all",
  "is_empty",
  "is_not_empty",
] as const;

export type CanonicalFilterOperator = (typeof COMMON_FIELD_OPERATORS)[number];

export type FieldDataType = "text" | "enum" | "id" | "tags" | "number" | "boolean" | "date" | "search";

export const FIELD_DATA_TYPES: Record<CommonTaskField, FieldDataType> = {
  title: "text",
  description: "text",
  timezone: "text",
  status: "enum",
  priority: "enum",
  assigneeId: "id",
  reporterId: "id",
  projectId: "id",
  sectionId: "id",
  parentId: "id",
  tags: "tags",
  progress: "number",
  estimatedHours: "number",
  loggedHours: "number",
  storyPoints: "number",
  isMilestone: "boolean",
  isRecurring: "boolean",
  startDate: "date",
  dueDate: "date",
  createdAt: "date",
  updatedAt: "date",
  search: "search",
};

export const OPERATORS_BY_FIELD_DATA_TYPE: Record<FieldDataType, readonly CanonicalFilterOperator[]> = {
  text: ["equals", "not_equals", "contains", "starts_with", "ends_with", "is_empty", "is_not_empty"],
  enum: ["equals", "not_equals", "in", "not_in", "is_empty", "is_not_empty"],
  id: ["equals", "not_equals", "in", "not_in", "is_empty", "is_not_empty"],
  tags: ["contains", "not_contains", "contains_any", "contains_all", "is_empty", "is_not_empty"],
  number: [
    "equals",
    "not_equals",
    "greater_than",
    "greater_than_or_equal",
    "less_than",
    "less_than_or_equal",
    "between",
    "is_empty",
    "is_not_empty",
  ],
  boolean: ["equals"],
  date: ["equals", "before", "after", "on_or_before", "on_or_after", "between", "is_empty", "is_not_empty"],
  search: ["contains"],
};

export type AdvancedFilterPredicate = {
  kind: "predicate";
  field: CanonicalFilterField;
  customFieldKey?: string;
  operator: CanonicalFilterOperator | CustomFieldOperator;
  value?: unknown;
};

export type AdvancedFilterGroup = {
  kind: "group";
  operator: "and" | "or";
  children: AdvancedFilterNode[];
};

export type AdvancedFilterNode = AdvancedFilterPredicate | AdvancedFilterGroup;

export type AdvancedFilterValidationContext = {
  organizationId?: string;
  workspaceId?: string;
  projectId?: string | null;
};

const FIELD_ALIASES: Record<string, CommonTaskField> = {
  assignee: "assigneeId",
  assigneeid: "assigneeId",
  reporter: "reporterId",
  reporterid: "reporterId",
  project: "projectId",
  projectid: "projectId",
  section: "sectionId",
  sectionid: "sectionId",
  parent: "parentId",
  parentid: "parentId",
  milestone: "isMilestone",
  ismilestone: "isMilestone",
  recurring: "isRecurring",
  isrecurring: "isRecurring",
  startdate: "startDate",
  duedate: "dueDate",
  createdat: "createdAt",
  updatedat: "updatedAt",
  estimatedhours: "estimatedHours",
  loggedhours: "loggedHours",
  storypoints: "storyPoints",
};

const TASK_STATUSES = VALID_TASK_STATUSES as ReadonlySet<string>;
const TASK_PRIORITIES = VALID_TASK_PRIORITIES as ReadonlySet<string>;

function escapeLike(str: string): string {
  return str.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

export function extractCustomFieldKeysFromAst(ast?: unknown): string[] {
  if (!ast || typeof ast !== "object") return [];
  const keys = new Set<string>();

  function traverse(node: unknown) {
    if (!node || typeof node !== "object") return;
    const n = node as Record<string, unknown>;
    if (n.kind === "predicate") {
      if (typeof n.customFieldKey === "string" && n.customFieldKey.trim()) {
        keys.add(n.customFieldKey.trim());
      } else if (n.field === "customField" && typeof n.customFieldKey === "string" && n.customFieldKey.trim()) {
        keys.add(n.customFieldKey.trim());
      } else if (typeof n.field === "string" && n.field.startsWith("customField:")) {
        keys.add(n.field.slice("customField:".length).trim());
      }
    } else if (n.kind === "group" && Array.isArray(n.children)) {
      for (const child of n.children) {
        traverse(child);
      }
    }
  }

  traverse(ast);
  return [...keys];
}

export function validateAndNormalizeAdvancedFilterAst(
  raw: unknown,
  defsByKey: Map<string, CustomFieldRecord> = new Map(),
  context: AdvancedFilterValidationContext = {},
): AdvancedFilterNode {
  let nodeCount = 0;
  let predicateCount = 0;
  const seenObjects = new WeakSet<object>();

  function validateNode(node: unknown, depth: number): AdvancedFilterNode {
    if (depth > MAX_AST_DEPTH) {
      throw new TenantConflictError(`Advanced filter exceeds maximum nesting depth of ${MAX_AST_DEPTH}`);
    }
    if (!node || typeof node !== "object" || Array.isArray(node)) {
      throw new TenantConflictError("Advanced filter node must be an object");
    }

    if (seenObjects.has(node)) {
      throw new TenantConflictError("Cyclic references are not permitted in advanced filter AST");
    }
    seenObjects.add(node);

    nodeCount++;
    if (nodeCount > MAX_AST_NODES) {
      throw new TenantConflictError(`Advanced filter exceeds maximum total node count of ${MAX_AST_NODES}`);
    }

    const n = node as Record<string, unknown>;
    const kind = n.kind;
    if (kind !== "predicate" && kind !== "group") {
      throw new TenantConflictError(`Invalid filter node kind: '${String(kind)}'`);
    }

    if (kind === "group") {
      const rawOp = typeof n.operator === "string" ? n.operator.trim().toLowerCase() : "";
      if (rawOp !== "and" && rawOp !== "or") {
        throw new TenantConflictError(`Invalid filter group operator: '${String(n.operator)}'`);
      }
      if (!Array.isArray(n.children)) {
        throw new TenantConflictError("Filter group children must be an array");
      }
      const children = n.children.map((child) => validateNode(child, depth + 1));
      return {
        kind: "group",
        operator: rawOp,
        children,
      };
    }

    // Predicate node
    predicateCount++;
    if (predicateCount > MAX_AST_PREDICATES) {
      throw new TenantConflictError(`Advanced filter exceeds maximum predicate count of ${MAX_AST_PREDICATES}`);
    }

    let fieldKey = typeof n.field === "string" ? n.field.trim() : "";
    let customFieldKey = typeof n.customFieldKey === "string" ? n.customFieldKey.trim() : undefined;

    if (fieldKey.startsWith("customField:")) {
      customFieldKey = fieldKey.slice("customField:".length).trim();
      fieldKey = "customField";
    }

    if (customFieldKey || fieldKey === "customField") {
      if (!customFieldKey) {
        throw new TenantConflictError("Custom field predicate requires a valid customFieldKey");
      }
      const validKey = validateCustomFieldKey(customFieldKey);
      const def = defsByKey.get(validKey);
      if (!def) {
        throw new TenantConflictError(`Unknown custom field '${validKey}'`);
      }
      if (def.projectId !== null && context.projectId && def.projectId !== context.projectId) {
        throw new TenantConflictError(`Custom field '${validKey}' belongs to another project`);
      }
      if (def.sensitive === true) {
        throw new TenantConflictError("Querying sensitive custom fields is not supported");
      }

      const validatedCf = validateAndNormalizeCustomFieldFilter(
        {
          fieldKey: validKey,
          operator: n.operator as any,
          value: n.value,
        },
        defsByKey,
        {
          organizationId: context.organizationId ?? def.organizationId,
          workspaceId: context.workspaceId ?? def.workspaceId,
          projectId: context.projectId ?? undefined,
        },
      );

      return {
        kind: "predicate",
        field: "customField",
        customFieldKey: validKey,
        operator: validatedCf.operator,
        ...(validatedCf.value !== undefined ? { value: validatedCf.value } : {}),
      };
    }

    // Common task field
    const canonicalField = FIELD_ALIASES[fieldKey.toLowerCase()] ?? (fieldKey as CommonTaskField);
    if (!COMMON_TASK_FIELDS.includes(canonicalField)) {
      throw new TenantConflictError(`Unsupported filter field: '${fieldKey}'`);
    }

    const rawOp = typeof n.operator === "string" ? n.operator.trim().toLowerCase() : "";
    const dataType = FIELD_DATA_TYPES[canonicalField];
    const allowedOperators = OPERATORS_BY_FIELD_DATA_TYPE[dataType];

    if (!allowedOperators.includes(rawOp as CanonicalFilterOperator)) {
      throw new TenantConflictError(
        `Operator '${String(n.operator)}' is not supported for field '${canonicalField}' of type '${dataType}'`,
      );
    }

    const operator = rawOp as CanonicalFilterOperator;
    const normalizedValue = normalizeCommonFieldValue(canonicalField, dataType, operator, n.value);

    return {
      kind: "predicate",
      field: canonicalField,
      operator,
      ...(normalizedValue !== undefined ? { value: normalizedValue } : {}),
    };
  }

  return validateNode(raw, 1);
}

function normalizeCommonFieldValue(
  field: CommonTaskField,
  dataType: FieldDataType,
  operator: CanonicalFilterOperator,
  rawValue: unknown,
): unknown {
  if (operator === "is_empty" || operator === "is_not_empty") {
    return undefined;
  }

  switch (dataType) {
    case "text":
    case "search": {
      if (typeof rawValue !== "string" && typeof rawValue !== "number") {
        throw new TenantConflictError(`Field '${field}' requires a string value`);
      }
      return String(rawValue).trim();
    }

    case "enum": {
      const allowedSet = field === "status" ? TASK_STATUSES : TASK_PRIORITIES;
      if (operator === "in" || operator === "not_in") {
        if (!Array.isArray(rawValue) || rawValue.length === 0) {
          throw new TenantConflictError(`Field '${field}' with operator '${operator}' requires a non-empty array`);
        }
        const set = new Set<string>();
        for (const item of rawValue) {
          const val = typeof item === "string" ? item.trim().toLowerCase() : "";
          if (!allowedSet.has(val)) {
            throw new TenantConflictError(`Invalid ${field} value '${String(item)}'`);
          }
          set.add(val);
        }
        return [...set];
      }
      const val = typeof rawValue === "string" ? rawValue.trim().toLowerCase() : "";
      if (!allowedSet.has(val)) {
        throw new TenantConflictError(`Invalid ${field} value '${String(rawValue)}'`);
      }
      return val;
    }

    case "id": {
      if (operator === "in" || operator === "not_in") {
        if (!Array.isArray(rawValue) || rawValue.length === 0) {
          throw new TenantConflictError(`Field '${field}' with operator '${operator}' requires a non-empty array`);
        }
        const set = new Set<string>();
        for (const item of rawValue) {
          if (typeof item !== "string" || !item.trim()) {
            throw new TenantConflictError(`Field '${field}' ID entries must be non-empty strings`);
          }
          set.add(item.trim());
        }
        return [...set];
      }
      if (typeof rawValue !== "string" || !rawValue.trim()) {
        throw new TenantConflictError(`Field '${field}' requires a non-empty string ID`);
      }
      return rawValue.trim();
    }

    case "tags": {
      if (operator === "contains_any" || operator === "contains_all") {
        if (!Array.isArray(rawValue) || rawValue.length === 0) {
          throw new TenantConflictError(`Field '${field}' with operator '${operator}' requires a non-empty array`);
        }
        const set = new Set<string>();
        for (const item of rawValue) {
          if (typeof item !== "string" || !item.trim()) {
            throw new TenantConflictError("Tag entries must be non-empty strings");
          }
          set.add(item.trim());
        }
        return [...set];
      }
      if (typeof rawValue !== "string" || !rawValue.trim()) {
        throw new TenantConflictError(`Field '${field}' requires a string tag value`);
      }
      return rawValue.trim();
    }

    case "number": {
      if (operator === "between") {
        let minVal: unknown;
        let maxVal: unknown;
        if (Array.isArray(rawValue) && rawValue.length === 2) {
          [minVal, maxVal] = rawValue;
        } else if (rawValue && typeof rawValue === "object" && "min" in rawValue && "max" in rawValue) {
          minVal = (rawValue as { min: unknown }).min;
          maxVal = (rawValue as { max: unknown }).max;
        } else {
          throw new TenantConflictError("Range operator 'between' requires { min, max } bounds");
        }
        const minNum = typeof minVal === "number" ? minVal : Number(minVal);
        const maxNum = typeof maxVal === "number" ? maxVal : Number(maxVal);
        if (!Number.isFinite(minNum) || !Number.isFinite(maxNum)) {
          throw new TenantConflictError("Range bounds must be finite numbers");
        }
        if (minNum > maxNum) {
          throw new TenantConflictError("Range min cannot be greater than max");
        }
        return { min: minNum, max: maxNum };
      }
      const num = typeof rawValue === "number" ? rawValue : Number(rawValue);
      if (!Number.isFinite(num)) {
        throw new TenantConflictError(`Field '${field}' requires a finite number`);
      }
      return num;
    }

    case "boolean": {
      if (typeof rawValue === "boolean") return rawValue;
      if (typeof rawValue === "string") {
        const lower = rawValue.trim().toLowerCase();
        if (lower === "true" || lower === "t" || lower === "1") return true;
        if (lower === "false" || lower === "f" || lower === "0") return false;
      }
      throw new TenantConflictError(`Field '${field}' requires a boolean value`);
    }

    case "date": {
      if (operator === "between") {
        let minVal: unknown;
        let maxVal: unknown;
        if (Array.isArray(rawValue) && rawValue.length === 2) {
          [minVal, maxVal] = rawValue;
        } else if (rawValue && typeof rawValue === "object" && "min" in rawValue && "max" in rawValue) {
          minVal = (rawValue as { min: unknown }).min;
          maxVal = (rawValue as { max: unknown }).max;
        } else {
          throw new TenantConflictError("Date range operator 'between' requires { min, max } bounds");
        }
        const minIso =
          typeof minVal === "string"
            ? parseAndValidateIsoDate(minVal.trim())
            : minVal instanceof Date && !Number.isNaN(minVal.getTime())
              ? minVal.toISOString()
              : null;
        const maxIso =
          typeof maxVal === "string"
            ? parseAndValidateIsoDate(maxVal.trim())
            : maxVal instanceof Date && !Number.isNaN(maxVal.getTime())
              ? maxVal.toISOString()
              : null;
        if (!minIso || !maxIso) {
          throw new TenantConflictError("Date range bounds must be valid ISO dates");
        }
        if (new Date(minIso).getTime() > new Date(maxIso).getTime()) {
          throw new TenantConflictError("Date range min cannot be after max");
        }
        return { min: minIso, max: maxIso };
      }
      const iso =
        typeof rawValue === "string"
          ? parseAndValidateIsoDate(rawValue.trim())
          : rawValue instanceof Date && !Number.isNaN(rawValue.getTime())
            ? rawValue.toISOString()
            : null;
      if (!iso) {
        throw new TenantConflictError(`Field '${field}' requires a valid ISO date string`);
      }
      return iso;
    }
  }
}

export function canonicalizeAdvancedFilterAst(ast: AdvancedFilterNode): AdvancedFilterNode {
  if (ast.kind === "predicate") {
    const result: AdvancedFilterPredicate = {
      kind: "predicate",
      field: ast.field,
      operator: ast.operator,
    };
    if (ast.customFieldKey !== undefined) {
      result.customFieldKey = ast.customFieldKey;
    }
    if (ast.value !== undefined) {
      result.value = canonicalizeFilterValue(ast.value);
    }
    return result;
  }

  const canonicalChildren = ast.children.map(canonicalizeAdvancedFilterAst);
  canonicalChildren.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

  return {
    kind: "group",
    operator: ast.operator,
    children: canonicalChildren,
  };
}

function canonicalizeFilterValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.map(canonicalizeFilterValue);
  }
  if (typeof value === "object") {
    const sortedKeys = Object.keys(value as Record<string, unknown>).sort();
    const res: Record<string, unknown> = {};
    for (const k of sortedKeys) {
      const v = (value as Record<string, unknown>)[k];
      if (v !== undefined) {
        res[k] = canonicalizeFilterValue(v);
      }
    }
    return res;
  }
  return value;
}

export function areCanonicalAdvancedFilterAstsEqual(
  a?: AdvancedFilterNode | null,
  b?: AdvancedFilterNode | null,
): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return JSON.stringify(canonicalizeAdvancedFilterAst(a)) === JSON.stringify(canonicalizeAdvancedFilterAst(b));
}

export function buildAdvancedFilterSql(
  ast: AdvancedFilterNode,
  defsByKey: Map<string, CustomFieldRecord> = new Map(),
  context: { organizationId?: string; workspaceId?: string; projectId?: string } = {},
): SQL {
  if (ast.kind === "group") {
    if (ast.operator === "and") {
      if (ast.children.length === 0) return sql`true`;
      if (ast.children.length === 1) return buildAdvancedFilterSql(ast.children[0]!, defsByKey, context);
      return and(...ast.children.map((child) => buildAdvancedFilterSql(child, defsByKey, context)))!;
    }
    if (ast.children.length === 0) return sql`false`;
    if (ast.children.length === 1) return buildAdvancedFilterSql(ast.children[0]!, defsByKey, context);
    return or(...ast.children.map((child) => buildAdvancedFilterSql(child, defsByKey, context)))!;
  }

  const predicate = ast;

  // Predicate SQL compilation
  if (predicate.field === "customField") {
    const def = defsByKey.get(predicate.customFieldKey!);
    if (!def) throw new TenantConflictError(`Unknown custom field '${predicate.customFieldKey}'`);
    return buildCustomFieldSqlCondition(
      {
        fieldKey: predicate.customFieldKey!,
        operator: predicate.operator as CustomFieldOperator,
        value: predicate.value,
      },
      def,
      tasks.customFields,
    );
  }

  const orgId = context.organizationId;
  const wsId = context.workspaceId;

  switch (predicate.field) {
    case "title":
    case "description":
    case "timezone": {
      const col =
        predicate.field === "title"
          ? tasks.title
          : predicate.field === "description"
            ? tasks.description
            : tasks.timezone;
      const val = String(predicate.value ?? "");
      switch (predicate.operator) {
        case "equals":
          return eq(col, val);
        case "not_equals":
          return or(ne(col, val), isNull(col))!;
        case "contains":
          return ilike(col, `%${escapeLike(val)}%`);
        case "starts_with":
          return ilike(col, `${escapeLike(val)}%`);
        case "ends_with":
          return ilike(col, `%${escapeLike(val)}`);
        case "is_empty":
          return or(isNull(col), eq(col, ""))!;
        case "is_not_empty":
          return and(isNotNull(col), ne(col, ""))!;
      }
      break;
    }

    case "status": {
      const val = predicate.value as any;
      const valArray = Array.isArray(predicate.value) ? (predicate.value as any[]) : [];
      switch (predicate.operator) {
        case "equals":
          return eq(tasks.status, val);
        case "not_equals":
          return ne(tasks.status, val);
        case "in":
          return inArray(tasks.status, valArray);
        case "not_in":
          return notInArray(tasks.status, valArray);
        case "is_empty":
          return sql`false`;
        case "is_not_empty":
          return sql`true`;
      }
      break;
    }

    case "priority": {
      const val = predicate.value as any;
      const valArray = Array.isArray(predicate.value) ? (predicate.value as any[]) : [];
      switch (predicate.operator) {
        case "equals":
          return eq(tasks.priority, val);
        case "not_equals":
          return ne(tasks.priority, val);
        case "in":
          return inArray(tasks.priority, valArray);
        case "not_in":
          return notInArray(tasks.priority, valArray);
        case "is_empty":
          return sql`false`;
        case "is_not_empty":
          return sql`true`;
      }
      break;
    }

    case "assigneeId": {
      const val = predicate.value as string;
      const valArray = Array.isArray(predicate.value) ? (predicate.value as string[]) : [];
      const orgFilter = orgId ? sql`and participant.organization_id = ${orgId}` : sql``;
      const wsFilter = wsId ? sql`and participant.workspace_id = ${wsId}` : sql``;

      switch (predicate.operator) {
        case "equals":
          return sql`(
            ${tasks.assigneeId} = ${val}
            or exists (
              select 1 from ${taskAssignees} participant
              where participant.task_id = ${tasks.id}
                ${orgFilter}
                ${wsFilter}
                and participant.user_id = ${val}
                and participant.unassigned_at is null
            )
          )`;
        case "not_equals":
          return sql`(
            (${tasks.assigneeId} is null or ${tasks.assigneeId} <> ${val})
            and not exists (
              select 1 from ${taskAssignees} participant
              where participant.task_id = ${tasks.id}
                ${orgFilter}
                ${wsFilter}
                and participant.user_id = ${val}
                and participant.unassigned_at is null
            )
          )`;
        case "in":
          return sql`(
            ${inArray(tasks.assigneeId, valArray)}
            or exists (
              select 1 from ${taskAssignees} participant
              where participant.task_id = ${tasks.id}
                ${orgFilter}
                ${wsFilter}
                and ${inArray(taskAssignees.userId, valArray)}
                and participant.unassigned_at is null
            )
          )`;
        case "not_in":
          return sql`(
            (${tasks.assigneeId} is null or ${notInArray(tasks.assigneeId, valArray)})
            and not exists (
              select 1 from ${taskAssignees} participant
              where participant.task_id = ${tasks.id}
                ${orgFilter}
                ${wsFilter}
                and ${inArray(taskAssignees.userId, valArray)}
                and participant.unassigned_at is null
            )
          )`;
        case "is_empty":
          return sql`(
            ${tasks.assigneeId} is null
            and not exists (
              select 1 from ${taskAssignees} participant
              where participant.task_id = ${tasks.id}
                ${orgFilter}
                ${wsFilter}
                and participant.unassigned_at is null
            )
          )`;
        case "is_not_empty":
          return sql`(
            ${tasks.assigneeId} is not null
            or exists (
              select 1 from ${taskAssignees} participant
              where participant.task_id = ${tasks.id}
                ${orgFilter}
                ${wsFilter}
                and participant.unassigned_at is null
            )
          )`;
      }
      break;
    }

    case "reporterId":
    case "projectId":
    case "sectionId":
    case "parentId": {
      const col =
        predicate.field === "reporterId"
          ? tasks.reporterId
          : predicate.field === "projectId"
            ? tasks.projectId
            : predicate.field === "sectionId"
              ? tasks.sectionId
              : tasks.parentId;
      const val = predicate.value as string;
      const valArray = Array.isArray(predicate.value) ? (predicate.value as string[]) : [];
      switch (predicate.operator) {
        case "equals":
          return eq(col, val);
        case "not_equals":
          return or(ne(col, val), isNull(col))!;
        case "in":
          return inArray(col, valArray);
        case "not_in":
          return or(notInArray(col, valArray), isNull(col))!;
        case "is_empty":
          return isNull(col);
        case "is_not_empty":
          return isNotNull(col);
      }
      break;
    }

    case "tags": {
      const val = predicate.value as string;
      const valArray = Array.isArray(predicate.value) ? (predicate.value as string[]) : [];
      switch (predicate.operator) {
        case "contains":
          return sql`${tasks.tags} @> ${JSON.stringify([val])}::jsonb`;
        case "not_contains":
          return sql`not (${tasks.tags} @> ${JSON.stringify([val])}::jsonb)`;
        case "contains_all":
          return sql`${tasks.tags} @> ${JSON.stringify(valArray)}::jsonb`;
        case "contains_any":
          return or(...valArray.map((t) => sql`${tasks.tags} @> ${JSON.stringify([t])}::jsonb`))!;
        case "is_empty":
          return or(isNull(tasks.tags), eq(tasks.tags, sql`'[]'::jsonb`), eq(tasks.tags, sql`'null'::jsonb`))!;
        case "is_not_empty":
          return and(isNotNull(tasks.tags), ne(tasks.tags, sql`'[]'::jsonb`), ne(tasks.tags, sql`'null'::jsonb`))!;
      }
      break;
    }

    case "progress":
    case "estimatedHours":
    case "loggedHours":
    case "storyPoints": {
      const col =
        predicate.field === "progress"
          ? tasks.progress
          : predicate.field === "estimatedHours"
            ? tasks.estimatedHours
            : predicate.field === "loggedHours"
              ? tasks.loggedHours
              : tasks.storyPoints;
      const num = typeof predicate.value === "number" ? predicate.value : Number(predicate.value);
      switch (predicate.operator) {
        case "equals":
          return eq(col, num);
        case "not_equals":
          return or(ne(col, num), isNull(col))!;
        case "greater_than":
          return gt(col, num);
        case "greater_than_or_equal":
          return gte(col, num);
        case "less_than":
          return lt(col, num);
        case "less_than_or_equal":
          return lte(col, num);
        case "between": {
          const range = predicate.value as { min: number; max: number };
          return and(gte(col, range.min), lte(col, range.max))!;
        }
        case "is_empty":
          return isNull(col);
        case "is_not_empty":
          return isNotNull(col);
      }
      break;
    }

    case "isMilestone":
    case "isRecurring": {
      const col = predicate.field === "isMilestone" ? tasks.isMilestone : tasks.isRecurring;
      const bool = Boolean(predicate.value);
      return eq(col, bool);
    }

    case "startDate":
    case "dueDate":
    case "createdAt":
    case "updatedAt": {
      const col =
        predicate.field === "startDate"
          ? tasks.startDate
          : predicate.field === "dueDate"
            ? tasks.dueDate
            : predicate.field === "createdAt"
              ? tasks.createdAt
              : tasks.updatedAt;
      const val = predicate.value as string;
      switch (predicate.operator) {
        case "equals":
          return eq(col, sql`${val}::timestamptz`);
        case "before":
          return lt(col, sql`${val}::timestamptz`);
        case "after":
          return gt(col, sql`${val}::timestamptz`);
        case "on_or_before":
          return lte(col, sql`${val}::timestamptz`);
        case "on_or_after":
          return gte(col, sql`${val}::timestamptz`);
        case "between": {
          const range = predicate.value as { min: string; max: string };
          return and(gte(col, sql`${range.min}::timestamptz`), lte(col, sql`${range.max}::timestamptz`))!;
        }
        case "is_empty":
          return isNull(col);
        case "is_not_empty":
          return isNotNull(col);
      }
      break;
    }

    case "search": {
      const val = String(predicate.value ?? "");
      const pattern = `%${escapeLike(val)}%`;
      return or(ilike(tasks.title, pattern), ilike(tasks.serial, pattern), ilike(tasks.description, pattern))!;
    }
  }

  return sql`true`;
}

export function evaluateTaskAdvancedFilter(
  task: Record<string, any>,
  ast: AdvancedFilterNode,
  defsByKey: Map<string, CustomFieldRecord> = new Map(),
): boolean {
  if (ast.kind === "group") {
    if (ast.operator === "and") {
      if (ast.children.length === 0) return true;
      return ast.children.every((child) => evaluateTaskAdvancedFilter(task, child, defsByKey));
    }
    if (ast.children.length === 0) return false;
    return ast.children.some((child) => evaluateTaskAdvancedFilter(task, child, defsByKey));
  }

  const predicate = ast;

  if (predicate.field === "customField") {
    const def = defsByKey.get(predicate.customFieldKey!);
    if (!def) return false;
    const cfValues = task.customFields as Record<string, unknown> | null | undefined;
    return evaluateTaskCustomFieldFilter(
      cfValues ?? {},
      {
        fieldKey: predicate.customFieldKey!,
        operator: predicate.operator as CustomFieldOperator,
        value: predicate.value,
      },
      def,
    );
  }

  const rawVal = task[predicate.field];

  switch (predicate.field) {
    case "title":
    case "description":
    case "timezone": {
      const isNullVal = rawVal === null || rawVal === undefined;
      const str = typeof rawVal === "string" ? rawVal : isNullVal ? "" : String(rawVal);
      const target = String(predicate.value ?? "");
      switch (predicate.operator) {
        case "equals":
          if (isNullVal) return false;
          return str === target;
        case "not_equals":
          if (isNullVal) return true;
          return str !== target;
        case "contains":
          if (isNullVal) return false;
          return str.toLowerCase().includes(target.toLowerCase());
        case "starts_with":
          if (isNullVal) return false;
          return str.toLowerCase().startsWith(target.toLowerCase());
        case "ends_with":
          if (isNullVal) return false;
          return str.toLowerCase().endsWith(target.toLowerCase());
        case "is_empty":
          return isNullVal || str === "";
        case "is_not_empty":
          return !isNullVal && str !== "";
      }
      break;
    }

    case "status":
    case "priority": {
      const str = typeof rawVal === "string" ? rawVal.toLowerCase() : "";
      switch (predicate.operator) {
        case "equals":
          return str === String(predicate.value ?? "").toLowerCase();
        case "not_equals":
          return str !== String(predicate.value ?? "").toLowerCase();
        case "in": {
          const list = Array.isArray(predicate.value) ? predicate.value.map((v) => String(v).toLowerCase()) : [];
          return list.includes(str);
        }
        case "not_in": {
          const list = Array.isArray(predicate.value) ? predicate.value.map((v) => String(v).toLowerCase()) : [];
          return !list.includes(str);
        }
        case "is_empty":
          return false;
        case "is_not_empty":
          return true;
      }
      break;
    }

    case "assigneeId": {
      const primary = task.assigneeId ?? null;
      const allAssignees = new Set<string>();
      if (primary) allAssignees.add(primary);
      if (Array.isArray(task.assigneeIds)) {
        for (const id of task.assigneeIds) allAssignees.add(id);
      }
      if (Array.isArray(task.assignees)) {
        for (const a of task.assignees) {
          if (a?.id) allAssignees.add(a.id);
        }
      }

      switch (predicate.operator) {
        case "equals":
          return allAssignees.has(String(predicate.value ?? ""));
        case "not_equals":
          return !allAssignees.has(String(predicate.value ?? ""));
        case "in": {
          const list = Array.isArray(predicate.value) ? predicate.value.map(String) : [];
          return list.some((id) => allAssignees.has(id));
        }
        case "not_in": {
          const list = Array.isArray(predicate.value) ? predicate.value.map(String) : [];
          return !list.some((id) => allAssignees.has(id));
        }
        case "is_empty":
          return allAssignees.size === 0;
        case "is_not_empty":
          return allAssignees.size > 0;
      }
      break;
    }

    case "reporterId":
    case "projectId":
    case "sectionId":
    case "parentId": {
      const id = typeof rawVal === "string" ? rawVal : null;
      switch (predicate.operator) {
        case "equals":
          return id === String(predicate.value ?? "");
        case "not_equals":
          return id !== String(predicate.value ?? "");
        case "in": {
          const list = Array.isArray(predicate.value) ? predicate.value.map(String) : [];
          return id !== null && list.includes(id);
        }
        case "not_in": {
          const list = Array.isArray(predicate.value) ? predicate.value.map(String) : [];
          return id === null || !list.includes(id);
        }
        case "is_empty":
          return id === null;
        case "is_not_empty":
          return id !== null;
      }
      break;
    }

    case "tags": {
      const tagList = Array.isArray(rawVal) ? rawVal.map((t) => String(t).toLowerCase()) : [];
      switch (predicate.operator) {
        case "contains":
          return tagList.includes(String(predicate.value ?? "").toLowerCase());
        case "not_contains":
          return !tagList.includes(String(predicate.value ?? "").toLowerCase());
        case "contains_all": {
          const req = Array.isArray(predicate.value) ? predicate.value.map((v) => String(v).toLowerCase()) : [];
          return req.every((t) => tagList.includes(t));
        }
        case "contains_any": {
          const req = Array.isArray(predicate.value) ? predicate.value.map((v) => String(v).toLowerCase()) : [];
          return req.some((t) => tagList.includes(t));
        }
        case "is_empty":
          return tagList.length === 0;
        case "is_not_empty":
          return tagList.length > 0;
      }
      break;
    }

    case "progress":
    case "estimatedHours":
    case "loggedHours":
    case "storyPoints": {
      const num = typeof rawVal === "number" && Number.isFinite(rawVal) ? rawVal : null;
      switch (predicate.operator) {
        case "is_empty":
          return num === null;
        case "is_not_empty":
          return num !== null;
      }
      if (num === null) return false;
      const targetNum = typeof predicate.value === "number" ? predicate.value : Number(predicate.value);
      switch (predicate.operator) {
        case "equals":
          return num === targetNum;
        case "not_equals":
          return num !== targetNum;
        case "greater_than":
          return num > targetNum;
        case "greater_than_or_equal":
          return num >= targetNum;
        case "less_than":
          return num < targetNum;
        case "less_than_or_equal":
          return num <= targetNum;
        case "between": {
          const range = predicate.value as { min: number; max: number };
          return num >= range.min && num <= range.max;
        }
      }
      break;
    }

    case "isMilestone":
    case "isRecurring": {
      return Boolean(rawVal) === Boolean(predicate.value);
    }

    case "startDate":
    case "dueDate":
    case "createdAt":
    case "updatedAt": {
      let dateNum: number | null = null;
      if (rawVal instanceof Date && !Number.isNaN(rawVal.getTime())) {
        dateNum = rawVal.getTime();
      } else if (typeof rawVal === "string" && rawVal.trim()) {
        const iso = parseAndValidateIsoDate(rawVal.trim());
        if (iso) dateNum = new Date(iso).getTime();
      }

      switch (predicate.operator) {
        case "is_empty":
          return dateNum === null;
        case "is_not_empty":
          return dateNum !== null;
      }
      if (dateNum === null) return false;

      if (predicate.operator === "between") {
        const range = predicate.value as { min: string; max: string };
        const minT = new Date(range.min).getTime();
        const maxT = new Date(range.max).getTime();
        return dateNum >= minT && dateNum <= maxT;
      }

      const targetT = new Date(String(predicate.value)).getTime();
      switch (predicate.operator) {
        case "equals":
          return dateNum === targetT;
        case "before":
          return dateNum < targetT;
        case "after":
          return dateNum > targetT;
        case "on_or_before":
          return dateNum <= targetT;
        case "on_or_after":
          return dateNum >= targetT;
      }
      break;
    }

    case "search": {
      const q = String(predicate.value ?? "").toLowerCase();
      if (!q) return true;
      const title = String(task.title ?? "").toLowerCase();
      const serial = String(task.serial ?? "").toLowerCase();
      const desc = String(task.description ?? "").toLowerCase();
      return title.includes(q) || serial.includes(q) || desc.includes(q);
    }
  }

  return true;
}

export function convertLegacyFiltersToAdvancedFilterAst(filters: Record<string, any>): AdvancedFilterGroup | null {
  if (!filters || typeof filters !== "object") return null;
  const predicates: AdvancedFilterPredicate[] = [];

  if (filters.status) {
    predicates.push({
      kind: "predicate",
      field: "status",
      operator: "equals",
      value: filters.status,
    });
  }
  if (filters.priority) {
    predicates.push({
      kind: "predicate",
      field: "priority",
      operator: "equals",
      value: filters.priority,
    });
  }
  if (filters.assigneeId || filters.assignee) {
    predicates.push({
      kind: "predicate",
      field: "assigneeId",
      operator: "equals",
      value: filters.assigneeId ?? filters.assignee,
    });
  }
  if (filters.sectionId) {
    predicates.push({
      kind: "predicate",
      field: "sectionId",
      operator: "equals",
      value: filters.sectionId,
    });
  }
  if (filters.parentId) {
    predicates.push({
      kind: "predicate",
      field: "parentId",
      operator: "equals",
      value: filters.parentId,
    });
  }
  if (filters.tag) {
    predicates.push({
      kind: "predicate",
      field: "tags",
      operator: "contains",
      value: filters.tag,
    });
  }
  if (filters.dueFrom) {
    const iso = filters.dueFrom instanceof Date ? filters.dueFrom.toISOString() : String(filters.dueFrom);
    predicates.push({
      kind: "predicate",
      field: "dueDate",
      operator: "on_or_after",
      value: iso,
    });
  }
  if (filters.dueTo) {
    const iso = filters.dueTo instanceof Date ? filters.dueTo.toISOString() : String(filters.dueTo);
    predicates.push({
      kind: "predicate",
      field: "dueDate",
      operator: "on_or_before",
      value: iso,
    });
  }
  if (filters.search) {
    predicates.push({
      kind: "predicate",
      field: "search",
      operator: "contains",
      value: filters.search,
    });
  }

  const rawCustomFields = filters.customFieldFilters ?? filters.customFields;
  if (Array.isArray(rawCustomFields)) {
    for (const f of rawCustomFields) {
      if (f && typeof f.fieldKey === "string" && typeof f.operator === "string") {
        predicates.push({
          kind: "predicate",
          field: "customField",
          customFieldKey: f.fieldKey,
          operator: f.operator,
          ...(f.value !== undefined ? { value: f.value } : {}),
        });
      }
    }
  }

  if (predicates.length === 0) return null;

  return {
    kind: "group",
    operator: "and",
    children: predicates,
  };
}
