"use client";
import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import type { Doc, Notification, SavedView, Task, ViewCtx } from "@/lib/types";
import { STATUS_CONFIG, PRIORITY_CONFIG, STATUS_ORDER } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge, Avatar, Kbd, Bar } from "@/components/ui";
import {
  LogoMark,
  IconBoard,
  IconTable,
  IconDash,
  IconInbox,
  IconMyWork,
  IconSearch,
  IconBell,
  IconPlus,
  IconX,
  IconCheck,
  IconSparkle,
  IconSave,
  IconShare,
  IconCollapse,
  IconFolder,
} from "@/components/icons";
import { AuthScreen } from "@/features/auth/auth-screen";
import { useAuthOperations } from "@/features/auth/use-auth-operations";
import { AIPanel } from "@/features/ai/ai-panel";
import { useAiOperations } from "@/features/ai/use-ai-operations";
import { useCommentOperations } from "@/features/comments/use-comment-operations";
import { CommandPalette } from "@/features/search/command-palette";
import { TaskDrawer } from "@/features/tasks/task-drawer";
import { useTaskPagination } from "@/features/tasks/use-task-pagination";
import { useTaskOperations } from "@/features/tasks/use-task-operations";
import {
  InviteModal,
  NewAutomationModal,
  NewDocModal,
  NewGoalModal,
  NewProjectModal,
  NewTaskModal,
  NewWorkspaceModal,
  SaveViewModal,
} from "@/features/creation/create-modals";
import { QuickGuideModal } from "@/components/quick-guide";
import { OnboardingChecklist } from "@/features/onboarding/onboarding-checklist";
import { TelemetryModal } from "@/components/telemetry-modal";
import { KeyboardShortcutsModal } from "@/components/keyboard-shortcuts";
import { NAV_ADMIN, NAV_SPACE, NAV_TOOLS, NAV_WORK, VIEW_TABS } from "@/features/shell/navigation";
import { ActiveView } from "@/features/shell/active-view";
import { LoadingScreen } from "@/features/shell/loading-screen";
import { useWorkspaceData } from "@/features/workspace/use-workspace-data";
import { WorkspaceSwitcherDropdown } from "@/features/shell/workspace-switcher-dropdown";
import { UserProfileDropdown } from "@/features/shell/user-profile-dropdown";
import { ProjectSwitcherDropdown } from "@/features/shell/project-switcher-dropdown";
import { canOpenWorkspaceView as isWorkspaceViewVisible } from "@/features/shell/authorization-visibility";
import { useContentOperations } from "@/features/workspace/use-content-operations";
import { useWorkspaceOperations } from "@/features/workspace/use-workspace-operations";
import { useTimesheetOperations } from "@/features/time/use-timesheet-operations";
import { useRealtime } from "@/features/realtime/use-realtime";
import { useUiStore } from "@/stores/ui-store";
import { currentSavedViewConfiguration, useTaskViewStateStore } from "@/stores/task-view-state-store";
import { telemetryUiEnabled } from "@/lib/feature-flags";
import { useSavedViewOperations } from "./use-saved-view-operations";

