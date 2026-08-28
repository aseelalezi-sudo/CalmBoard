import type { Automation, Doc, Goal, Project, SavedView, SavedViewConfiguration } from "@/lib/types";
import { apiServiceUrl, jsonRequest, requestJson } from "@/lib/client-api";

export function createProjectRecord(input: {
  name: FormDataEntryValue | null;
  description: FormDataEntryValue | null;
  color: FormDataEntryValue;
  template: FormDataEntryValue;
  icon?: FormDataEntryValue;
  organizationId?: string;
  workspaceId?: string;
  ownerId?: string;
}) {
  return requestJson<Project>(apiServiceUrl("/projects"), jsonRequest("POST", input));
}

export function createDocumentRecord(input: {
  organizationId?: string;
  workspaceId?: string;
  authorId?: string;
  title: FormDataEntryValue | null;
  icon: FormDataEntryValue;
  parentId: FormDataEntryValue | null;
  content: string;
}) {
  return requestJson<Doc>(apiServiceUrl("/docs"), jsonRequest("POST", input));
}

export function createGoalRecord(input: {
  organizationId?: string;
  workspaceId?: string;
  ownerId?: string;
  title: FormDataEntryValue | null;
  type: FormDataEntryValue | null;
  parentId: FormDataEntryValue | null;
  progressMode: FormDataEntryValue;
  measurementUnit: FormDataEntryValue;
  startValue: number;
  currentValue: number;
  targetValue: number;
  weight: number;
  periodEnd: FormDataEntryValue | null;
}) {
  return requestJson<Goal>(apiServiceUrl("/goals"), jsonRequest("POST", input));
}

export function createAutomationRecord(input: {
  organizationId?: string;
  workspaceId?: string;
  actorId?: string;
  name: FormDataEntryValue | null;
  trigger: FormDataEntryValue | null;
  conditions: Record<string, string>;
  actions: Record<string, string>;
  enabled: boolean;
}) {
  return requestJson<Automation>(apiServiceUrl("/automations"), jsonRequest("POST", input));
}

export function inviteMemberRecord(input: {
  organizationId?: string;
  workspaceId?: string;
  email: FormDataEntryValue | null;
  role: FormDataEntryValue | null;
  actorId?: string;
}) {
  return requestJson<{ error?: string; immediate?: boolean }>(apiServiceUrl("/members"), jsonRequest("POST", input));
}

export function createSavedViewRecord(input: {
  organizationId?: string;
  workspaceId?: string;
  projectId?: string;
  name: FormDataEntryValue | null;
  viewType: string;
  filters: Record<string, string | undefined>;
  configuration: SavedViewConfiguration;
  isShared: boolean;
  isDefault: boolean;
}) {
  return requestJson<SavedView>(apiServiceUrl("/saved-views"), jsonRequest("POST", input));
}
