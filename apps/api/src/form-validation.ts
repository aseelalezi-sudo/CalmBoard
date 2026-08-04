import { BadRequestException } from "@nestjs/common";
import type {
  FormConditionOperator,
  FormFieldCondition,
  FormFieldDefinition,
  FormFieldType,
  FormSettings,
} from "@calmboard/database";
import { isJsonObject, type JsonObject } from "./request-validation.js";

const fieldTypes = new Set<FormFieldType>([
  "text",
  "textarea",
  "email",
  "number",
  "date",
  "select",
  "radio",
  "checkbox",
]);
const conditionOperators = new Set<FormConditionOperator>([
  "equals",
  "not_equals",
  "contains",
  "is_empty",
  "not_empty",
]);
const taskStatuses = new Set<FormSettings["status"]>(["backlog", "todo", "in_progress", "review"]);
const taskPriorities = new Set<FormSettings["priority"]>(["low", "medium", "high", "urgent"]);
const fieldIdPattern = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export const defaultFormFields: FormFieldDefinition[] = [
  { id: "f1", type: "text", label: "عنوان الطلب", required: true },
  { id: "f2", type: "textarea", label: "التفاصيل", required: true },
  { id: "f3", type: "select", label: "الأولوية", options: ["منخفض", "متوسط", "عاجل"] },
];

export const defaultFormSettings: FormSettings = {
  schemaVersion: 1,
  createTask: true,
  status: "todo",
  priority: "medium",
  captchaEnabled: true,
  taskTitleFieldId: "f1",
  taskDescriptionFieldId: "f2",
};

function boundedString(value: unknown, field: string, max: number, required = false) {
  if (typeof value !== "string") throw new BadRequestException(`${field} must be a string`);
  const normalized = value.trim();
  if (required && !normalized) throw new BadRequestException(`${field} is required`);
  if (normalized.length > max) throw new BadRequestException(`${field} must not exceed ${max} characters`);
  return normalized;
}

function parseCondition(value: unknown, index: number, previousIds: Set<string>): FormFieldCondition | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isJsonObject(value)) throw new BadRequestException(`fields.${index}.condition must be an object`);
  const fieldId = boundedString(value.fieldId, `fields.${index}.condition.fieldId`, 64, true);
  if (!previousIds.has(fieldId)) {
    throw new BadRequestException(`fields.${index}.condition.fieldId must reference an earlier field`);
  }
  const operator = boundedString(value.operator, `fields.${index}.condition.operator`, 20, true);
  if (!conditionOperators.has(operator as FormConditionOperator)) {
    throw new BadRequestException(`fields.${index}.condition.operator is unsupported`);
  }
  if (operator === "is_empty" || operator === "not_empty") {
    return { fieldId, operator };
  }
  return {
    fieldId,
    operator: operator as FormConditionOperator,
    value: boundedString(value.value, `fields.${index}.condition.value`, 500),
  };
}

export function parseFormFields(value: unknown): FormFieldDefinition[] {
  if (!Array.isArray(value)) throw new BadRequestException("fields must be an array");
  if (value.length === 0 || value.length > 50) {
    throw new BadRequestException("fields must contain between 1 and 50 items");
  }
  const ids = new Set<string>();
  return value.map((entry, index) => {
    if (!isJsonObject(entry)) throw new BadRequestException(`fields.${index} must be an object`);
    const id = boundedString(entry.id, `fields.${index}.id`, 64, true);
    if (!fieldIdPattern.test(id)) throw new BadRequestException(`fields.${index}.id is invalid`);
    if (ids.has(id)) throw new BadRequestException(`fields.${index}.id must be unique`);
    const type = boundedString(entry.type, `fields.${index}.type`, 20, true);
    if (!fieldTypes.has(type as FormFieldType)) throw new BadRequestException(`fields.${index}.type is unsupported`);
    const field: FormFieldDefinition = {
      id,
      type: type as FormFieldType,
      label: boundedString(entry.label, `fields.${index}.label`, 200, true),
      required: entry.required === true,
    };
    if (entry.description !== undefined) {
      field.description = boundedString(entry.description, `fields.${index}.description`, 500);
    }
    if (entry.placeholder !== undefined) {
      field.placeholder = boundedString(entry.placeholder, `fields.${index}.placeholder`, 200);
    }
    if (field.type === "select" || field.type === "radio") {
      if (!Array.isArray(entry.options) || entry.options.length < 1 || entry.options.length > 50) {
        throw new BadRequestException(`fields.${index}.options must contain between 1 and 50 items`);
      }
      field.options = entry.options.map((option, optionIndex) =>
        boundedString(option, `fields.${index}.options.${optionIndex}`, 100, true),
      );
      if (new Set(field.options).size !== field.options.length) {
        throw new BadRequestException(`fields.${index}.options must be unique`);
      }
    }
    field.condition = parseCondition(entry.condition, index, ids);
    ids.add(id);
    return field;
  });
}

