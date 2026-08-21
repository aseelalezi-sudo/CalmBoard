import { TenantConflictError } from "./errors.js";
import type { CreateCustomFieldInput, CustomFieldOption, CustomFieldRecord } from "./repositories/custom-fields.js";

export const SUPPORTED_CUSTOM_FIELD_TYPES = [
  "short_text",
  "number",
  "date",
  "single_select",
  "checkbox",
  "url",
] as const;

export type SupportedCustomFieldType = (typeof SUPPORTED_CUSTOM_FIELD_TYPES)[number];

const customFieldTypeSet = new Set<string>(SUPPORTED_CUSTOM_FIELD_TYPES);

export const SYSTEM_METADATA_KEYS = new Set(["dependencies", "reminders", "recurrence", "delayReason"]);

export function normalizeCustomFieldType(rawType: unknown): SupportedCustomFieldType {
  if (typeof rawType !== "string") {
    throw new TenantConflictError("Custom field type is required and must be a string");
  }
  const normalized = rawType.trim().toLowerCase();
  if (normalized === "text") return "short_text";
  if (normalized === "select") return "single_select";
  if (!customFieldTypeSet.has(normalized)) {
    throw new TenantConflictError(`Unsupported custom field type '${rawType}'`);
  }
  return normalized as SupportedCustomFieldType;
}

export function validateCustomFieldKey(key: unknown): string {
  if (typeof key !== "string" || !key.trim()) {
    throw new TenantConflictError("Custom field key is required");
  }
  const trimmed = key.trim();
  if (trimmed.length > 160) {
    throw new TenantConflictError("Custom field key cannot exceed 160 characters");
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
    throw new TenantConflictError(
      "Custom field key may only contain alphanumeric characters, underscores, and hyphens",
    );
  }
  if (SYSTEM_METADATA_KEYS.has(trimmed)) {
    throw new TenantConflictError(`Custom field key '${trimmed}' is reserved by system metadata`);
  }
  return trimmed;
}

export function validateCustomFieldDefinition(input: CreateCustomFieldInput): CreateCustomFieldInput {
  if (typeof input.name !== "string" || !input.name.trim()) {
    throw new TenantConflictError("Custom field name is required");
  }
  const name = input.name.trim();
  if (name.length > 160) {
    throw new TenantConflictError("Custom field name cannot exceed 160 characters");
  }
  const key = validateCustomFieldKey(input.key);
  const type = normalizeCustomFieldType(input.type);

  let options: CustomFieldOption[] = [];
  if (type === "single_select") {
    if (!Array.isArray(input.options) || input.options.length === 0) {
      throw new TenantConflictError("Single select custom field must configure at least one option");
    }
    const seenValues = new Set<string>();
    options = input.options.map((opt, idx) => {
      if (!opt || typeof opt !== "object") {
        throw new TenantConflictError(`Option at index ${idx} must be an object`);
      }
      const label = typeof opt.label === "string" ? opt.label.trim() : "";
      const value = typeof opt.value === "string" ? opt.value.trim() : "";
      if (!label) throw new TenantConflictError(`Option label at index ${idx} is required`);
      if (!value) throw new TenantConflictError(`Option value at index ${idx} is required`);
      if (label.length > 160) throw new TenantConflictError(`Option label '${label}' cannot exceed 160 characters`);
      if (value.length > 160) throw new TenantConflictError(`Option value '${value}' cannot exceed 160 characters`);
      if (seenValues.has(value)) {
        throw new TenantConflictError(`Duplicate option value '${value}' in custom field definition`);
      }
      seenValues.add(value);
      return {
        label,
        value,
        ...(typeof opt.color === "string" && opt.color.trim() ? { color: opt.color.trim() } : {}),
      };
    });
  }

  return {
    name,
    key,
    type,
    projectId: input.projectId ?? null,
    description: typeof input.description === "string" ? input.description.slice(0, 10_000) : null,
    required: input.required ?? false,
    sensitive: input.sensitive ?? false,
    options,
    order: typeof input.order === "number" && Number.isFinite(input.order) ? input.order : 10,
  };
}

export type TaskCustomFieldValidationContext = {
  organizationId: string;
  workspaceId: string;
  projectId: string;
};

