import { BadRequestException } from "@nestjs/common";
import type {
  CreateAutomationInput,
  CreateCustomFieldInput,
  CustomFieldOption,
  DatabaseTenantContext,
  InviteMemberInput,
  MembershipRole,
  UpdateAutomationInput,
} from "@calmboard/database";

export type JsonObject = Record<string, unknown>;

const automationTriggers = new Set([
  "task_created",
  "task_status_changed",
  "task_assignee_changed",
  "task_priority_changed",
  "comment_added",
  "schedule_daily",
]);
const conditionKeys = new Set(["status", "priority", "projectId", "assigneeId", "hasTag"]);
const actionKeys = new Set(["setStatus", "setPriority", "assignTo", "addTag", "addComment", "notify", "notifyTitle"]);
const taskStatuses = new Set(["backlog", "todo", "in_progress", "review", "done", "canceled"]);
const taskPriorities = new Set(["low", "medium", "high", "urgent"]);
const notificationTargets = new Set(["assignee", "reporter", "all"]);
const customFieldTypes = new Set(["short_text", "number", "date", "single_select", "checkbox", "url"]);
const membershipRoles = new Set<MembershipRole>(["owner", "admin", "manager", "member", "guest", "viewer"]);

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function requiredString(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim()) throw new BadRequestException(`${field} is required`);
  return value.trim();
}

export function requiredIdempotencyKey(value: unknown) {
  const key = requiredString(value, "Idempotency-Key");
  if (key.length < 8 || key.length > 255 || /[\u0000-\u001f\u007f]/.test(key)) {
    throw new BadRequestException("Idempotency-Key must contain between 8 and 255 printable characters");
  }
  return key;
}

export function optionalString(value: unknown, field: string) {
  if (value === undefined || value === null || value === "") return undefined;
  return requiredString(value, field);
}

export function tenantContext(organizationId: unknown, workspaceId: unknown, actorId?: unknown): DatabaseTenantContext {
  return {
    organizationId: requiredString(organizationId, "organizationId"),
    workspaceId: requiredString(workspaceId, "workspaceId"),
    actorId: optionalString(actorId, "actorId"),
  };
}

export function organizationContext(organizationId: unknown, actorId?: unknown): DatabaseTenantContext {
  return {
    organizationId: requiredString(organizationId, "organizationId"),
    actorId: optionalString(actorId, "actorId"),
  };
}

export function tenantContextFromBody(body: JsonObject) {
  return tenantContext(body.organizationId, body.workspaceId, body.actorId);
}

function readAutomationTrigger(value: unknown) {
  const trigger = requiredString(value, "trigger");
  if (!automationTriggers.has(trigger)) throw new BadRequestException("trigger is invalid");
  return trigger;
}

function readStringMap(value: unknown, field: string, allowedKeys: ReadonlySet<string>) {
  if (!isJsonObject(value)) throw new BadRequestException(`${field} must be an object`);
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!allowedKeys.has(key)) throw new BadRequestException(`${field}.${key} is not supported`);
    const stringValue = requiredString(entry, `${field}.${key}`);
    if ((key === "status" || key === "setStatus") && !taskStatuses.has(stringValue)) {
      throw new BadRequestException(`${field}.${key} is invalid`);
    }
    if ((key === "priority" || key === "setPriority") && !taskPriorities.has(stringValue)) {
      throw new BadRequestException(`${field}.${key} is invalid`);
    }
    if (key === "notify" && !notificationTargets.has(stringValue)) {
      throw new BadRequestException(`${field}.${key} is invalid`);
    }
    if (stringValue.length > 5000) throw new BadRequestException(`${field}.${key} is too long`);
    result[key] = stringValue;
  }
  return result;
}