export function CalmBoardApp() {
  const { logout } = useAuthOperations();
  const locale = useUiStore((state) => state.locale);
  const theme = useUiStore((state) => state.theme);
  const collapsed = useUiStore((state) => state.collapsed);
  const activeView = useUiStore((state) => state.activeView);
  const hydratePreferences = useUiStore((state) => state.hydratePreferences);
  const setCollapsed = useUiStore((state) => state.setCollapsed);
  const setActiveView = useUiStore((state) => state.setActiveView);
  const toggleLocale = useUiStore((state) => state.toggleLocale);
  const taskTableViewState = useTaskViewStateStore((state) => state.table);
  const applyTaskViewConfiguration = useTaskViewStateStore((state) => state.apply);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showNotif, setShowNotif] = useState(false);
  const [showAI, setShowAI] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [showTelemetry, setShowTelemetry] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [taskDetail, setTaskDetail] = useState<Task | null>(null);

  const [showAddTask, setShowAddTask] = useState(false);
  const [showAddProject, setShowAddProject] = useState(false);
  const [showNewDoc, setShowNewDoc] = useState(false);
  const [showNewGoal, setShowNewGoal] = useState(false);

  const notifRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (showNotif && notifRef.current && !notifRef.current.contains(event.target as Node)) {
        setShowNotif(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [showNotif]);

  const [showNewAutomation, setShowNewAutomation] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [showSaveView, setShowSaveView] = useState(false);
  const [activeDoc, setActiveDoc] = useState<Doc | null>(null);

  const [taskFilter, setTaskFilter] = useState<Record<string, string | undefined>>({});
  const [toast, setToast] = useState<{ msg: string; kind: "success" | "error" } | null>(null);

  const [timerTask, setTimerTask] = useState<string | null>(null);
  const [timerSeconds, setTimerSeconds] = useState(0);
  const [timerRunning, setTimerRunning] = useState(false);
  const [showAddWorkspace, setShowAddWorkspace] = useState(false);

  const isRTL = locale === "ar";
  const t = useCallback((ar: string, en: string) => (locale === "ar" ? ar : en), [locale]);

  const notify = useCallback((msg: string, kind: "success" | "error" = "success") => {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 3200);
  }, []);

  const {
    activeProject,
    setActiveProject,
    activeWorkspace,
    setActiveWorkspace,
    activeOrg,
    setActiveOrg,
    currentUser,
    authorization,
    users,
    setUsers,
    workspaces,
    setWorkspaces,
    organizations,
    projects,
    setProjects,
    tasks,
    setTasks,
    notifications,
    setNotifications,
    comments,
    setComments,
    subtasks,
    setSubtasks,
    docs,
    setDocs,
    goals,
    setGoals,
    timeLogs,
    timeTotals,
    timesheets,
    setTimesheets,
    timesheetReviewQueue,
    setTimesheetReviewQueue,
    automations,
    setAutomations,
    automationRuns,
    setAutomationRuns,
    activities,
    members,
    setMembers,
    invitations,
    setInvitations,
    savedViews,
    setSavedViews,
    forms,
    setForms,
    invoices,
    customFields,
    setCustomFields,
    attachments,
    setAttachments,
    loading,
    dataError,
    loadWorkspaceModules,
    refreshWorkspaceScope,
    reload,
  } = useWorkspaceData(t, notify);
  const { refresh: refreshTaskPages, pagination: taskPagination } = useTaskPagination({
    activeProject,
    activeView,
    taskFilter,
    tableState: taskTableViewState,
    setTasks,
    notify,
    t,
  });
  const { updateSavedView, deleteSavedView } = useSavedViewOperations({
    organizationId: activeOrg?.id,
    workspaceId: activeWorkspace?.id,
    actorId: currentUser?.id,
    setSavedViews,
    t,
    notify,
  });
  const canCreateTasks = authorization?.permissions.includes("tasks.create") ?? false;
  const visibleSavedViews = useMemo(
    () => savedViews.filter((view) => !view.projectId || (activeProject && view.projectId === activeProject.id)),
    [activeProject, savedViews],
  );
  const applySavedView = useCallback(
    (view: SavedView, announce = true) => {
      setTaskFilter(view.filters ?? {});
      setActiveView(view.viewType);
      if (view.viewType === "table" && view.configuration) applyTaskViewConfiguration(view.configuration);
      if (announce) notify(`${t("طُبّق", "Applied")}: ${view.name}`);
    },
    [applyTaskViewConfiguration, notify, setActiveView, t],
  );
  const appliedDefaultProject = useRef<string | null>(null);

  useEffect(() => {
    if (!activeProject || appliedDefaultProject.current === activeProject.id) return;
    const defaultView = visibleSavedViews.find(
      (view) => view.projectId === activeProject.id && view.createdBy === currentUser?.id && view.isDefault,
    );
    if (!defaultView) return;
    appliedDefaultProject.current = activeProject.id;
    applySavedView(defaultView, false);
  }, [activeProject, applySavedView, currentUser?.id, visibleSavedViews]);

  /* ---------- boot ---------- */
  useEffect(() => {
    hydratePreferences();
    if (window.innerWidth < 1100) setCollapsed(true);
  }, [hydratePreferences, setCollapsed]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((o) => !o);
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "n") {
        e.preventDefault();
        if (canCreateTasks) setShowAddTask(true);
      }
      if (
        e.key === "?" &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !["INPUT", "TEXTAREA", "SELECT"].includes((e.target as HTMLElement)?.tagName || "")
      ) {
        e.preventDefault();
        setShowShortcuts((o) => !o);
      }
      if (e.key === "Escape") {
        setSearchOpen(false);
        setTaskDetail(null);
        setShowNotif(false);
        setShowAI(false);
        setShowShortcuts(false);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [canCreateTasks]);

  useEffect(() => {
    if (!timerRunning) return;
    const i = setInterval(() => setTimerSeconds((s) => s + 1), 1000);
    return () => clearInterval(i);
  }, [timerRunning]);

  /* ---------- derived ---------- */
  const filteredTasks = useMemo(() => {
    let arr = [...tasks];
    if (taskFilter.status) arr = arr.filter((x) => x.status === taskFilter.status);
    if (taskFilter.priority) arr = arr.filter((x) => x.priority === taskFilter.priority);
    if (taskFilter.assignee) arr = arr.filter((x) => x.assigneeId === taskFilter.assignee);
    if (taskFilter.search) {
      const q = taskFilter.search.toLowerCase();
      arr = arr.filter((x) => x.title.toLowerCase().includes(q) || x.serial.toLowerCase().includes(q));
    }
    return arr;
  }, [tasks, taskFilter]);

  const groupedByStatus = useMemo(() => {
    const g: Record<string, Task[]> = {};
    STATUS_ORDER.forEach((s) => (g[s] = []));
    filteredTasks.forEach((x) => (g[x.status] ? g[x.status].push(x) : g.backlog.push(x)));
    return g;
  }, [filteredTasks]);

  const stats = useMemo(() => {
    const paginated = taskPagination.mode === "page" || taskPagination.mode === "board";
    const total = paginated ? taskPagination.total : tasks.length;
    const done =
      taskPagination.mode === "board"
        ? (taskPagination.statusTotals.done ?? 0)
        : tasks.filter((x) => x.status === "done").length;
    const inProgress =
      taskPagination.mode === "board"
        ? (taskPagination.statusTotals.in_progress ?? 0)
        : tasks.filter((x) => x.status === "in_progress").length;
    const overdue = tasks.filter((x) => x.dueDate && new Date(x.dueDate) < new Date() && x.status !== "done").length;
    return { total, done, inProgress, overdue, progress: total ? Math.round((done / total) * 100) : 0 };
  }, [taskPagination.mode, taskPagination.statusTotals, taskPagination.total, tasks]);

  const refreshRealtimeData = useCallback(async () => {
    if (!activeOrg || !activeWorkspace || !currentUser) return;
    await refreshWorkspaceScope(activeOrg.id, activeWorkspace.id, activeProject?.id, currentUser.id);
    await refreshTaskPages();
  }, [activeOrg, activeWorkspace, activeProject, currentUser, refreshTaskPages, refreshWorkspaceScope]);
  const realtimeScope = useMemo(
    () =>
      activeOrg && activeWorkspace
        ? {
            organizationId: activeOrg.id,
            workspaceId: activeWorkspace.id,
            ...(activeProject ? { projectId: activeProject.id } : {}),
          }
        : undefined,
    [activeOrg, activeWorkspace, activeProject],
  );
  const { status: realtimeStatus, presence } = useRealtime({
    enabled: Boolean(currentUser),
    scope: realtimeScope,
    onInvalidate: refreshRealtimeData,
  });

  const {
    input: aiInput,
    setInput: setAiInput,
    result: aiResult,
    setResult: setAiResult,
    error: aiError,
    loading: aiLoading,
    run: runAI,
    proposal: aiProposal,
    proposalLoading: aiProposalLoading,
    approve: approveAIProposal,
    reject: rejectAIProposal,
  } = useAiOperations(
    activeOrg && activeWorkspace
      ? {
          organizationId: activeOrg.id,
          workspaceId: activeWorkspace.id,
          actorId: currentUser?.id,
          projectId: activeProject?.id,
        }
      : undefined,
  );

  const {
    refreshTasks,
    updateTask,
    moveTask,
    updateProjectWipLimit,
    createTask,
    openTask,
    openTaskById,
    addSubtask,
    toggleSubtask,
    logTime,
    addAttachment,
  } = useTaskOperations({
    activeProject,
    activeWorkspace,
    activeOrg,
    currentUser,
    tasks,
    taskDetail,
    setTasks,
    setProjects,
    setActiveProject,
    setTaskDetail,
    setComments,
    setSubtasks,
    setAttachments,
    setAutomations,
    setAutomationRuns,
    setShowAddTask,
    loadWorkspaceModules,
    reloadTasks: refreshTaskPages,
    t,
    notify,
  });

  const { addComment, toggleReaction, togglePinComment, deleteComment, editComment } = useCommentOperations({
    taskDetail,
    currentUser,
    activeOrg,
    activeWorkspace,
    comments,
    setComments,
    t,
    notify,
  });

  const { patchDoc, addGoalCheckin, linkGoalTask, unlinkGoalTask, toggleAutomation } = useContentOperations({
    currentUser,
    activeOrg,
    activeWorkspace,
    setActiveDoc,
    setDocs,
    setGoals,
    setAutomations,
    t,
    notify,
  });

  const {
    switchProject,
    switchWorkspace,
    markAllRead,
    markAsRead,
    updateMemberRole,
    resendInvitation,
    revokeInvitation,
    updateUserSkills,
    updateWorkspace,
    createWorkspace,
    updateProject,
    archiveProject,
    restoreProject,
    deleteProject,
    createCustomField,
    deleteCustomField,
    createForm,
    updateForm,
    toggleForm,
  } = useWorkspaceOperations({
    activeWorkspace,
    activeOrg,
    activeProject,
    currentUser,
    organizations,
    setActiveWorkspace,
    setActiveOrg,
    setActiveProject,
    setProjects,
    setTasks,
    setWorkspaces,
    setUsers,
    setMembers,
    setInvitations,
    setCustomFields,
    setForms,
    setNotifications,
    setActiveView,
    loadWorkspaceModules,
    t,
    notify,
  });
  const { submitTimesheet, reviewTimesheet } = useTimesheetOperations({
    activeOrg,
    activeWorkspace,
    currentUser,
    setTimesheets,
    setTimesheetReviewQueue,
    t,
    notify,
  });

  /* ---------- actions ---------- */
  /* ---------- ctx for views ---------- */
  const can = (permission: string) => authorization?.permissions.includes(permission) ?? false;
  const canOpenWorkspaceView = (view: string) => isWorkspaceViewVisible(view, can);
  const denyMutation = () =>
    notify(t("ليس لديك صلاحية لتنفيذ هذا الإجراء", "You do not have permission to perform this action"), "error");
  const permissionModal = (permission: string, setter: (value: boolean) => void) => (value: boolean) => {
    if (!value || can(permission)) setter(value);
    else denyMutation();
  };
  const openNotification = (notification: Notification) => {
    if (!notification.isRead) markAsRead(notification.id);
    if (notification.entityType === "task" && notification.entityId) {
      const loadedTask = tasks.find((task) => task.id === notification.entityId);
      if (loadedTask) setTaskDetail(loadedTask);
      else if (activeOrg && activeWorkspace) {
        void openTaskById({
          id: notification.entityId,
          organizationId: activeOrg.id,
          workspaceId: activeWorkspace.id,
        });
      }
      return;
    }
    if (notification.entityType === "project" && notification.entityId) {
      const project = projects.find((item) => item.id === notification.entityId);
      if (project) switchProject(project);
      return;
    }
    if (notification.actionPath?.startsWith("/") && !notification.actionPath.startsWith("//")) {
      const target = new URL(notification.actionPath, window.location.origin);
      const view = target.searchParams.get("view");
      if (view && canOpenWorkspaceView(view)) setActiveView(view);
      else window.location.assign(`${target.pathname}${target.search}${target.hash}`);
    }
  };
  const ctx: ViewCtx = {
    locale,
    t,
    users,
    currentUser,
    authorization,
    can,
    tasks: filteredTasks,
    projects,
    workspaces,
    workspaceDataError: dataError,
    activeWorkspace,
    activeProject,
    goals,
    docs,
    timeLogs,
    timeTotals,
    timesheets,
    timesheetReviewQueue,
    automations,
    automationRuns,
    activities,
    members,
    invitations,
    notifications,
    openNotification,
    savedViews,
    stats,
    groupedByStatus,
    taskPagination,
    timerSeconds,
    timerRunning,
    timerTask,
    setTimerTask,
    setTimerRunning,
    openTask,
    setTaskSprintMembership: (taskId, sprintId) =>
      setTasks((current) => current.map((task) => (task.id === taskId ? { ...task, sprintId } : task))),
    refreshProjectTasks: refreshTasks,
    updateTask: can("tasks.update")
      ? updateTask
      : () => {
          denyMutation();
          return false;
        },
    moveTask: can("tasks.update") ? moveTask : async () => denyMutation(),
    setProjectWipLimit: can("projects.update") ? updateProjectWipLimit : async () => denyMutation(),
    createTask: can("tasks.create") ? createTask : () => denyMutation(),
    setTaskFilter,
    setShowAddTask: permissionModal("tasks.create", setShowAddTask),
    setShowNewDoc: permissionModal("documents.manage", setShowNewDoc),
    setShowNewGoal: permissionModal("goals.manage", setShowNewGoal),
    switchProject,
    switchWorkspace,
    updateProject: can("projects.update") ? updateProject : async () => denyMutation(),
    archiveProject: can("projects.delete") ? archiveProject : async () => denyMutation(),
    restoreProject: can("projects.delete") ? restoreProject : async () => denyMutation(),
    deleteProject: can("projects.delete") ? deleteProject : async () => denyMutation(),
    setShowAddProject: permissionModal("projects.create", setShowAddProject),
    setShowAddWorkspace: permissionModal("workspace.manage", setShowAddWorkspace),
    activeView,
    setShowNewAutomation: permissionModal("automations.manage", setShowNewAutomation),
    setShowInvite: permissionModal("members.invite", setShowInvite),
    setShowSaveView: permissionModal("saved_views.manage", setShowSaveView),
    setActiveDoc,
    activeDoc,
    patchDoc,
    addGoalCheckin: can("goals.manage") ? addGoalCheckin : () => denyMutation(),
    linkGoalTask: can("goals.manage") ? linkGoalTask : () => denyMutation(),
    unlinkGoalTask: can("goals.manage") ? unlinkGoalTask : () => denyMutation(),
    toggleAutomation: can("automations.manage") ? toggleAutomation : () => denyMutation(),
    updateMemberRole: can("members.manage") ? updateMemberRole : () => denyMutation(),
    resendInvitation: can("members.invite") ? resendInvitation : async () => denyMutation(),
    revokeInvitation: can("members.manage") ? revokeInvitation : async () => denyMutation(),
    updateUserSkills,
    updateWorkspace: can("workspace.manage") ? updateWorkspace : () => denyMutation(),
    createCustomField: can("custom_fields.manage") ? createCustomField : () => denyMutation(),
    deleteCustomField: can("custom_fields.manage") ? deleteCustomField : () => denyMutation(),
    logTime: can("time_logs.manage") ? logTime : () => denyMutation(),
    submitTimesheet: can("time_logs.manage") ? submitTimesheet : () => denyMutation(),
    reviewTimesheet: can("timesheets.review") ? reviewTimesheet : () => denyMutation(),
    activeOrg,
    taskFilter,
    setActiveView,
    forms,
    invoices,
    createForm: can("forms.manage") ? createForm : () => denyMutation(),
    updateForm: can("forms.manage") ? updateForm : () => denyMutation(),
    toggleForm: can("forms.manage") ? toggleForm : () => denyMutation(),
    customFields,
    attachments,
    addAttachment: can("attachments.manage")
      ? addAttachment
      : async () => {
          denyMutation();
        },
    toggleReaction: can("comments.manage") ? toggleReaction : () => denyMutation(),
    togglePinComment: can("comments.manage") ? togglePinComment : () => denyMutation(),
    deleteComment: can("comments.manage") ? deleteComment : () => denyMutation(),
    notify,
  };

  /* ---------- loading ---------- */
  if (loading) {
    return <LoadingScreen message={t("جاري تجهيز مساحة العمل…", "Preparing your workspace…")} />;
  }

  if (!currentUser) {
    return <AuthScreen onAuthenticated={reload} />;
  }

  const unread = notifications.filter((n) => !n.isRead).length;

  return (
    <div className="app-bg flex min-h-screen text-[14px]" dir={isRTL ? "rtl" : "ltr"}>
      {/* ============ SIDEBAR ============ */}
      <aside
        className={cn(
          "sticky top-0 z-30 hidden h-screen shrink-0 flex-col border-e border-slate-200/80 bg-white/90 backdrop-blur-xl transition-all duration-300 dark:border-white/6 dark:bg-[#0a0a11]/90 lg:flex",
          collapsed ? "w-[74px]" : "w-[280px]",
        )}
      >
        {/* Workspace Switcher Header */}
        <WorkspaceSwitcherDropdown
          activeOrg={activeOrg}
          activeWorkspace={activeWorkspace}
          workspaces={workspaces}
          switchWorkspace={switchWorkspace}
          collapsed={collapsed}
          setCollapsed={setCollapsed}
          onAddWorkspace={() => setShowAddWorkspace(true)}
          canManageWorkspace={can("workspace.manage")}
          t={t}
        />

        <div className="flex-1 space-y-6 overflow-y-auto px-3 py-4">
          {!collapsed && (
            <button
              disabled={!can("tasks.create")}
              onClick={() => ctx.setShowAddTask(true)}
              className="group flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-linear-to-r from-indigo-500 to-violet-500 text-[13px] font-semibold text-white shadow-[0_4px_20px_rgba(99,102,241,0.3)] transition hover:shadow-[0_4px_28px_rgba(139,92,246,0.38)] hover:brightness-105"
            >
              <IconPlus size={15} />
              {t("مهمة جديدة", "New Task")}
              <Kbd>⌘N</Kbd>
            </button>
          )}

          <nav>
            {!collapsed && (
              <div className="mb-2 px-2 text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-zinc-600">
                {t("العمل", "Work")}
              </div>
            )}
            <ul className="space-y-1">
              {NAV_WORK.map(({ id, ar, en, Icon }) => (
                <li key={id}>
                  <button
                    onClick={() => setActiveView(id)}
                    title={t(ar, en)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-xl px-3 py-2 text-[13px] transition",
                      activeView === id
                        ? "bg-slate-100 font-semibold text-slate-900 dark:bg-white/[0.07] dark:text-white shadow-[inset_2px_0_0_#06b6d4] dark:shadow-[inset_2px_0_0_#22d3ee]"
                        : "text-slate-500 hover:bg-slate-50 hover:text-slate-900 dark:text-zinc-500 dark:hover:bg-white/4 dark:hover:text-zinc-200",
                    )}
                  >
                    <Icon size={16} className={activeView === id ? "text-indigo-600 dark:text-violet-300" : ""} />
                    {!collapsed && <span className="flex-1 text-start">{t(ar, en)}</span>}
                    {!collapsed && id === "inbox" && unread > 0 && (
                      <span className="grid h-5 min-w-5 place-items-center rounded-full bg-linear-to-r from-indigo-500 to-violet-500 px-1 text-[10px] font-bold text-white tabular">
                        {unread}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          {/* Project nav moved to header dropdown */}

          <nav>
            {!collapsed && (
              <div className="mb-2 px-2 text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-zinc-600">
                {t("مساحة العمل", "Workspace")}
              </div>
            )}
            <ul className="space-y-1">
              {NAV_SPACE.filter(({ id }) => canOpenWorkspaceView(id)).map(({ id, ar, en, Icon }) => (
                <li key={id}>
                  <button
                    onClick={() => setActiveView(id)}
                    title={t(ar, en)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-xl px-3 py-2 text-[13px] transition",
                      activeView === id
                        ? "bg-slate-100 font-semibold text-slate-900 dark:bg-white/[0.07] dark:text-white shadow-[inset_2px_0_0_#6366f1] dark:shadow-[inset_2px_0_0_#818cf8]"
                        : "text-slate-500 hover:bg-slate-50 hover:text-slate-900 dark:text-zinc-500 dark:hover:bg-white/4 dark:hover:text-zinc-200",
                    )}
                  >
                    <Icon size={16} className={activeView === id ? "text-indigo-600 dark:text-indigo-300" : ""} />
                    {!collapsed && <span className="flex-1 text-start">{t(ar, en)}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          {NAV_TOOLS.filter(({ id }) => canOpenWorkspaceView(id)).length > 0 && (
            <nav>
              {!collapsed && (
                <div className="mb-2 px-2 text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-zinc-600">
                  {t("الأدوات", "Tools")}
                </div>
              )}
              <ul className="space-y-1">
                {NAV_TOOLS.filter(({ id }) => canOpenWorkspaceView(id)).map(({ id, ar, en, Icon }) => (
                  <li key={id}>
                    <button
                      onClick={() => setActiveView(id)}
                      title={t(ar, en)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-xl px-3 py-2 text-[13px] transition",
                        activeView === id
                          ? "bg-slate-100 font-semibold text-slate-900 shadow-[inset_2px_0_0_#8b5cf6] dark:bg-white/[0.07] dark:text-white"
                          : "text-slate-500 hover:bg-slate-50 hover:text-slate-900 dark:text-zinc-500 dark:hover:bg-white/4 dark:hover:text-zinc-200",
                      )}
                    >
                      <Icon size={16} className={activeView === id ? "text-violet-600 dark:text-violet-300" : ""} />
                      {!collapsed && <span className="flex-1 text-start">{t(ar, en)}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </nav>
          )}

          {NAV_ADMIN.filter(({ id }) => canOpenWorkspaceView(id)).length > 0 && (
            <nav>
              {!collapsed && (
                <div className="mb-2 px-2 text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-zinc-600">
                  {t("الإدارة", "Administration")}
                </div>
              )}
              <ul className="space-y-1">
                {NAV_ADMIN.filter(({ id }) => canOpenWorkspaceView(id)).map(({ id, ar, en, Icon }) => (
                  <li key={id}>
                    <button
                      onClick={() => setActiveView(id)}
                      title={t(ar, en)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-xl px-3 py-2 text-[13px] transition",
                        activeView === id
                          ? "bg-slate-100 font-semibold text-slate-900 shadow-[inset_2px_0_0_#64748b] dark:bg-white/[0.07] dark:text-white"
                          : "text-slate-500 hover:bg-slate-50 hover:text-slate-900 dark:text-zinc-500 dark:hover:bg-white/4 dark:hover:text-zinc-200",
                      )}
                    >
                      <Icon size={16} className={activeView === id ? "text-slate-700 dark:text-zinc-200" : ""} />
                      {!collapsed && <span className="flex-1 text-start">{t(ar, en)}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </nav>
          )}
        </div>

        <div className="shrink-0 border-t border-line bg-surface/80 p-3">
          <UserProfileDropdown
            currentUser={currentUser}
            collapsed={collapsed}
            setActiveView={setActiveView}
            setShowGuide={setShowGuide}
            setShowTelemetry={setShowTelemetry}
            telemetryUiEnabled={telemetryUiEnabled}
            t={t}
          />
        </div>
      </aside>

      {/* ============ MAIN ============ */}
      <main className="relative z-40 flex min-w-0 flex-1 flex-col">
        {/* topbar */}
        <header className="sticky top-0 z-40 flex h-16 items-center gap-2 border-b border-line/50 bg-surface/80 px-3 backdrop-blur-2xl shadow-[0_4px_30px_rgba(0,0,0,0.03)] dark:shadow-[0_4px_30px_rgba(0,0,0,0.2)] transition-colors sm:gap-3 lg:px-6">
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <ProjectSwitcherDropdown
              activeOrg={activeOrg}
              activeWorkspace={activeWorkspace}
              activeProject={activeProject}
              projects={projects}
              switchProject={switchProject}
              onAddProject={() => setShowAddProject(true)}
              canCreateProject={can("projects.create")}
              stats={stats}
              t={t}
            />
            <div className="hidden min-w-0 items-center gap-2 border-s border-line ps-4 ms-2 xl:flex">
              <div className="flex -space-x-1.5 overflow-hidden rtl:space-x-reverse">
                {presence.slice(0, 4).map((u) => (
                  <div
                    key={u.id}
                    className="relative inline-block h-6 w-6 shrink-0 rounded-full ring-2 ring-surface"
                    title={`${u.name} (${t("متصل الآن", "online")})`}
                  >
                    <Avatar src={u.avatarUrl} name={u.name} size={24} />
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-ink-soft">
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    realtimeStatus === "connected" ? "live-dot bg-emerald-500" : "bg-ink-faint",
                  )}
                />
                <span className="whitespace-nowrap">
                  {realtimeStatus === "connected"
                    ? `${presence.length} ${t("متصلون", "online")}`
                    : t("جاري الاتصال", "connecting")}
                </span>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            aria-label={t("فتح البحث العام", "Open global search")}
            className="group hidden h-9 min-w-[220px] max-w-[360px] flex-1 items-center gap-2.5 rounded-xl border border-line bg-raised/50 px-3 text-[12.5px] text-ink-soft transition-all duration-300 hover:bg-surface hover:text-ink hover:shadow-sm hover:ring-1 hover:ring-accent/20 focus-visible:ring-2 focus-visible:ring-accent md:flex"
          >
            <IconSearch size={14} className="transition-transform group-hover:scale-110 group-hover:text-accent" />
            <span className="flex-1 truncate text-start">{t("ابحث في كل شيء…", "Search everything…")}</span>
            <Kbd className="transition-opacity group-hover:opacity-100 opacity-70">⌘K</Kbd>
          </button>
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            aria-label={t("فتح البحث العام", "Open global search")}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-transparent text-ink-soft transition-all duration-300 hover:bg-raised/70 hover:text-ink hover:shadow-sm active:scale-95 md:hidden"
          >
            <IconSearch size={15} />
          </button>

          <button
            type="button"
            disabled={!can("tasks.create") || !activeProject}
            onClick={() => ctx.setShowAddTask(true)}
            title={t("إنشاء مهمة", "Create task")}
            aria-label={t("إنشاء مهمة", "Create task")}
            className="group relative grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-linear-to-r from-indigo-500 to-violet-500 text-white shadow-[0_4px_16px_rgba(99,102,241,0.3)] transition-all duration-300 hover:scale-[1.02] hover:shadow-[0_4px_24px_rgba(99,102,241,0.45)] hover:brightness-110 active:scale-95 disabled:pointer-events-none disabled:opacity-45 sm:w-auto sm:px-3 sm:text-[12.5px] sm:font-semibold"
          >
            <div className="absolute inset-0 rounded-xl bg-white/20 opacity-0 transition-opacity group-hover:opacity-100 mix-blend-overlay" />
            <IconPlus size={15} className="relative z-10" />
            <span className="relative z-10 hidden sm:ms-1.5 sm:inline">{t("مهمة", "Task")}</span>
          </button>

          <div className="relative" ref={notifRef}>
            <button
              type="button"
              onClick={() => {
                setShowNotif(!showNotif);
              }}
              aria-label={t("فتح الإشعارات", "Open notifications")}
              className={cn(
                "relative grid h-9 w-9 shrink-0 place-items-center rounded-xl border text-ink-soft transition-all duration-300 hover:text-ink active:scale-95",
                showNotif ? "border-line bg-raised shadow-sm" : "border-transparent bg-transparent hover:bg-raised/70",
              )}
            >
              <IconBell size={15} className={cn("transition-transform", showNotif && "scale-110 text-ink")} />
              {unread > 0 && (
                <>
                  <span className="absolute -end-1 -top-1 grid min-h-5 min-w-5 place-items-center rounded-full bg-linear-to-r from-indigo-500 to-rose-500 px-1 text-[9.5px] font-bold text-white tabular shadow-sm z-10">
                    {unread}
                  </span>
                  <span className="absolute -end-1 -top-1 min-h-5 min-w-5 animate-ping rounded-full bg-indigo-400 opacity-40" />
                </>
              )}
            </button>
            {showNotif && (
              <div className="animate-pop absolute end-0 top-12 z-50 w-[min(360px,calc(100vw-24px))] overflow-hidden rounded-2xl border border-line bg-surface shadow-xl backdrop-blur-xl dark:shadow-[0_24px_60px_rgba(0,0,0,0.6)]">
                <div className="flex items-center justify-between border-b border-slate-100 dark:border-white/[0.07] px-4 py-3">
                  <span className="text-[13.5px] font-semibold text-slate-900 dark:text-white">
                    {t("الإشعارات", "Notifications")}
                  </span>
                  <button
                    onClick={markAllRead}
                    className="text-[11.5px] text-indigo-600 hover:text-indigo-800 dark:text-violet-300 transition dark:hover:text-violet-200"
                  >
                    {t("قراءة الكل", "Mark all read")}
                  </button>
                </div>
                <div className="max-h-[380px] divide-y divide-slate-100 dark:divide-white/5 overflow-y-auto">
                  {notifications.map((n) => (
                    <button
                      key={n.id}
                      type="button"
                      onClick={() => {
                        openNotification(n);
                        setShowNotif(false);
                      }}
                      className={cn(
                        "w-full text-start flex gap-3 px-4 py-3.5 transition-colors hover:bg-slate-50 dark:hover:bg-white/5",
                        !n.isRead && "bg-indigo-50/70 dark:bg-indigo-500/6",
                      )}
                    >
                      <span
                        className={cn(
                          "grid h-8 w-8 shrink-0 place-items-center rounded-lg border",
                          !n.isRead
                            ? "border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-300"
                            : "border-slate-200 bg-slate-50 text-slate-500 dark:border-white/10 dark:bg-white/4 dark:text-zinc-500",
                        )}
                      >
                        <IconBell size={13} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="text-[12.5px] font-medium text-slate-900 dark:text-zinc-200">{n.title}</div>
                        {n.body && (
                          <div className="mt-0.5 line-clamp-2 text-[11.5px] text-slate-500 dark:text-zinc-500">
                            {n.body}
                          </div>
                        )}
                        <div className="mt-1 text-[10px] text-slate-400 dark:text-zinc-600">
                          {new Date(n.createdAt).toLocaleString(locale === "ar" ? "ar-EG" : "en-US")}
                        </div>
                      </div>
                      {!n.isRead && (
                        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-500 dark:bg-cyan-400" />
                      )}
                    </button>
                  ))}
                  {notifications.length === 0 && (
                    <div className="px-4 py-10 text-center text-[12.5px] text-slate-500 dark:text-zinc-600">
                      {t("لا إشعارات", "No notifications")}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => setShowAI(true)}
            aria-label={t("فتح المساعد الذكي", "Open AI assistant")}
            className="group relative flex h-9 shrink-0 overflow-hidden items-center gap-1.5 rounded-xl border border-indigo-200/60 bg-indigo-50/50 px-2.5 text-[12.5px] font-semibold text-indigo-700 transition-all duration-300 hover:border-indigo-300 hover:bg-indigo-100/80 hover:shadow-[0_0_12px_rgba(99,102,241,0.15)] active:scale-95 dark:border-indigo-400/20 dark:bg-indigo-500/10 dark:text-violet-200 dark:hover:border-indigo-400/30 dark:hover:bg-indigo-500/20"
          >
            <div className="absolute inset-0 -translate-x-full bg-linear-to-r from-transparent via-indigo-400/20 to-transparent transition-transform duration-1000 group-hover:translate-x-full dark:via-white/10" />
            <IconSparkle size={14} className="relative z-10 transition-transform group-hover:scale-110" />
            <span className="relative z-10 hidden sm:inline">{t("مساعد", "AI")}</span>
          </button>
        </header>

        {/* content */}
        <div className="flex-1 p-4 lg:p-6 pb-24 lg:pb-8">
          <OnboardingChecklist
            organizationId={activeOrg?.id}
            workspaceId={activeWorkspace?.id}
            userId={currentUser?.id}
            t={t}
            onCreateProject={() => permissionModal("projects.create", setShowAddProject)(true)}
            onCreateTask={() => permissionModal("tasks.create", setShowAddTask)(true)}
            onInvite={() => permissionModal("members.invite", setShowInvite)(true)}
            onExploreBoard={() => setActiveView("board")}
          />
          {/* project header */}
          {activeProject &&
            ["board", "list", "table", "calendar", "timeline", "workload", "sprints", "sprint_board"].includes(
              activeView,
            ) && (
              <div className="mb-6">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-3">
                      <h1 className="font-display text-[22px] font-bold tracking-tight text-slate-900 dark:text-white">
                        {activeProject.name}
                      </h1>
                      <Badge tone="emerald">
                        <span className="live-dot h-1.5 w-1.5 rounded-full bg-emerald-400" />
                        {activeProject.status}
                      </Badge>
                    </div>
                    {activeProject.description && (
                      <p className="mt-1.5 max-w-[560px] text-[12.5px] leading-relaxed text-slate-500 dark:text-zinc-500">
                        {activeProject.description}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white/80 px-5 py-3.5 shadow-sm dark:border-white/[0.07] dark:bg-white/2.5 dark:shadow-none">
                    <div className="grid grid-cols-4 gap-4 text-center">
                      {[
                        { k: t("الكل", "Total"), v: stats.total, c: "text-slate-900 dark:text-white" },
                        { k: t("منجز", "Done"), v: stats.done, c: "text-emerald-600 dark:text-emerald-300" },
                        { k: t("نشط", "Active"), v: stats.inProgress, c: "text-amber-600 dark:text-amber-300" },
                        {
                          k: t("متأخر", "Overdue"),
                          v: stats.overdue,
                          c: stats.overdue ? "text-rose-600 dark:text-rose-400" : "text-slate-500 dark:text-zinc-500",
                        },
                      ].map((s, i) => (
                        <div key={i}>
                          <div className={cn("mono text-[19px] font-bold leading-none tabular", s.c)}>{s.v}</div>
                          <div className="mt-1 text-[9.5px] font-semibold uppercase tracking-wider text-slate-500 dark:text-zinc-600">
                            {s.k}
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="h-10 w-px bg-slate-200 dark:bg-white/[0.07]" />
                    <div className="w-[130px]">
                      <div className="mb-1.5 flex items-center justify-between text-[10px]">
                        <span className="text-slate-500 dark:text-zinc-500">{t("التقدم", "Progress")}</span>
                        <span className="mono font-bold text-violet-600 dark:text-violet-300 tabular">
                          {stats.progress}%
                        </span>
                      </div>
                      <Bar value={stats.progress} />
                    </div>
                  </div>
                </div>

                {/* toolbar: tabs + filters */}
                <div className="mt-5 flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-100 p-1 dark:border-white/[0.07] dark:bg-white/3">
                    {VIEW_TABS.filter(({ id }) => id !== "sprints" || can("sprints.view")).map(
                      ({ id, ar, en, Icon }) => (
                        <button
                          key={id}
                          onClick={() => setActiveView(id)}
                          className={cn(
                            "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium transition",
                            activeView === id
                              ? "bg-linear-to-r from-indigo-500 to-violet-500 text-white shadow-[0_2px_12px_rgba(99,102,241,0.3)]"
                              : "text-slate-500 hover:bg-white hover:text-slate-900 dark:text-zinc-500 dark:hover:bg-white/4 dark:hover:text-zinc-200",
                          )}
                        >
                          <Icon size={13} />
                          {t(ar, en)}
                        </button>
                      ),
                    )}
                  </div>
                  <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
                    <input
                      name="auto-field-ugbqrm2"
                      value={taskFilter.search || ""}
                      onChange={(e) => setTaskFilter({ ...taskFilter, search: e.target.value })}
                      placeholder={t("تصفية…", "Filter…")}
                      className="h-8 w-[150px] rounded-lg border border-slate-200 bg-white px-3 text-[12px] text-slate-900 placeholder:text-slate-400 outline-none focus:border-violet-500 dark:border-white/8 dark:bg-white/4 dark:text-white dark:placeholder:text-zinc-600 dark:focus:border-violet-400/50"
                    />
                    <select
                      name="auto-field-c0spigt"
                      value={taskFilter.status || ""}
                      onChange={(e) => setTaskFilter({ ...taskFilter, status: e.target.value || undefined })}
                      className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-[11.5px] text-slate-700 outline-none focus:border-violet-500 dark:border-white/8 dark:bg-zinc-900 dark:text-zinc-300 dark:focus:border-violet-400/50"
                    >
                      <option value="">{t("كل الحالات", "All status")}</option>
                      {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                        <option key={k} value={k}>
                          {t(v.ar, v.en)}
                        </option>
                      ))}
                    </select>
                    <select
                      name="auto-field-jo6aytx"
                      value={taskFilter.priority || ""}
                      onChange={(e) => setTaskFilter({ ...taskFilter, priority: e.target.value || undefined })}
                      className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-[11.5px] text-slate-700 outline-none focus:border-violet-500 dark:border-white/8 dark:bg-zinc-900 dark:text-zinc-300 dark:focus:border-violet-400/50"
                    >
                      <option value="">{t("كل الأولويات", "All priority")}</option>
                      {Object.entries(PRIORITY_CONFIG).map(([k, v]) => (
                        <option key={k} value={k}>
                          {t(v.ar, v.en)}
                        </option>
                      ))}
                    </select>
                    {visibleSavedViews.map((view) => {
                      const owned = view.createdBy === currentUser?.id;
                      return (
                        <div
                          key={view.id}
                          className="flex h-8 items-center rounded-lg border border-violet-200 bg-violet-50 text-[11px] font-medium text-violet-700 dark:border-violet-500/25 dark:bg-violet-500/8 dark:text-violet-300"
                        >
                          <button onClick={() => applySavedView(view)} className="flex h-full items-center gap-1 px-2">
                            {view.isDefault ? <span title={t("افتراضي", "Default")}>★</span> : null}
                            {view.isShared && !owned && <IconShare size={11} />}
                            <span className="max-w-24 truncate">{view.name}</span>
                          </button>
                          {owned && can("saved_views.manage") && (
                            <>
                              <button
                                disabled={view.viewType !== activeView}
                                title={
                                  view.viewType === activeView
                                    ? t("تحديثه بالحالة الحالية", "Update with current state")
                                    : t("طبّق العرض أولاً لتحديثه", "Apply the view before updating it")
                                }
                                onClick={() =>
                                  void updateSavedView(view, {
                                    filters: taskFilter,
                                    configuration: currentSavedViewConfiguration(activeView, taskTableViewState),
                                  })
                                }
                                className="px-1 text-violet-500 hover:text-violet-900 disabled:cursor-not-allowed disabled:opacity-35 dark:hover:text-white"
                              >
                                ↻
                              </button>
                              <button
                                title={
                                  view.isShared
                                    ? t("جعله خاصاً", "Make private")
                                    : t("مشاركته مع الفريق", "Share with team")
                                }
                                onClick={() => void updateSavedView(view, { isShared: !view.isShared })}
                                className={cn(
                                  "px-1 hover:text-violet-900 dark:hover:text-white",
                                  view.isShared ? "text-emerald-600 dark:text-emerald-400" : "text-violet-500",
                                )}
                              >
                                <IconShare size={11} />
                              </button>
                              {!view.isDefault && (
                                <button
                                  title={t("جعله افتراضياً", "Make default")}
                                  onClick={() => void updateSavedView(view, { isDefault: true })}
                                  className="px-1 text-violet-500 hover:text-violet-900 dark:hover:text-white"
                                >
                                  ☆
                                </button>
                              )}
                              <button
                                title={t("حذف العرض", "Delete view")}
                                onClick={() => void deleteSavedView(view)}
                                className="px-1.5 text-rose-500 hover:text-rose-700"
                              >
                                ×
                              </button>
                            </>
                          )}
                        </div>
                      );
                    })}
                    <button
                      disabled={!can("saved_views.manage") || !activeProject}
                      onClick={() => ctx.setShowSaveView(true)}
                      className="flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-[11px] font-medium text-slate-700 transition hover:bg-slate-100 disabled:opacity-40 dark:border-transparent dark:bg-white/[0.07] dark:text-white dark:hover:bg-white/12"
                    >
                      <IconSave size={12} />
                      {t("حفظ العرض", "Save view")}
                    </button>
                    {(taskFilter.status || taskFilter.priority || taskFilter.search || taskFilter.assignee) && (
                      <>
                        <button
                          onClick={() => setTaskFilter({})}
                          className="flex h-8 items-center gap-1 rounded-lg px-2 text-[11px] text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 dark:text-zinc-500 dark:hover:bg-white/4 dark:hover:text-zinc-200"
                        >
                          <IconX size={11} />
                          {t("مسح", "Clear")}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}

          {/* active view */}
          <ActiveView activeView={activeView} ctx={ctx} />
        </div>

        <div className="border-t border-slate-200/80 dark:border-white/5 px-6 py-3.5 text-center text-[10.5px] text-slate-500 dark:text-zinc-600">
          <span className="font-display font-semibold text-slate-700 dark:text-zinc-500">CalmBoard</span> ·{" "}
          {t("إدارة العمل الحديثة", "Modern work management")} · Next.js 16 + Drizzle + PostgreSQL ·{" "}
          <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400/80">
            <span className="live-dot h-1.5 w-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400" />
            {t("يعمل", "operational")}
          </span>
          {" · "}
          <a
            href="/admin"
            className={cn(
              "text-slate-600 dark:text-zinc-500 underline-offset-2 transition hover:text-indigo-600 dark:hover:text-violet-300 hover:underline",
              !authorization?.isPlatformAdmin && "hidden",
            )}
          >
            {t("لوحة الإدارة", "Admin")}
          </a>
          {" · "}
          <a
            href="/api-reference"
            className="text-slate-600 dark:text-zinc-500 underline-offset-2 transition hover:text-indigo-600 dark:hover:text-violet-300 hover:underline"
          >
            {t("وثائق الـ API", "API Docs")}
          </a>
          {" · "}
          <button
            onClick={() => setShowShortcuts(true)}
            className="text-slate-600 dark:text-zinc-500 underline-offset-2 transition hover:text-indigo-600 dark:hover:text-violet-300 hover:underline cursor-pointer"
          >
            ⌨️ {t("اختصارات لوحة المفاتيح (? للمساعدة)", "Shortcuts (?)")}
          </button>
        </div>
      </main>

      {/* ============ OVERLAYS ============ */}
      <TaskDrawer
        key={taskDetail?.id || "task-drawer-empty"}
        ctx={ctx}
        task={taskDetail}
        onClose={() => setTaskDetail(null)}
        comments={comments}
        subtasks={subtasks}
        addSubtask={can("tasks.create") ? addSubtask : () => denyMutation()}
        toggleSubtask={can("tasks.update") ? toggleSubtask : () => denyMutation()}
        addComment={can("comments.manage") ? addComment : () => denyMutation()}
        editComment={can("comments.manage") ? editComment : () => denyMutation()}
        logTime={can("time_logs.manage") ? logTime : () => denyMutation()}
      />
      <CommandPalette
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        query={searchQuery}
        setQuery={setSearchQuery}
        scope={
          activeOrg && activeWorkspace ? { organizationId: activeOrg.id, workspaceId: activeWorkspace.id } : undefined
        }
        projects={projects}
        locale={locale}
        t={t}
        openTask={(tk) => {
          openTask(tk);
          setSearchOpen(false);
        }}
        openTaskById={(task) => {
          void openTaskById(task);
          setSearchOpen(false);
        }}
        switchProject={(p) => {
          switchProject(p);
          setSearchOpen(false);
        }}
        openDoc={(d) => {
          setActiveDoc(d);
          setActiveView("docs");
          setSearchOpen(false);
        }}
        filterAssignee={(uid) => {
          setTaskFilter({ ...taskFilter, assignee: uid });
          setActiveView("list");
          setSearchOpen(false);
        }}
        toggleLocale={() => {
          toggleLocale();
          setSearchOpen(false);
        }}
        newTask={() => {
          ctx.setShowAddTask(true);
          setSearchOpen(false);
        }}
        goDashboard={() => {
          setActiveView("dashboard");
          setSearchOpen(false);
        }}
        openAI={() => {
          setShowAI(true);
          setSearchOpen(false);
        }}
      />
      <AIPanel
        open={showAI}
        onClose={() => setShowAI(false)}
        input={aiInput}
        setInput={setAiInput}
        result={aiResult}
        error={aiError}
        loading={aiLoading}
        run={runAI}
        t={t}
        proposal={aiProposal}
        proposalLoading={aiProposalLoading}
        canApprove={canCreateTasks}
        approve={async () => {
          if (await approveAIProposal()) await refreshTaskPages();
        }}
        reject={rejectAIProposal}
      />
      <NewTaskModal
        open={showAddTask}
        onClose={() => setShowAddTask(false)}
        users={users}
        t={t}
        onCreate={ctx.createTask}
      />
      <NewProjectModal
        open={showAddProject}
        onClose={() => setShowAddProject(false)}
        t={t}
        onCreated={(p) => {
          setProjects((x) => [p, ...x]);
          setActiveProject(p);
        }}
        orgId={activeOrg?.id}
        wsId={activeWorkspace?.id}
        ownerId={currentUser?.id}
      />
      <NewDocModal
        open={showNewDoc}
        onClose={() => setShowNewDoc(false)}
        t={t}
        onCreated={(d) => {
          setDocs((x) => [{ ...d, author: currentUser }, ...x]);
          setActiveDoc({ ...d, author: currentUser });
        }}
        orgId={activeOrg?.id}
        wsId={activeWorkspace?.id}
        authorId={currentUser?.id}
        docs={docs}
      />
      <NewGoalModal
        open={showNewGoal}
        onClose={() => setShowNewGoal(false)}
        t={t}
        users={users}
        goals={goals}
        onCreated={(g) => setGoals((x) => [{ ...g, owner: users.find((u) => u.id === g.ownerId) }, ...x])}
        orgId={activeOrg?.id}
        wsId={activeWorkspace?.id}
        ownerId={currentUser?.id}
      />
      <NewAutomationModal
        open={showNewAutomation}
        onClose={() => setShowNewAutomation(false)}
        t={t}
        onCreated={(a) => setAutomations((x) => [a, ...x])}
        orgId={activeOrg?.id}
        wsId={activeWorkspace?.id}
        actorId={currentUser?.id}
      />
      <InviteModal
        open={showInvite}
        onClose={() => setShowInvite(false)}
        t={t}
        orgId={activeOrg?.id}
        wsId={activeWorkspace?.id}
        invitedBy={currentUser?.id}
        onDone={() => activeWorkspace && loadWorkspaceModules(activeWorkspace.id, activeOrg?.id, currentUser?.id)}
        notify={notify}
      />
      <SaveViewModal
        open={showSaveView}
        onClose={() => setShowSaveView(false)}
        t={t}
        activeView={activeView}
        taskFilter={taskFilter}
        configuration={currentSavedViewConfiguration(activeView, taskTableViewState)}
        orgId={activeOrg?.id}
        wsId={activeWorkspace?.id}
        projectId={activeProject?.id}
        onSaved={(view) =>
          setSavedViews((current) => [
            view,
            ...current.map((candidate) =>
              view.isDefault && candidate.projectId === view.projectId && candidate.createdBy === view.createdBy
                ? { ...candidate, isDefault: false }
                : candidate,
            ),
          ])
        }
      />
      <QuickGuideModal open={showGuide} onClose={() => setShowGuide(false)} t={t} />
      {telemetryUiEnabled && <TelemetryModal open={showTelemetry} onClose={() => setShowTelemetry(false)} t={t} />}
      <KeyboardShortcutsModal open={showShortcuts} onClose={() => setShowShortcuts(false)} t={t} />

      {/* toast */}
      {toast && (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-95 flex justify-center px-4">
          <div
            className={cn(
              "animate-pop pointer-events-auto flex items-center gap-2.5 rounded-xl border px-4 py-3 text-[13px] font-medium shadow-lg backdrop-blur-xl",
              toast.kind === "success"
                ? "border-emerald-200 bg-white/95 text-emerald-800 dark:border-emerald-500/30 dark:bg-zinc-900/95 dark:text-emerald-200"
                : "border-rose-200 bg-white/95 text-rose-800 dark:border-rose-500/40 dark:bg-zinc-900/95 dark:text-rose-200",
            )}
          >
            {toast.kind === "success" ? (
              <IconCheck size={15} className="text-emerald-600 dark:text-emerald-400" />
            ) : (
              <IconX size={15} className="text-rose-600 dark:text-rose-400" />
            )}
            {toast.msg}
          </div>
        </div>
      )}

      {/* mobile nav */}
      <div className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-around border-t border-slate-200/80 bg-white/95 dark:border-white/[0.07] dark:bg-[#0a0a11]/95 px-2 py-2 backdrop-blur-xl lg:hidden">
        {[
          { id: "table", Icon: IconTable, ar: "جدول", en: "Table" },
          { id: "board", Icon: IconBoard, ar: "لوحة", en: "Board" },
          { id: "mywork", Icon: IconMyWork, ar: "عملي", en: "My" },
          { id: "dashboard", Icon: IconDash, ar: "لوحة", en: "Dash" },
          { id: "inbox", Icon: IconInbox, ar: "وارد", en: "Inbox" },
        ].map(({ id, Icon, ar, en }) => (
          <button
            key={id}
            onClick={() => setActiveView(id)}
            className={cn(
              "flex flex-col items-center gap-1 rounded-xl px-3 py-1.5 transition",
              activeView === id
                ? "bg-indigo-50 text-indigo-700 dark:bg-linear-to-r dark:from-indigo-500/20 dark:to-violet-400/20 dark:text-violet-300"
                : "text-slate-500 dark:text-zinc-500",
            )}
          >
            <Icon size={17} />
            <span className="text-[9.5px] font-medium">{t(ar, en)}</span>
          </button>
        ))}
      </div>

      {showAddWorkspace && (
        <NewWorkspaceModal
          open={showAddWorkspace}
          onClose={() => setShowAddWorkspace(false)}
          t={t}
          onCreate={async (input) => {
            await createWorkspace(input);
            setShowAddWorkspace(false);
          }}
        />
      )}
    </div>
  );
}
