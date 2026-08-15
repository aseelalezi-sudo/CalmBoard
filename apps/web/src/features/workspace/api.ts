import type {
  Activity,
  AuthorizationCapabilities,
  Automation,
  AutomationRun,
  CustomField,
  Doc,
  Form,
  Goal,
  Invitation,
  Invoice,
  Member,
  Notification,
  Organization,
  Project,
  SavedView,
  Task,
  Team,
  TimeLog,
  Timesheet,
  User,
  Workspace,
} from "@/lib/types";
import { ApiError, apiServiceUrl, requestJson } from "@/lib/client-api";

type SessionResponse = {
  user?: User;
};

export type WorkspaceDirectoryResponse = {
  workspaces: Workspace[];
  organizations: Organization[];
  users: User[];
  teams: Team[];
};

export type WorkspaceModulesResponse = {
  authorization: AuthorizationCapabilities | null;
  docs: Doc[];
  goals: Goal[];
  automations: Automation[];
  automationRuns: AutomationRun[];
  activities: Activity[];
  savedViews: SavedView[];
  timeLogs: TimeLog[];
  timesheets: Timesheet[];
  timesheetReviewQueue: Timesheet[];
  timeTotals: {
    totalMinutes: number;
    billableMinutes: number;
  };
  members: Member[];
  invitations: Invitation[];
  forms: Form[];
  invoices: Invoice[];
  customFields: CustomField[];
};

export async function getCurrentSession() {
  try {
    return await requestJson<SessionResponse>(apiServiceUrl("/auth/session"));
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return {};
    throw error;
  }
}

export function getWorkspaceDirectory(actorId: string) {
  return requestJson<WorkspaceDirectoryResponse>(
    `${apiServiceUrl("/workspaces")}?actorId=${encodeURIComponent(actorId)}`,
  );
}

export function getProjects(organizationId: string, workspaceId: string) {
  return requestJson<Project[]>(
    `${apiServiceUrl("/projects")}?organizationId=${encodeURIComponent(organizationId)}&workspaceId=${encodeURIComponent(workspaceId)}`,
  );
}

export function getTasks(project: Pick<Project, "id" | "organizationId" | "workspaceId">) {
  return requestJson<Task[]>(
    `${apiServiceUrl("/tasks")}?projectId=${encodeURIComponent(project.id)}&organizationId=${encodeURIComponent(project.organizationId)}&workspaceId=${encodeURIComponent(project.workspaceId)}`,
  );
}

export type TaskPage = {
  items: Task[];
  nextCursor: string | null;
  total: number;
};

export type TaskPageFilters = {
  cursor?: string;
  limit?: number;
  search?: string;
  status?: string;
  priority?: string;
  assigneeId?: string;
  sortBy?:
    | "order"
    | "createdAt"
    | "updatedAt"
    | "dueDate"
    | "priority"
    | "title"
    | "status"
    | "assigneeId"
    | "storyPoints"
    | "estimatedHours"
    | "loggedHours";
  sortDirection?: "asc" | "desc";
};

export function getTaskPage(
  project: Pick<Project, "id" | "organizationId" | "workspaceId">,
  filters: TaskPageFilters = {},
) {
  const query = new URLSearchParams({
    projectId: project.id,
    organizationId: project.organizationId,
    workspaceId: project.workspaceId,
    limit: String(filters.limit ?? 100),
  });
  for (const [key, value] of Object.entries(filters)) {
    if (key !== "limit" && value !== undefined && value !== "") query.set(key, String(value));
  }
  return requestJson<TaskPage>(`${apiServiceUrl("/tasks")}?${query.toString()}`);
}

export function getNotifications(userId: string, organizationId: string, workspaceId: string) {
  return requestJson<Notification[]>(
    `${apiServiceUrl("/notifications")}?userId=${encodeURIComponent(userId)}&organizationId=${encodeURIComponent(organizationId)}&workspaceId=${encodeURIComponent(workspaceId)}`,
  );
}

