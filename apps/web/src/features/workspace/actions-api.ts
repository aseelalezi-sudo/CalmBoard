import type {
  CustomField,
  Doc,
  Form,
  FormInput,
  Member,
  Notification,
  Project,
  Task,
  TimeLog,
  Timesheet,
  User,
  Workspace,
} from "@/lib/types";
import { apiServiceUrl, jsonRequest, request, requestJson } from "@/lib/client-api";
import type { AIActionProposal } from "@/features/ai/types";

export type TenantScope = {
  organizationId: string;
  workspaceId: string;
  actorId?: string;
};

export function createTimeLog(
  input: TenantScope & { taskId: string; durationMinutes: number; description: string; startedAt?: string },
) {
  return requestJson<TimeLog>(apiServiceUrl("/time-logs"), jsonRequest("POST", input));
}

export function submitTimesheetRecord(timesheet: Timesheet, scope: TenantScope) {
  return requestJson<Timesheet>(
    apiServiceUrl(`/timesheets/${encodeURIComponent(timesheet.id)}/submit`),
    jsonRequest("POST", { ...scope, expectedVersion: timesheet.version }),
  );
}

export function reviewTimesheetRecord(
  timesheet: Timesheet,
  decision: "approved" | "rejected",
  reason: string | undefined,
  scope: TenantScope,
) {
  return requestJson<Timesheet>(
    apiServiceUrl(`/timesheets/${encodeURIComponent(timesheet.id)}/review`),
    jsonRequest("POST", { ...scope, expectedVersion: timesheet.version, decision, reason }),
  );
}

export function runAiAction(input: TenantScope & { action: string; text: string; projectId?: string }) {
  return requestJson<{ result: unknown; provider: string; model: string; proposal?: AIActionProposal }>(
    apiServiceUrl("/ai"),
    jsonRequest("POST", input),
  );
}

export function approveAIProposal(scope: TenantScope, proposal: Pick<AIActionProposal, "id" | "digest" | "projectId">) {
  return requestJson<{ proposalId: string; status: "executed"; importedCount: number }>(
    apiServiceUrl(`/ai/proposals/${encodeURIComponent(proposal.id)}/approve`),
    jsonRequest("POST", { ...scope, projectId: proposal.projectId, digest: proposal.digest }),
  );
}

export function rejectAIProposal(scope: TenantScope, proposal: Pick<AIActionProposal, "id" | "digest" | "projectId">) {
  return requestJson<{ id: string; status: "rejected" }>(
    apiServiceUrl(`/ai/proposals/${encodeURIComponent(proposal.id)}/reject`),
    jsonRequest("POST", { ...scope, projectId: proposal.projectId, digest: proposal.digest }),
  );
}

export async function markNotificationsRead(
  input: TenantScope & { userId: string; id?: string; markAllRead?: boolean },
) {
  await request(apiServiceUrl("/notifications"), jsonRequest("PATCH", input));
}

export async function patchDocument(id: string, input: TenantScope & Partial<Doc>) {
  return requestJson<Doc>(apiServiceUrl("/docs"), jsonRequest("PATCH", { id, ...input }));
}

export function updateMemberRoleRecord(input: TenantScope & { id: string; role: string }) {
  return requestJson<Member>(apiServiceUrl("/members"), jsonRequest("PATCH", input));
}

export function resendInvitationRecord(id: string, input: TenantScope) {
  return requestJson(apiServiceUrl(`/members/${encodeURIComponent(id)}/resend`), jsonRequest("POST", input));
}

export async function revokeInvitationRecord(id: string, input: TenantScope) {
  await request(apiServiceUrl(`/members/${encodeURIComponent(id)}`), jsonRequest("DELETE", input));
}

export async function updateUserSkillsRecord(input: TenantScope & { userId: string; skills: string[] }) {
  await request(apiServiceUrl("/users/skills"), jsonRequest("POST", input));
}

export function updateWorkspaceRecord(id: string, input: TenantScope & Partial<Workspace>) {
  return requestJson<Workspace>(apiServiceUrl(`/workspaces/${encodeURIComponent(id)}`), jsonRequest("PATCH", input));
}

export function createWorkspaceRecord(
  input: TenantScope & { name: string; color?: string; icon?: string; description?: string },
) {
  return requestJson<Workspace>(apiServiceUrl("/workspaces"), jsonRequest("POST", input));
}

export type UpdateProjectRecordInput = TenantScope &
  Partial<
    Pick<
      Project,
      | "name"
      | "description"
      | "color"
      | "icon"
      | "coverUrl"
      | "status"
      | "priority"
      | "ownerId"
      | "managerId"
      | "startDate"
      | "endDate"
      | "privacy"
      | "progress"
      | "budget"
      | "estimatedHours"
    >
  > & { expectedVersion: number };

export function updateProjectRecord(id: string, input: UpdateProjectRecordInput) {
  return requestJson<Project>(apiServiceUrl(`/projects/${encodeURIComponent(id)}`), jsonRequest("PATCH", input));
}

export function archiveProjectRecord(project: Project, scope: TenantScope) {
  return requestJson<Project>(
    apiServiceUrl(`/projects/${encodeURIComponent(project.id)}/archive`),
    jsonRequest("POST", { ...scope, expectedVersion: project.version }),
  );
}

export function restoreProjectRecord(project: Project, scope: TenantScope) {
  return requestJson<Project>(
    apiServiceUrl(`/projects/${encodeURIComponent(project.id)}/restore`),
    jsonRequest("POST", { ...scope, expectedVersion: project.version }),
  );
}

export function deleteProjectRecord(project: Project, scope: TenantScope) {
  return requestJson<Project>(
    apiServiceUrl(`/projects/${encodeURIComponent(project.id)}`),
    jsonRequest("DELETE", { ...scope, expectedVersion: project.version }),
  );
}

export type CreateCustomFieldRecordInput = TenantScope & {
  projectId?: string;
  name: string;
  type: string;
  description?: string;
  required?: boolean;
  sensitive?: boolean;
  options?: Array<{ label: string; value: string }>;
};

export function createCustomFieldRecord(input: CreateCustomFieldRecordInput) {
  return requestJson<CustomField>(apiServiceUrl("/custom-fields"), jsonRequest("POST", input));
}

export async function deleteCustomFieldRecord(id: string, scope: Required<TenantScope>) {
  const query = new URLSearchParams({ id, ...scope });
  await request(`${apiServiceUrl("/custom-fields")}?${query.toString()}`, { method: "DELETE" });
}

export function createFormRecord(input: TenantScope & FormInput) {
  return requestJson<Form>(apiServiceUrl("/forms"), jsonRequest("POST", input));
}

export function updateFormRecord(id: string, input: TenantScope & FormInput) {
  return requestJson<Form>(apiServiceUrl("/forms"), jsonRequest("PATCH", { id, ...input }));
}

export async function updateFormStatusRecord(id: string, isActive: boolean, scope: TenantScope) {
  await request(apiServiceUrl("/forms"), jsonRequest("PATCH", { id, isActive, ...scope }));
}

export type WorkspaceActionResult = Notification | User;