export function parseCreateAutomationInput(body: JsonObject): CreateAutomationInput {
  const name = requiredString(body.name, "name");
  if (name.length > 255) throw new BadRequestException("name is too long");
  return {
    name,
    trigger: readAutomationTrigger(body.trigger),
    ...(body.conditions !== undefined
      ? { conditions: readStringMap(body.conditions, "conditions", conditionKeys) }
      : {}),
    ...(body.actions !== undefined ? { actions: readStringMap(body.actions, "actions", actionKeys) } : {}),
    ...(body.enabled === undefined ? {} : { enabled: readBoolean(body.enabled, "enabled") }),
  };
}

export function parseUpdateAutomationInput(body: JsonObject): UpdateAutomationInput {
  const input: UpdateAutomationInput = {};
  if (body.name !== undefined) {
    input.name = requiredString(body.name, "name");
    if (input.name.length > 255) throw new BadRequestException("name is too long");
  }
  if (body.trigger !== undefined) input.trigger = readAutomationTrigger(body.trigger);
  if (body.conditions !== undefined) input.conditions = readStringMap(body.conditions, "conditions", conditionKeys);
  if (body.actions !== undefined) input.actions = readStringMap(body.actions, "actions", actionKeys);
  if (body.enabled !== undefined) input.enabled = readBoolean(body.enabled, "enabled");
  if (!Object.keys(input).length) throw new BadRequestException("at least one automation field is required");
  return input;
}

function readBoolean(value: unknown, field: string) {
  if (typeof value !== "boolean") throw new BadRequestException(`${field} must be a boolean`);
  return value;
}

function readCustomFieldOptions(value: unknown): CustomFieldOption[] {
  if (!Array.isArray(value)) throw new BadRequestException("options must be an array");
  return value.map((option, index) => {
    if (!isJsonObject(option)) throw new BadRequestException(`options.${index} must be an object`);
    return {
      label: requiredString(option.label, `options.${index}.label`),
      value: requiredString(option.value, `options.${index}.value`),
      ...(option.color === undefined ? {} : { color: requiredString(option.color, `options.${index}.color`) }),
    };
  });
}

export function parseCreateCustomFieldInput(body: JsonObject): CreateCustomFieldInput {
  const name = requiredString(body.name, "name");
  if (name.length > 160) throw new BadRequestException("name is too long");
  const type = body.type === undefined ? "short_text" : requiredString(body.type, "type");
  if (!customFieldTypes.has(type)) throw new BadRequestException("type is invalid");
  const input: CreateCustomFieldInput = {
    name,
    key:
      name
        .toLowerCase()
        .replace(/[\s_]+/g, "-")
        .replace(/[^a-z0-9-]/g, "") || `field-${Date.now()}`,
    type,
  };
  if (body.projectId !== undefined) {
    input.projectId =
      body.projectId === null || body.projectId === "" ? null : requiredString(body.projectId, "projectId");
  }
  if (body.description !== undefined) {
    if (typeof body.description !== "string" && body.description !== null) {
      throw new BadRequestException("description must be a string or null");
    }
    input.description = body.description;
  }
  if (body.required !== undefined) input.required = readBoolean(body.required, "required");
  if (body.sensitive !== undefined) input.sensitive = readBoolean(body.sensitive, "sensitive");
  if (body.options !== undefined) input.options = readCustomFieldOptions(body.options);
  if (body.order !== undefined) {
    if (typeof body.order !== "number" || !Number.isFinite(body.order)) {
      throw new BadRequestException("order must be a finite number");
    }
    input.order = body.order;
  }
  return input;
}

function readMembershipRole(value: unknown, field: string): MembershipRole {
  if (typeof value !== "string" || !membershipRoles.has(value as MembershipRole)) {
    throw new BadRequestException(`${field} is invalid`);
  }
  return value as MembershipRole;
}

export function parseInviteMemberInput(body: JsonObject): InviteMemberInput {
  const email = requiredString(body.email, "email").toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new BadRequestException("email is invalid");
  return { email, ...(body.role === undefined ? {} : { role: readMembershipRole(body.role, "role") }) };
}

export function parseMembershipRoleUpdate(body: JsonObject) {
  return { membershipId: requiredString(body.id, "id"), role: readMembershipRole(body.role, "role") };
}
