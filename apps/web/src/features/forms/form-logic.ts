import type { FormField } from "@/lib/types";

export function isFieldVisible(field: FormField, values: Record<string, string>) {
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

export function visibleFormFields(fields: FormField[], values: Record<string, string>) {
  const visible: FormField[] = [];
  const visibleValues: Record<string, string> = {};
  for (const field of fields) {
    if (!isFieldVisible(field, visibleValues)) continue;
    visible.push(field);
    visibleValues[field.id] = values[field.id] ?? "";
  }
  return visible;
}

export function validateVisibleFields(fields: FormField[], values: Record<string, string>) {
  const errors: Record<string, string> = {};
  for (const field of visibleFormFields(fields, values)) {
    const value = values[field.id] ?? "";
    if (field.required && (!value.trim() || (field.type === "checkbox" && value !== "true"))) {
      errors[field.id] = "required";
    } else if (field.type === "email" && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      errors[field.id] = "email";
    } else if (field.type === "number" && value && !Number.isFinite(Number(value))) {
      errors[field.id] = "number";
    }
  }
  return errors;
}
