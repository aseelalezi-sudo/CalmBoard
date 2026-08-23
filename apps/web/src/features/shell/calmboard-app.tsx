"use client";
import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import type { Doc, Notification, SavedView, Task, ViewCtx } from "@/lib/types";
import { STATUS_CONFIG, PRIORITY_CONFIG, STATUS_ORDER } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  Badge,
  Avatar,
  Kbd,
  Bar,
  Btn,
  ScreenState,
  ScreenToolbar,
  SegmentedTabs,
  inputCls,
  selectCls,
} from "@/components/ui";
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
  IconDoc,
  IconChevronDown,
} from "@/components/icons";
import { notificationBody, notificationTitle } from "@/lib/notification-labels";
import { AuthScreen } from "@/features/auth/auth-screen";
import { useAuthOperations } from "@/features/auth/use-auth-operations";
import { AIPanel } from "@/features/ai/ai-panel";
import { useAiOperations } from "@/features/ai/use-ai-operations";
import { useCommentOperations } from "@/features/comments/use-comment-operations";
import { CommandPalette } from "@/features/search/command-palette";
import { TaskDrawer } from "@/features/tasks/task-drawer";
import { useTaskPagination } from "@/features/tasks/use-task-pagination";
import { useTaskOperations } from "@/features/tasks/use-task-operations";
import { isTaskAssignedTo } from "@/features/tasks/assignment-domain";
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
import { notify as notifyFeedback, type NoticeKind } from "@/components/feedback";
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
  const taskViewState = useTaskViewStateStore((state) => state);
  const taskTableViewState = taskViewState.table;
  const applyTaskViewConfiguration = useTaskViewStateStore((state) => state.apply);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showNotif, setShowNotif] = useState(false);
  const [notifFilter, setNotifFilter] = useState<"all" | "unread">("all");
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
  const notifTriggerRef = useRef<HTMLButtonElement>(null);
  const notifPanelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (showNotif && event.key === "Escape") {
        setShowNotif(false);
        notifTriggerRef.current?.focus();
      }
    }
    function handleClickOutside(event: MouseEvent) {
      if (showNotif && notifRef.current && !notifRef.current.contains(event.target as Node)) {
        setShowNotif(false);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
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
      if (view.configuration) applyTaskViewConfiguration(view.configuration);
      if (announce) notify(`${t("طُبّق", "Applied")}: ${view.name}`);
    },
    [applyTaskViewConfiguration, notify, setActiveView, t],
  );
  const appliedDefaultProject = useRef<string | null>(null);

  useEffect(() => {
    if (!activeProject || appliedDefaultProject.current === activeProject.id) return;
    const defaultView = visibleSavedViews.find((view) => view.projectId === activeProject.id && view.isDefault);
    if (!defaultView) return;
    appliedDefaultProject.current = activeProject.id;
    applySavedView(defaultView, false);
  }, [activeProject, applySavedView, visibleSavedViews]);

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
    if (taskFilter.assignee) arr = arr.filter((x) => isTaskAssignedTo(x, taskFilter.assignee));
    if (taskFilter.search) {
      const q = taskFilter.search.toLowerCase();
      arr = arr.filter((x) => x.title.toLowerCase().includes(q) || x.serial.toLowerCase().includes(q));
    }
    return arr;
  }, [tasks, taskFilter]);

  const groupedByStatus = useMemo(() => {
    const g: Record<string, Task[]> = {};
    STATUS_ORDER.forEach((s) => (g[s] = []));
    filteredTasks.filter((x) => !x.parentId).forEach((x) => (g[x.status] ? g[x.status].push(x) : g.backlog.push(x)));
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
    deleteTask,
    moveTask,
    updateProjectWipLimit,
    createTask,
    openTask,
    openTaskById,
    addSubtask,
    toggleSubtask,
    deleteSubtask,
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
    if (!notification.isRead) markAsRead(notification.id).catch(() => undefined);

    // 1. Task notifications (by entityId, serial, or task title match)
    const serialMatch = (
      notification.title +
      " " +
      (notification.body || "") +
      " " +
      (notification.entityId || "")
    ).match(/TASK-\d+/i);
    const matchedSerial = serialMatch ? serialMatch[0].toUpperCase() : null;

    const matchedTask = tasks.find(
      (task) =>
        (notification.entityId &&
          (task.id === notification.entityId || task.serial?.toUpperCase() === notification.entityId.toUpperCase())) ||
        (matchedSerial && task.serial?.toUpperCase() === matchedSerial) ||
        (task.title && (notification.body?.includes(task.title) || notification.title?.includes(task.title))),
    );

    if (matchedTask) {
      if (matchedTask.projectId && activeProject?.id !== matchedTask.projectId) {
        const targetProj = projects.find((p) => p.id === matchedTask.projectId);
        if (targetProj) switchProject(targetProj);
      }
      openTask(matchedTask);
      return;
    }

    if (notification.entityType === "task" && notification.entityId) {
      if (activeOrg && activeWorkspace) {
        void openTaskById({
          id: notification.entityId,
          organizationId: activeOrg.id,
          workspaceId: activeWorkspace.id,
        });
      }
      return;
    }

    // 2. Project notifications
    if (notification.entityType === "project" && notification.entityId) {
      const project = projects.find((item) => item.id === notification.entityId);
      if (project) switchProject(project);
      return;
    }

    // 3. Timesheets & Time tracking / Approvals notifications
    const isTimesheet =
      notification.entityType === "timesheet" ||
      notification.entityType === "time" ||
      notification.entityType === "time_log" ||
      notification.actionPath?.includes("view=time") ||
      notification.actionPath?.includes("view=timesheets") ||
      /timesheet|ساعات|جدول|اعتماد|موافقة/i.test(notification.title || "") ||
      /timesheet|ساعات|جدول|اعتماد|موافقة/i.test(notification.body || "");

    if (isTimesheet && canOpenWorkspaceView("time")) {
      setActiveView("time");
      return;
    }

    // 4. Docs notifications
    if ((notification.entityType === "doc" || notification.entityType === "document") && canOpenWorkspaceView("docs")) {
      setActiveView("docs");
      return;
    }

    // 5. Goals notifications
    if (notification.entityType === "goal" && canOpenWorkspaceView("goals")) {
      setActiveView("goals");
      return;
    }

    // 6. Member & Invitation notifications
    if (
      (notification.entityType === "member" || notification.entityType === "invitation") &&
      canOpenWorkspaceView("members")
    ) {
      setActiveView("members");
      return;
    }

    // 7. Action path navigation
    if (notification.actionPath?.startsWith("/") && !notification.actionPath.startsWith("//")) {
      const target = new URL(notification.actionPath, window.location.origin);
      let view = target.searchParams.get("view");
      if (view === "timesheets") view = "time";
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
    markAllNotificationsRead: markAllRead,
    markAsRead,
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
    openTaskById,
    setTaskSprintMembership: (taskId, sprintId) =>
      setTasks((current) => current.map((task) => (task.id === taskId ? { ...task, sprintId } : task))),
    refreshProjectTasks: refreshTasks,
    updateTask: can("tasks.update")
      ? updateTask
      : () => {
          denyMutation();
          return false;
        },
    deleteTask: can("tasks.delete")
      ? deleteTask
      : async () => {
          denyMutation();
          return false;
        },
    moveTask: can("tasks.update") ? moveTask : async () => denyMutation(),
    setProjectWipLimit: can("projects.update") ? updateProjectWipLimit : async () => denyMutation(),
    createTask: can("tasks.create")
      ? createTask
      : () => {
          denyMutation();
          return false;
        },
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
    notify: (msg: string, kind?: "error" | "success" | "warning" | "info") => notifyFeedback(msg, kind as NoticeKind),
  };

  /* ---------- loading ---------- */
  if (loading) {
    return <LoadingScreen message={t("جاري تجهيز مساحة العمل…", "Preparing your workspace…")} />;
  }

  if (dataError) {
    return (
      <div dir={isRTL ? "rtl" : "ltr"} className="app-bg grid min-h-screen place-items-center p-6">
        <ScreenState
          tone="error"
          title={t("تعذر إعداد مساحة العمل", "Workspace could not be prepared")}
          description={dataError}
          action={<Btn onClick={() => void reload()}>{t("إعادة المحاولة", "Retry")}</Btn>}
        />
      </div>
    );
  }

  if (!currentUser) {
    return <AuthScreen onAuthenticated={reload} />;
  }

  const unread = notifications.filter((n) => !n.isRead).length;

  return (
    <div className="app-bg flex min-h-dvh text-[14px]" dir={isRTL ? "rtl" : "ltr"}>
      {/* ============ SIDEBAR ============ */}
      <aside
        className={cn(
          "sticky top-0 z-30 hidden h-screen shrink-0 flex-col border-e border-line bg-surface/95 backdrop-blur-2xl transition-all duration-300 dark:bg-[#0c0d14]/95 lg:flex",
          collapsed ? "w-[74px]" : "w-[270px]",
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

        <div className="flex-1 space-y-5 overflow-y-auto px-3 py-3.5 scrollbar-thin">
          {/* Nav Work */}
          <nav>
            {!collapsed ? (
              <div className="mb-2 px-3 text-[11px] font-bold uppercase tracking-wider text-indigo-500 dark:text-indigo-400">
                {t("العمل", "Work")}
              </div>
            ) : (
              <div className="my-2 mx-auto h-px w-6 bg-line/80" />
            )}
            <ul className="space-y-1">
              {NAV_WORK.map(({ id, ar, en, Icon }) => (
                <li key={id}>
                  <button
                    onClick={() => setActiveView(id)}
                    title={t(ar, en)}
                    className={cn(
                      "group relative flex w-full items-center rounded-xl py-2 text-[13px] font-medium transition-all duration-150",
                      collapsed ? "justify-center px-1" : "gap-3 px-3",
                      activeView === id
                        ? "bg-accent/10 font-semibold text-accent dark:bg-accent/15 dark:text-white shadow-xs"
                        : "text-ink-soft hover:bg-raised/70 hover:text-ink active:scale-[0.99]",
                    )}
                  >
                    {activeView === id && (
                      <span className="absolute start-0 inset-y-1.5 w-1 rounded-full bg-accent shadow-[0_0_8px_var(--color-accent)]" />
                    )}
                    <Icon
                      size={16}
                      className={cn(
                        "shrink-0 transition-transform duration-150 group-hover:scale-110",
                        activeView === id ? "text-accent" : "text-ink-faint group-hover:text-ink",
                      )}
                    />
                    {!collapsed && <span className="flex-1 text-start truncate">{t(ar, en)}</span>}
                    {!collapsed && id === "inbox" && unread > 0 && (
                      <span className="grid h-5 min-w-5 place-items-center rounded-full bg-linear-to-r from-indigo-500 to-violet-500 px-1.5 text-[10px] font-bold text-white shadow-xs">
                        {unread}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          {/* Nav Space */}
          <nav>
            {!collapsed ? (
              <div className="mb-2 px-3 text-[11px] font-bold uppercase tracking-wider text-indigo-500 dark:text-indigo-400">
                {t("مساحة العمل", "Workspace")}
              </div>
            ) : (
              <div className="my-2 mx-auto h-px w-6 bg-line/80" />
            )}
            <ul className="space-y-1">
              {NAV_SPACE.filter(({ id }) => canOpenWorkspaceView(id)).map(({ id, ar, en, Icon }) => (
                <li key={id}>
                  <button
                    onClick={() => setActiveView(id)}
                    title={t(ar, en)}
                    className={cn(
                      "group relative flex w-full items-center rounded-xl py-2 text-[13px] font-medium transition-all duration-150",
                      collapsed ? "justify-center px-1" : "gap-3 px-3",
                      activeView === id
                        ? "bg-accent/10 font-semibold text-accent dark:bg-accent/15 dark:text-white shadow-xs"
                        : "text-ink-soft hover:bg-raised/70 hover:text-ink active:scale-[0.99]",
                    )}
                  >
                    {activeView === id && (
                      <span className="absolute start-0 inset-y-1.5 w-1 rounded-full bg-accent shadow-[0_0_8px_var(--color-accent)]" />
                    )}
                    <Icon
                      size={16}
                      className={cn(
                        "shrink-0 transition-transform duration-150 group-hover:scale-110",
                        activeView === id ? "text-accent" : "text-ink-faint group-hover:text-ink",
                      )}
                    />
                    {!collapsed && <span className="flex-1 text-start truncate">{t(ar, en)}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          {/* Nav Tools */}
          {NAV_TOOLS.filter(({ id }) => canOpenWorkspaceView(id)).length > 0 && (
            <nav>
              {!collapsed ? (
                <div className="mb-2 px-3 text-[11px] font-bold uppercase tracking-wider text-indigo-500 dark:text-indigo-400">
                  {t("الأدوات", "Tools")}
                </div>
              ) : (
                <div className="my-2 mx-auto h-px w-6 bg-line/80" />
              )}
              <ul className="space-y-1">
                {NAV_TOOLS.filter(({ id }) => canOpenWorkspaceView(id)).map(({ id, ar, en, Icon }) => (
                  <li key={id}>
                    <button
                      onClick={() => setActiveView(id)}
                      title={t(ar, en)}
                      className={cn(
                        "group relative flex w-full items-center rounded-xl py-2 text-[13px] font-medium transition-all duration-150",
                        collapsed ? "justify-center px-1" : "gap-3 px-3",
                        activeView === id
                          ? "bg-accent/10 font-semibold text-accent dark:bg-accent/15 dark:text-white shadow-xs"
                          : "text-ink-soft hover:bg-raised/70 hover:text-ink active:scale-[0.99]",
                      )}
                    >
                      {activeView === id && (
                        <span className="absolute start-0 inset-y-1.5 w-1 rounded-full bg-accent shadow-[0_0_8px_var(--color-accent)]" />
                      )}
                      <Icon
                        size={16}
                        className={cn(
                          "shrink-0 transition-transform duration-150 group-hover:scale-110",
                          activeView === id ? "text-accent" : "text-ink-faint group-hover:text-ink",
                        )}
                      />
                      {!collapsed && <span className="flex-1 text-start truncate">{t(ar, en)}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </nav>
          )}

          {/* Nav Admin */}
          {NAV_ADMIN.filter(({ id }) => canOpenWorkspaceView(id)).length > 0 && (
            <nav>
              {!collapsed ? (
                <div className="mb-2 px-3 text-[11px] font-bold uppercase tracking-wider text-indigo-500 dark:text-indigo-400">
                  {t("الإدارة", "Administration")}
                </div>
              ) : (
                <div className="my-2 mx-auto h-px w-6 bg-line/80" />
              )}
              <ul className="space-y-1">
                {NAV_ADMIN.filter(({ id }) => canOpenWorkspaceView(id)).map(({ id, ar, en, Icon }) => (
                  <li key={id}>
                    <button
                      onClick={() => setActiveView(id)}
                      title={t(ar, en)}
                      className={cn(
                        "group relative flex w-full items-center rounded-xl py-2 text-[13px] font-medium transition-all duration-150",
                        collapsed ? "justify-center px-1" : "gap-3 px-3",
                        activeView === id
                          ? "bg-accent/10 font-semibold text-accent dark:bg-accent/15 dark:text-white shadow-xs"
                          : "text-ink-soft hover:bg-raised/70 hover:text-ink active:scale-[0.99]",
                      )}
                    >
                      {activeView === id && (
                        <span className="absolute start-0 inset-y-1.5 w-1 rounded-full bg-accent shadow-[0_0_8px_var(--color-accent)]" />
                      )}
                      <Icon
                        size={16}
                        className={cn(
                          "shrink-0 transition-transform duration-150 group-hover:scale-110",
                          activeView === id ? "text-accent" : "text-ink-faint group-hover:text-ink",
                        )}
                      />
                      {!collapsed && <span className="flex-1 text-start truncate">{t(ar, en)}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </nav>
          )}
        </div>

        {/* Sidebar Footer with Collapse Toggle */}
        <div className="shrink-0 border-t border-line bg-surface/80 p-2">
          <button
            type="button"
            onClick={() => setCollapsed(!collapsed)}
            aria-label={
              collapsed ? t("توسيع القائمة الجانبية", "Expand sidebar") : t("طي القائمة الجانبية", "Collapse sidebar")
            }
            title={
              collapsed ? t("توسيع القائمة الجانبية", "Expand sidebar") : t("طي القائمة الجانبية", "Collapse sidebar")
            }
            className={cn(
              "group flex h-9 w-full items-center rounded-xl text-[12.5px] font-medium text-ink-soft transition-all duration-150 hover:bg-raised hover:text-ink active:scale-[0.98]",
              collapsed ? "justify-center px-0" : "justify-between px-2.5",
            )}
          >
            {!collapsed && (
              <span className="truncate font-semibold text-[12.5px]">{t("طي القائمة", "Collapse sidebar")}</span>
            )}
            <span className="grid h-7 w-7 place-items-center rounded-lg text-ink-soft group-hover:text-accent transition-colors">
              <IconCollapse
                size={17}
                className={cn(
                  "transition-transform duration-300",
                  locale === "ar"
                    ? collapsed
                      ? "scale-x-100"
                      : "-scale-x-100"
                    : collapsed
                      ? "-scale-x-100"
                      : "scale-x-100",
                )}
              />
            </span>
          </button>
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
            title={t("مهمة جديدة", "New Task")}
            aria-label={t("مهمة جديدة", "New Task")}
            className="group relative flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-linear-to-r from-[#6366f1] to-[#8b5cf6] px-3.5 text-[12.5px] font-bold text-white shadow-md shadow-indigo-500/25 transition-all duration-200 hover:shadow-lg hover:shadow-indigo-500/35 hover:brightness-105 active:scale-95 disabled:pointer-events-none disabled:opacity-40"
          >
            <IconPlus size={15} className="transition-transform duration-200 group-hover:rotate-90" />
            <span className="hidden sm:inline">{t("مهمة جديدة", "New Task")}</span>
          </button>

          <div className="relative" ref={notifRef}>
            <button
              ref={notifTriggerRef}
              type="button"
              onClick={() => {
                setShowNotif(!showNotif);
              }}
              aria-label={t("فتح الإشعارات", "Open notifications")}
              title={t("الإشعارات", "Notifications")}
              className={cn(
                "group relative flex h-9.5 w-9.5 shrink-0 items-center justify-center rounded-xl border-2 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 active:scale-95",
                showNotif
                  ? "border-accent ring-3 ring-accent/25 shadow-md bg-raised text-accent"
                  : "border-line/90 bg-surface text-ink-soft shadow-2xs hover:border-accent/60 hover:text-ink hover:shadow-xs",
              )}
            >
              <IconBell size={16} className={cn("transition-transform duration-200", showNotif && "scale-110")} />
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
              <div
                ref={notifPanelRef}
                tabIndex={-1}
                className="animate-pop fixed inset-x-2 top-18 z-50 flex max-h-[calc(100dvh-5rem)] flex-col overflow-hidden rounded-2xl border border-line bg-surface/98 shadow-2xl backdrop-blur-2xl ring-1 ring-line/50 sm:absolute sm:inset-x-auto sm:end-0 sm:top-12 sm:w-[min(380px,calc(100vw-24px))] sm:max-h-[460px] dark:shadow-[0_24px_60px_rgba(0,0,0,0.6)]"
              >
                {/* Header */}
                <div className="flex shrink-0 items-center justify-between border-b border-line bg-linear-to-b from-raised/60 to-raised/20 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="text-[14px] font-bold text-ink">{t("الإشعارات", "Notifications")}</span>
                    {unread > 0 && (
                      <span className="rounded-full bg-indigo-500/15 px-2 py-0.5 text-[10.5px] font-bold text-indigo-500 dark:text-indigo-400">
                        {unread} {t("جديد", "new")}
                      </span>
                    )}
                  </div>
                  {unread > 0 && (
                    <button
                      type="button"
                      onClick={markAllRead}
                      className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11.5px] font-semibold text-accent transition-colors hover:bg-accent/10 active:scale-95"
                    >
                      <IconCheck size={12} />
                      <span>{t("قراءة الكل", "Mark all read")}</span>
                    </button>
                  )}
                </div>

                {/* Filter Tabs */}
                <div className="flex border-b border-line bg-surface p-1.5 gap-1">
                  <button
                    type="button"
                    onClick={() => setNotifFilter("all")}
                    className={cn(
                      "flex-1 rounded-lg py-1 text-center text-[11.5px] font-semibold transition-all duration-150 active:scale-[0.98]",
                      notifFilter === "all"
                        ? "border border-line bg-raised text-ink font-bold shadow-2xs"
                        : "text-ink-soft hover:text-ink hover:bg-raised/50",
                    )}
                  >
                    {t("الكل", "All")} ({notifications.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setNotifFilter("unread")}
                    className={cn(
                      "flex-1 rounded-lg py-1 text-center text-[11.5px] font-semibold transition-all duration-150 active:scale-[0.98]",
                      notifFilter === "unread"
                        ? "border border-line bg-raised text-accent font-bold shadow-2xs"
                        : "text-ink-soft hover:text-ink hover:bg-raised/50",
                    )}
                  >
                    {t("غير المقروءة", "Unread")} ({unread})
                  </button>
                </div>

                {/* List of Notifications */}
                <div className="dropdown-options min-h-0 flex-1 divide-y divide-line overflow-y-auto">
                  {(notifFilter === "unread" ? notifications.filter((n) => !n.isRead) : notifications).map((n) => {
                    const isTask = n.entityType === "task";
                    const isProject = n.entityType === "project";
                    const isDoc = n.entityType === "doc" || n.entityType === "document";

                    return (
                      <button
                        key={n.id}
                        type="button"
                        onClick={() => {
                          openNotification(n);
                          setShowNotif(false);
                        }}
                        className={cn(
                          "group flex w-full cursor-pointer items-start gap-3 p-3.5 text-start transition-colors hover:bg-raised/60 active:scale-[0.99]",
                          !n.isRead ? "bg-accent/4 border-s-3 border-accent" : "border-s-3 border-transparent",
                        )}
                      >
                        <span
                          className={cn(
                            "grid h-8 w-8 shrink-0 place-items-center rounded-xl border shadow-2xs transition-colors",
                            !n.isRead
                              ? isTask
                                ? "border-indigo-500/30 bg-indigo-500/10 text-indigo-500"
                                : isProject
                                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-500"
                                  : "border-accent/30 bg-accent/10 text-accent"
                              : "border-line bg-raised/70 text-ink-soft",
                          )}
                        >
                          {isTask ? (
                            <IconBoard size={14} />
                          ) : isProject ? (
                            <IconFolder size={14} />
                          ) : isDoc ? (
                            <IconDoc size={14} />
                          ) : (
                            <IconBell size={14} />
                          )}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <span
                              className={cn(
                                "truncate text-[12.5px]",
                                !n.isRead ? "font-bold text-ink" : "font-medium text-ink-soft",
                              )}
                            >
                              {notificationTitle(n, t)}
                            </span>
                            <span className="shrink-0 text-[10px] text-ink-faint">
                              {new Date(n.createdAt).toLocaleDateString(locale === "ar" ? "ar-u-nu-latn" : "en-US", {
                                month: "short",
                                day: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </span>
                          </div>
                          {n.body && (
                            <div className="mt-0.5 line-clamp-2 text-[11.5px] text-ink-faint group-hover:text-ink-soft transition-colors">
                              {notificationBody(n, t)}
                            </div>
                          )}
                        </div>
                        {!n.isRead && (
                          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent ring-2 ring-surface shadow-2xs" />
                        )}
                      </button>
                    );
                  })}

                  {(notifFilter === "unread" ? notifications.filter((n) => !n.isRead) : notifications).length === 0 && (
                    <div className="flex flex-col items-center justify-center p-8 text-center">
                      <span className="grid h-10 w-10 place-items-center rounded-2xl border border-line bg-raised/60 text-ink-soft mb-2.5 shadow-2xs">
                        <IconBell size={18} />
                      </span>
                      <div className="text-[13px] font-bold text-ink">
                        {notifFilter === "unread"
                          ? t("أنت مطلع على كل شيء!", "All caught up!")
                          : t("لا توجد إشعارات", "No notifications")}
                      </div>
                      <div className="mt-1 text-[11px] text-ink-faint max-w-[220px]">
                        {notifFilter === "unread"
                          ? t("لا توجد أي إشعارات غير مقروءة حالياً.", "No unread notifications right now.")
                          : t("ستظهر هنا الإشعارات والتنبيهات فور وصولها.", "New notifications will appear here.")}
                      </div>
                    </div>
                  )}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between border-t border-line bg-surface/90 px-3.5 py-2.5">
                  <button
                    type="button"
                    onClick={() => {
                      setActiveView("inbox");
                      setShowNotif(false);
                    }}
                    className="flex items-center gap-1.5 text-[11.5px] font-bold text-accent hover:underline transition-colors active:scale-95"
                  >
                    <IconInbox size={13} />
                    <span>{t("فتح صندوق الوارد الكامل", "Open full Inbox")}</span>
                  </button>
                  <span className="flex items-center gap-1 text-[10px] text-ink-faint">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    <span>{t("مُحدّث فورياً", "Live sync")}</span>
                  </span>
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

          <UserProfileDropdown
            currentUser={currentUser}
            collapsed={false}
            setActiveView={setActiveView}
            setShowGuide={setShowGuide}
            setShowTelemetry={setShowTelemetry}
            telemetryUiEnabled={telemetryUiEnabled}
            t={t}
          />
        </header>

        {/* content */}
        <div className="flex-1 p-4 lg:p-6 pb-24 lg:pb-8">
          <OnboardingChecklist
            organizationId={activeOrg?.id}
            workspaceId={activeWorkspace?.id}
            userId={currentUser?.id}
            progressKey={`${projects.length}:${tasks.length}:${invitations.length}`}
            canCreateProject={can("projects.create")}
            canCreateTask={can("tasks.create")}
            canInvite={can("members.invite")}
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
                {/* toolbar: tabs + filters */}
                <ScreenToolbar className="mt-4 justify-between gap-3">
                  <SegmentedTabs
                    value={activeView}
                    label={t("طريقة عرض مهام المشروع", "Project task view")}
                    onChange={(val) => setActiveView(val as any)}
                    items={VIEW_TABS.filter(({ id }) => id !== "sprints" || can("sprints.view")).map(
                      ({ id, ar, en, Icon }) => ({
                        id,
                        label: (
                          <span className="flex items-center gap-1.5">
                            <Icon size={13} />
                            {t(ar, en)}
                          </span>
                        ),
                      }),
                    )}
                  />
                  <div className="flex items-center gap-2 shrink-0">
                    <input
                      name="auto-field-ugbqrm2"
                      aria-label={t("البحث في مهام المشروع", "Search project tasks")}
                      value={taskFilter.search || ""}
                      onChange={(e) => setTaskFilter({ ...taskFilter, search: e.target.value })}
                      placeholder={t("تصفية…", "Filter…")}
                      className={`${inputCls} h-8 !w-28 sm:!w-32 text-[12px] shrink-0`}
                    />
                    <select
                      name="auto-field-c0spigt"
                      aria-label={t("تصفية حسب الحالة", "Filter by status")}
                      value={taskFilter.status || ""}
                      onChange={(e) => setTaskFilter({ ...taskFilter, status: e.target.value || undefined })}
                      className={`${selectCls} h-8 !w-auto !min-w-[95px] text-[11.5px] shrink-0`}
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
                      aria-label={t("تصفية حسب الأولوية", "Filter by priority")}
                      value={taskFilter.priority || ""}
                      onChange={(e) => setTaskFilter({ ...taskFilter, priority: e.target.value || undefined })}
                      className={`${selectCls} h-8 !w-auto !min-w-[105px] text-[11.5px] shrink-0`}
                    >
                      <option value="">{t("كل الأولويات", "All priority")}</option>
                      {Object.entries(PRIORITY_CONFIG).map(([k, v]) => (
                        <option key={k} value={k}>
                          {t(v.ar, v.en)}
                        </option>
                      ))}
                    </select>
                    {(taskFilter.status || taskFilter.priority || taskFilter.search || taskFilter.assignee) && (
                      <button
                        onClick={() => setTaskFilter({})}
                        className="flex h-8 shrink-0 items-center gap-1 rounded-lg px-2 text-[11px] text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 dark:text-zinc-500 dark:hover:bg-white/4 dark:hover:text-zinc-200"
                      >
                        <IconX size={11} />
                        {t("مسح", "Clear")}
                      </button>
                    )}
                    {visibleSavedViews.map((view) => {
                      const owned = view.createdBy === currentUser?.id;
                      return (
                        <div
                          key={view.id}
                          className="flex h-8 shrink-0 items-center rounded-lg border border-violet-200 bg-violet-50 text-[11px] font-medium text-violet-700 dark:border-violet-500/25 dark:bg-violet-500/8 dark:text-violet-300"
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
                                    configuration: currentSavedViewConfiguration(activeView, taskViewState),
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
                    {can("saved_views.manage") && activeProject && (
                      <button
                        onClick={() => setShowSaveView(true)}
                        title={t("حفظ العرض كجدول/تبويب جديد", "Save as new view tab")}
                        className="flex h-8 shrink-0 items-center gap-1 rounded-lg border border-dashed border-line bg-surface/60 px-2.5 text-[11px] font-medium text-ink-soft hover:border-accent hover:text-accent hover:bg-surface transition"
                      >
                        <IconPlus size={11} />
                        <span>{t("عرض/جدول جديد", "New View")}</span>
                      </button>
                    )}
                  </div>
                </ScreenToolbar>
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
        deleteSubtask={can("tasks.delete") ? deleteSubtask : async () => denyMutation()}
        deleteTask={can("tasks.delete") ? deleteTask : async () => denyMutation()}
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
        members={members}
        t={t}
        locale={locale}
        canEdit={ctx.can("tasks.create")}
        onCreate={ctx.createTask}
      />
      <NewProjectModal
        open={showAddProject}
        onClose={() => setShowAddProject(false)}
        t={t}
        onCreated={(p) => {
          setProjects((x) => [p, ...x]);
          switchProject(p);
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
        configuration={currentSavedViewConfiguration(activeView, taskViewState)}
        orgId={activeOrg?.id}
        wsId={activeWorkspace?.id}
        projectId={activeProject?.id}
        onSaved={(view) =>
          setSavedViews((current) => [
            view,
            ...current.map((candidate) =>
              view.isDefault && candidate.projectId === view.projectId ? { ...candidate, isDefault: false } : candidate,
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
      <div className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-around border-t border-slate-200/80 bg-white/95 dark:border-white/[0.07] dark:bg-[#0a0a11]/95 px-2 py-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] backdrop-blur-xl lg:hidden">
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