export async function getWorkspaceModules(
  workspaceId: string,
  organizationId?: string,
  userId?: string,
): Promise<WorkspaceModulesResponse> {
  const encodedWorkspaceId = encodeURIComponent(workspaceId);
  const encodedOrganizationId = encodeURIComponent(organizationId ?? "");

  const authorization = organizationId
    ? await requestJson<AuthorizationCapabilities>(
        `${apiServiceUrl("/authorization/me")}?organizationId=${encodedOrganizationId}&workspaceId=${encodedWorkspaceId}`,
      )
    : null;

  const permissions = new Set(authorization?.permissions ?? []);

  const [docs, goals, automationData, activities, savedViews, timeData, memberData, forms, invoices, customFields] =
    await Promise.all([
      requestJson<Doc[]>(
        `${apiServiceUrl("/docs")}?organizationId=${encodedOrganizationId}&workspaceId=${encodedWorkspaceId}`,
      ),
      requestJson<Goal[]>(
        `${apiServiceUrl("/goals")}?organizationId=${encodedOrganizationId}&workspaceId=${encodedWorkspaceId}`,
      ),
      requestJson<{ automations?: Automation[]; runs?: AutomationRun[] }>(
        `${apiServiceUrl("/automations")}?organizationId=${encodedOrganizationId}&workspaceId=${encodedWorkspaceId}`,
      ),
      permissions.has("audit.view")
        ? requestJson<Activity[]>(
            `${apiServiceUrl("/activities")}?organizationId=${encodedOrganizationId}&workspaceId=${encodedWorkspaceId}`,
          )
        : Promise.resolve([]),
      requestJson<SavedView[]>(
        `${apiServiceUrl("/saved-views")}?organizationId=${encodedOrganizationId}&workspaceId=${encodedWorkspaceId}${userId ? `&actorId=${encodeURIComponent(userId)}` : ""}`,
      ),
      requestJson<{
        logs?: TimeLog[];
        totalMinutes?: number;
        billableMinutes?: number;
        timesheets?: Timesheet[];
        reviewQueue?: Timesheet[];
      }>(
        `${apiServiceUrl("/time-logs")}?organizationId=${encodedOrganizationId}&workspaceId=${encodedWorkspaceId}${userId ? `&userId=${encodeURIComponent(userId)}` : ""}`,
      ),
      organizationId
        ? requestJson<{ members?: Member[]; invitations?: Invitation[] }>(
            `${apiServiceUrl("/members")}?organizationId=${encodedOrganizationId}&workspaceId=${encodedWorkspaceId}&actorId=${encodeURIComponent(userId ?? "")}`,
          )
        : Promise.resolve<{ members?: Member[]; invitations?: Invitation[] }>({}),
      requestJson<Form[]>(
        `${apiServiceUrl("/forms")}?organizationId=${encodedOrganizationId}&workspaceId=${encodedWorkspaceId}`,
      ),
      organizationId && permissions.has("billing.manage")
        ? requestJson<Invoice[]>(`${apiServiceUrl("/invoices")}?organizationId=${encodedOrganizationId}`)
        : Promise.resolve([]),
      requestJson<CustomField[]>(
        `${apiServiceUrl("/custom-fields")}?organizationId=${encodedOrganizationId}&workspaceId=${encodedWorkspaceId}`,
      ),
    ]);

  return {
    authorization,
    docs,
    goals,
    automations: automationData.automations ?? [],
    automationRuns: automationData.runs ?? [],
    activities,
    savedViews,
    timeLogs: timeData.logs ?? [],
    timesheets: timeData.timesheets ?? [],
    timesheetReviewQueue: timeData.reviewQueue ?? [],
    timeTotals: {
      totalMinutes: timeData.totalMinutes ?? 0,
      billableMinutes: timeData.billableMinutes ?? 0,
    },
    members: memberData.members ?? [],
    invitations: memberData.invitations ?? [],
    forms,
    invoices,
    customFields,
  };
}