function optionalBoundedString(value: unknown, field: string, max: number) {
  if (value === undefined || value === null || value === "") return undefined;
  return boundedString(value, field, max, true);
}

function optionalBoolean(value: unknown, field: string, fallback: boolean) {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new BadRequestException(`${field} must be a boolean`);
  return value;
}

export function parseFormSettings(value: unknown): FormSettings {
  if (value === undefined) return { ...defaultFormSettings };
  if (!isJsonObject(value)) throw new BadRequestException("settings must be an object");
  const status = value.status === undefined ? defaultFormSettings.status : String(value.status);
  const priority = value.priority === undefined ? defaultFormSettings.priority : String(value.priority);
  if (!taskStatuses.has(status as FormSettings["status"])) {
    throw new BadRequestException("settings.status is unsupported");
  }
  if (!taskPriorities.has(priority as FormSettings["priority"])) {
    throw new BadRequestException("settings.priority is unsupported");
  }
  return {
    schemaVersion: 1,
    createTask: optionalBoolean(value.createTask, "settings.createTask", defaultFormSettings.createTask),
    status: status as FormSettings["status"],
    priority: priority as FormSettings["priority"],
    captchaEnabled: optionalBoolean(
      value.captchaEnabled,
      "settings.captchaEnabled",
      defaultFormSettings.captchaEnabled,
    ),
    submitLabel: optionalBoundedString(value.submitLabel, "settings.submitLabel", 80),
    successMessage: optionalBoundedString(value.successMessage, "settings.successMessage", 500),
    taskTitleFieldId: optionalBoundedString(value.taskTitleFieldId, "settings.taskTitleFieldId", 64),
    taskDescriptionFieldId: optionalBoundedString(value.taskDescriptionFieldId, "settings.taskDescriptionFieldId", 64),
  };
}

export function isFormFieldVisible(field: FormFieldDefinition, values: Record<string, string>) {
  const condition = field.condition;
  if (!condition) return true;
  const actual = values[condition.fieldId] ?? "";
  switch (condition.operator) {
    case "equals":
      return actual === (condition.value ?? "");
    case "not_equals":
      return actual !== (condition.value ?? "");
    case "contains":
      return actual.includes(condition.value ?? "");
    case "is_empty":
      return actual.trim() === "";
    case "not_empty":
      return actual.trim() !== "";
  }
}

function validateFieldValue(field: FormFieldDefinition, value: string) {
  if (value.length > 10_000) throw new BadRequestException(`${field.id} is too long`);
  if (!value.trim()) {
    if (field.required) throw new BadRequestException(`${field.id} is required`);
    return;
  }
  if (field.type === "email" && !emailPattern.test(value)) {
    throw new BadRequestException(`${field.id} must be a valid email`);
  }
  if (field.type === "number" && !Number.isFinite(Number(value))) {
    throw new BadRequestException(`${field.id} must be a valid number`);
  }
  if (field.type === "date" && (!datePattern.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`)))) {
    throw new BadRequestException(`${field.id} must be a valid date`);
  }
  if ((field.type === "select" || field.type === "radio") && !field.options?.includes(value)) {
    throw new BadRequestException(`${field.id} must use one of the configured options`);
  }
  if (field.type === "checkbox" && value !== "true" && value !== "false") {
    throw new BadRequestException(`${field.id} must be true or false`);
  }
  if (field.type === "checkbox" && field.required && value !== "true") {
    throw new BadRequestException(`${field.id} must be accepted`);
  }
}

export function parsePublicFormSubmission(body: JsonObject, fields: FormFieldDefinition[]) {
  if (!isJsonObject(body.values)) throw new BadRequestException("values must be an object");
  if (Object.keys(body.values).length > 50) throw new BadRequestException("values contains too many fields");
  const rawValues: Record<string, string> = {};
  for (const [key, value] of Object.entries(body.values)) {
    if (typeof value !== "string") throw new BadRequestException(`values.${key} must be a string`);
    rawValues[key] = value;
  }
  const values: Record<string, string> = {};
  let totalLength = 0;
  for (const field of fields) {
    if (!isFormFieldVisible(field, values)) continue;
    const value = rawValues[field.id] ?? "";
    validateFieldValue(field, value);
    totalLength += value.length;
    if (value !== "" || field.type === "checkbox") values[field.id] = value;
  }
  if (totalLength > 50_000) throw new BadRequestException("values payload is too large");
  const captchaToken =
    body.captchaToken === undefined ? "" : boundedString(body.captchaToken, "captchaToken", 2048, false);
  return { values, captchaToken };
}
