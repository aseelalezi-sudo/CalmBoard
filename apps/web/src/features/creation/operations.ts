import {
  createAutomationRecord,
  createDocumentRecord,
  createGoalRecord,
  createProjectRecord,
  createSavedViewRecord,
  inviteMemberRecord,
} from "@/features/creation/api";

export function createProjectFromForm(
  form: FormData,
  scope: { organizationId?: string; workspaceId?: string; ownerId?: string },
) {
  return createProjectRecord({
    name: form.get("name"),
    description: form.get("description"),
    color: form.get("color") || "#6366f1",
    icon: form.get("icon") || "folder",
    template: form.get("template") || "default",
    ...scope,
  });
}

export function createDocumentFromForm(
  form: FormData,
  scope: { organizationId?: string; workspaceId?: string; authorId?: string },
) {
  return createDocumentRecord({
    ...scope,
    title: form.get("title"),
    icon: form.get("icon") || "📄",
    parentId: form.get("parentId") || null,
    content: "",
  });
}

export function createGoalFromForm(
  form: FormData,
  scope: { organizationId?: string; workspaceId?: string; ownerId?: string },
) {
  return createGoalRecord({
    organizationId: scope.organizationId,
    workspaceId: scope.workspaceId,
    ownerId: (form.get("owner") as string) || scope.ownerId,
    title: form.get("title"),
    type: form.get("type"),
    parentId: form.get("parentId") || null,
    progressMode: form.get("progressMode") || "measurement",
    measurementUnit: form.get("measurementUnit") || "percentage",
    startValue: Number(form.get("startValue") || 0),
    currentValue: Number(form.get("startValue") || 0),
    targetValue: Number(form.get("targetValue") || 100),
    weight: Number(form.get("weight") || 1),
    periodEnd: form.get("periodEnd") || null,
  });
}

export function createAutomationFromForm(
  form: FormData,
  scope: { organizationId?: string; workspaceId?: string; actorId?: string },
) {
  const conditions: Record<string, string> = {};
  const conditionField = form.get("condField") as string;
  const conditionValue = form.get("condValue") as string;
  if (conditionField && conditionValue) conditions[conditionField] = conditionValue;
  const actions: Record<string, string> = {};
  const actionField = form.get("actField") as string;
  const actionValue = form.get("actValue") as string;
  if (actionField && actionValue) actions[actionField] = actionValue;
  return createAutomationRecord({
    ...scope,
    name: form.get("name"),
    trigger: form.get("trigger"),
    conditions,
    actions,
    enabled: true,
  });
}

export function inviteMemberFromForm(
  form: FormData,
  scope: { organizationId?: string; workspaceId?: string; actorId?: string },
) {
  return inviteMemberRecord({
    ...scope,
    email: form.get("email"),
    role: form.get("role"),
  });
}

export function createSavedViewFromForm(
  form: FormData,
  input: {
    organizationId?: string;
    workspaceId?: string;
    projectId?: string;
    viewType: string;
    filters: Record<string, string | undefined>;
    configuration: import("@/lib/types").SavedViewConfiguration;
  },
) {
  return createSavedViewRecord({
    organizationId: input.organizationId,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    name: form.get("name"),
    viewType: input.viewType,
    filters: input.filters,
    configuration: input.configuration,
    isShared: form.get("shared") === "on",
    isDefault: form.get("default") === "on",
  });
}
