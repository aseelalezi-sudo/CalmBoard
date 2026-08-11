import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { ApiError } from "@/lib/client-api";
import type {
  Activity,
  Attachment,
  AuthorizationCapabilities,
  Automation,
  AutomationRun,
  Comment,
  CustomField,
  Doc,
  Form,
  Goal,
  Invitation,
  Invoice,
  Member,
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
import {
  getCurrentSession,
  getNotifications,
  getProjects,
  getWorkspaceDirectory,
  getWorkspaceModules,
} from "@/features/workspace/api";

type Translator = (arabic: string, english: string) => string;
type Notify = (message: string, kind?: "success" | "error") => void;

export function useWorkspaceData(t: Translator, notify: Notify) {
  const queryClient = useQueryClient();
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [activeWorkspace, setActiveWorkspace] = useState<Workspace | null>(null);
  const [activeOrg, setActiveOrg] = useState<Organization | null>(null);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authorization, setAuthorization] = useState<AuthorizationCapabilities | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [subtasks, setSubtasks] = useState<Task[]>([]);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [timeLogs, setTimeLogs] = useState<TimeLog[]>([]);
  const [timesheets, setTimesheets] = useState<Timesheet[]>([]);
  const [timesheetReviewQueue, setTimesheetReviewQueue] = useState<Timesheet[]>([]);
  const [timeTotals, setTimeTotals] = useState({ totalMinutes: 0, billableMinutes: 0 });
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [automationRuns, setAutomationRuns] = useState<AutomationRun[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [forms, setForms] = useState<Form[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [notifications, setNotifications] = useState<import("@/lib/types").Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [dataError, setDataError] = useState<string | null>(null);

  const loadWorkspaceModules = useCallback(async (workspaceId: string, organizationId?: string, userId?: string) => {
    const modules = await getWorkspaceModules(workspaceId, organizationId, userId);
    setAuthorization(modules.authorization);
    setDocs(modules.docs);
    setGoals(modules.goals);
    setAutomations(modules.automations);
    setAutomationRuns(modules.automationRuns);
    setActivities(modules.activities);
    setSavedViews(modules.savedViews);
    setTimeLogs(modules.timeLogs);
    setTimesheets(modules.timesheets);
    setTimesheetReviewQueue(modules.timesheetReviewQueue);
    setTimeTotals(modules.timeTotals);
    setMembers(modules.members);
    setInvitations(modules.invitations);
    setForms(modules.forms);
    setInvoices(modules.invoices);
    setCustomFields(modules.customFields);
  }, []);

  const refreshWorkspaceScope = useCallback(
    async (organizationId: string, workspaceId: string, projectId: string | undefined, userId: string) => {
      const workspaceProjects = await getProjects(organizationId, workspaceId);
      setProjects(workspaceProjects);
      const project = workspaceProjects.find((candidate) => candidate.id === projectId) ?? workspaceProjects[0] ?? null;
      setActiveProject(project);
      const [userNotifications] = await Promise.all([
        getNotifications(userId, organizationId, workspaceId),
        loadWorkspaceModules(workspaceId, organizationId, userId),
      ]);
      setNotifications(userNotifications);
    },
    [loadWorkspaceModules],
  );

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setDataError(null);
      const auth = await queryClient.fetchQuery({
        queryKey: ["auth", "session"],
        queryFn: getCurrentSession,
        staleTime: 0,
      });
      const authenticatedUser = auth?.user;
      if (authenticatedUser) setCurrentUser(authenticatedUser);
      const directory = authenticatedUser
        ? await queryClient.fetchQuery({
            queryKey: ["workspaces", authenticatedUser.id],
            queryFn: () => getWorkspaceDirectory(authenticatedUser.id),
          })
        : { workspaces: [], organizations: [], users: [], teams: [] };

      if (!directory.workspaces?.length) return;

      setWorkspaces(directory.workspaces);
      setOrganizations(directory.organizations || []);
      setUsers(directory.users || []);
      setTeams(directory.teams || []);

      const workspace = directory.workspaces[0];
      const organization =
        directory.organizations?.find((candidate) => candidate.id === workspace.organizationId) ??
        directory.organizations?.[0];
      const user = directory.users?.find((candidate) => candidate.id === authenticatedUser?.id) ?? directory.users?.[0];

      setActiveWorkspace(workspace);
      if (organization) setActiveOrg(organization);
      if (user) {
        setCurrentUser(user);
        if (organization) {
          const userNotifications = await getNotifications(user.id, organization.id, workspace.id);
          if (Array.isArray(userNotifications)) setNotifications(userNotifications);
        }
      }

      const workspaceProjects = organization ? await getProjects(organization.id, workspace.id) : [];
      if (Array.isArray(workspaceProjects) && workspaceProjects.length) {
        setProjects(workspaceProjects);
        setActiveProject(workspaceProjects[0]);
      }
      await loadWorkspaceModules(workspace.id, organization?.id, user?.id);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setCurrentUser(null);
        setAuthorization(null);
        queryClient.removeQueries({ queryKey: ["auth", "session"] });
        return;
      }
      console.error(error);
      const message = error instanceof Error ? error.message : t("تعذر تحميل البيانات", "Failed to load data");
      setDataError(message);
      notify(message, "error");
    } finally {
      setLoading(false);
    }
  }, [loadWorkspaceModules, notify, queryClient, t]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  return {
    activeProject,
    setActiveProject,
    activeWorkspace,
    setActiveWorkspace,
    activeOrg,
    setActiveOrg,
    currentUser,
    setCurrentUser,
    authorization,
    users,
    setUsers,
    workspaces,
    setWorkspaces,
    organizations,
    setOrganizations,
    projects,
    setProjects,
    tasks,
    setTasks,
    teams,
    setTeams,
    comments,
    setComments,
    subtasks,
    setSubtasks,
    docs,
    setDocs,
    goals,
    setGoals,
    timeLogs,
    setTimeLogs,
    timesheets,
    setTimesheets,
    timesheetReviewQueue,
    setTimesheetReviewQueue,
    timeTotals,
    setTimeTotals,
    automations,
    setAutomations,
    automationRuns,
    setAutomationRuns,
    activities,
    setActivities,
    members,
    setMembers,
    invitations,
    setInvitations,
    savedViews,
    setSavedViews,
    forms,
    setForms,
    invoices,
    setInvoices,
    customFields,
    setCustomFields,
    attachments,
    setAttachments,
    notifications,
    setNotifications,
    loading,
    dataError,
    loadWorkspaceModules,
    refreshWorkspaceScope,
    reload: fetchData,
  };
}