export type ValidateTaskCustomFieldsOptions = {
  isCreate?: boolean;
  existingCustomFields?: Record<string, unknown> | null;
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

function normalizeAndValidateFieldValue(def: CustomFieldRecord, value: unknown): unknown {
  const type = normalizeCustomFieldType(def.type);

  if (value === undefined || value === null) {
    if (def.required) {
      throw new TenantConflictError(`Required custom field '${def.key}' is missing`);
    }
    return null;
  }

  switch (type) {
    case "short_text": {
      if (typeof value !== "string") {
        throw new TenantConflictError(`Custom field '${def.key}' must be a string`);
      }
      const trimmed = value.trim();
      if (!trimmed) {
        if (def.required) throw new TenantConflictError(`Required custom field '${def.key}' cannot be empty`);
        return null;
      }
      if (trimmed.length > 10_000) {
        throw new TenantConflictError(`Custom field '${def.key}' exceeds maximum length of 10,000 characters`);
      }
      return trimmed;
    }

    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new TenantConflictError(`Custom field '${def.key}' must be a finite number`);
      }
      return value;
    }

    case "date": {
      if (value instanceof Date) {
        if (Number.isNaN(value.getTime())) {
          throw new TenantConflictError(`Custom field '${def.key}' must be a valid date`);
        }
        return value.toISOString();
      }
      if (typeof value === "string") {
        const trimmed = value.trim();
        if (!trimmed) {
          if (def.required) throw new TenantConflictError(`Required custom field '${def.key}' cannot be empty`);
          return null;
        }
        const iso = parseAndValidateIsoDate(trimmed);
        if (!iso) {
          throw new TenantConflictError(`Custom field '${def.key}' must be a valid date`);
        }
        return iso;
      }
      throw new TenantConflictError(`Custom field '${def.key}' must be a valid date`);
    }

    case "single_select": {
      if (typeof value !== "string") {
        throw new TenantConflictError(`Custom field '${def.key}' must be a string`);
      }
      const trimmed = value.trim();
      if (!trimmed) {
        if (def.required) throw new TenantConflictError(`Required custom field '${def.key}' cannot be empty`);
        return null;
      }
      const options = (def.options ?? []) as CustomFieldOption[];
      const matched = options.find((opt) => opt.value === trimmed || opt.label === trimmed);
      if (!matched) {
        throw new TenantConflictError(`Invalid option for custom field '${def.key}'`);
      }
      return matched.value;
    }

    case "checkbox": {
      if (typeof value !== "boolean") {
        throw new TenantConflictError(`Custom field '${def.key}' must be a boolean`);
      }
      return value;
    }

    case "url": {
      if (typeof value !== "string") {
        throw new TenantConflictError(`Custom field '${def.key}' must be a valid URL`);
      }
      const trimmed = value.trim();
      if (!trimmed) {
        if (def.required) throw new TenantConflictError(`Required custom field '${def.key}' cannot be empty`);
        return null;
      }
      try {
        const parsed = new URL(trimmed);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          throw new Error("Invalid protocol");
        }
      } catch {
        throw new TenantConflictError(`Custom field '${def.key}' must be a valid HTTP or HTTPS URL`);
      }
      return trimmed;
    }
  }
}

function isValidNonEmptyValue(def: CustomFieldRecord, val: unknown): boolean {
  if (val === undefined || val === null) return false;
  const type = normalizeCustomFieldType(def.type);
  if (type === "checkbox") return typeof val === "boolean";
  if (type === "number") return typeof val === "number" && Number.isFinite(val);
  if (type === "short_text" || type === "url" || type === "single_select") {
    return typeof val === "string" && val.trim().length > 0;
  }
  if (type === "date") {
    if (typeof val === "string") return val.trim().length > 0 && parseAndValidateIsoDate(val.trim()) !== null;
    if (val instanceof Date) return !Number.isNaN(val.getTime());
    return false;
  }
  return true;
}

export function validateAndNormalizeTaskCustomFields(
  context: TaskCustomFieldValidationContext,
  customFieldsInput: Record<string, unknown> | null | undefined,
  definitions: CustomFieldRecord[],
  options: ValidateTaskCustomFieldsOptions = {},
): Record<string, unknown> {
  const isCreate = options.isCreate ?? false;
  const existing = options.existingCustomFields ?? {};

  // Build definitions lookup map by key
  const defsByKey = new Map<string, CustomFieldRecord>();
  for (const def of definitions) {
    defsByKey.set(def.key, def);
  }

  // If no input provided on update, return existing
  if (!isCreate && (customFieldsInput === undefined || customFieldsInput === null)) {
    return existing ?? {};
  }

  const rawInput = customFieldsInput ?? {};
  const inputEntries = Object.entries(rawInput);

  // 1. Check for unknown custom field keys
  for (const [key] of inputEntries) {
    if (SYSTEM_METADATA_KEYS.has(key)) continue;
    if (!defsByKey.has(key)) {
      throw new TenantConflictError(`Unknown custom field '${key}'`);
    }
  }

  // 2. Validate project scope for every provided key
  for (const [key] of inputEntries) {
    if (SYSTEM_METADATA_KEYS.has(key)) continue;
    const def = defsByKey.get(key)!;
    if (def.projectId !== null && def.projectId !== context.projectId) {
      throw new TenantConflictError(`Custom field '${def.key}' belongs to another project`);
    }
  }

  // 3. Prepare merged/resulting state
  const result: Record<string, unknown> = isCreate ? {} : { ...existing };

  // Retain system metadata keys if present in existing
  for (const key of Object.keys(existing)) {
    if (SYSTEM_METADATA_KEYS.has(key)) {
      result[key] = existing[key];
    }
  }
  // Retain system metadata keys if present in input
  for (const [key, val] of inputEntries) {
    if (SYSTEM_METADATA_KEYS.has(key)) {
      result[key] = val;
    }
  }

  // 4. Process each provided custom field key
  for (const [key, val] of inputEntries) {
    if (SYSTEM_METADATA_KEYS.has(key)) continue;
    const def = defsByKey.get(key)!;

    if (val === null || val === undefined) {
      if (def.required) {
        throw new TenantConflictError(
          isCreate
            ? `Required custom field '${def.key}' is missing`
            : `Required custom field '${def.key}' cannot be empty`,
        );
      }
      delete result[key];
      continue;
    }

    const normalizedValue = normalizeAndValidateFieldValue(def, val);
    if (normalizedValue === null) {
      delete result[def.key];
    } else {
      result[def.key] = normalizedValue;
    }
  }

  // 5. Check required fields for all applicable definitions on Task creation
  if (isCreate) {
    for (const def of definitions) {
      if (def.projectId === null || def.projectId === context.projectId) {
        if (def.required) {
          const val = result[def.key];
          if (!isValidNonEmptyValue(def, val)) {
            throw new TenantConflictError(`Required custom field '${def.key}' is missing`);
          }
        }
      }
    }
  }

  return result;
}
