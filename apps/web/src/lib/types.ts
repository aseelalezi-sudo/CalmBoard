export type User = { id: string; name: string; email: string; avatarUrl?: string; locale?: string; skills?: string[] };
export type Workspace = {
  id: string;
  name: string;
  slug: string;
  color: string;
  icon: string;
  organizationId: string;
  description?: string | null;
};
export type Organization = { id: string; name: string; slug: string; plan: string; seats: number };
export type AuthorizationCapabilities = {
  userId: string;
  isPlatformAdmin: boolean;
  member: boolean;
  membershipId: string | null;
  roles: string[];
  permissions: string[];
};
export type Project = {
  id: string;
  name: string;
  description?: string | null;
  color: string;
  icon: string;
  status: "planning" | "active" | "on_hold" | "completed" | "archived";
  priority: string;
  progress: number;
  workspaceId: string;
  organizationId: string;
  ownerId?: string | null;
  managerId?: string | null;
  coverUrl?: string | null;
  privacy?: string;
  template?: string;
  budget?: number | null;
  version: number;
  wipLimits?: Partial<Record<string, number>>;
  estimatedHours?: number | null;
  loggedHours?: number;
  startDate?: string | null;
  endDate?: string | null;
  createdAt?: string;
  updatedAt?: string;
  totalTasks?: number;
  completedTasks?: number;
  memberCount?: number;
};
export type TaskRecurrence = {
  frequency: "daily" | "weekly" | "monthly" | "yearly";
  interval: number;
  timezone: string;
  weekdays: number[];
  monthDay: number | null;
  startsAt: string;
  endsAt: string | null;
  maxOccurrences: number | null;
  occurrencesCreated: number;
  nextOccurrenceAt: string;
  lastOccurrenceAt: string | null;
  status: "active" | "paused" | "completed";
};
export type TaskDependencyLink = {
  blockingTaskId: string;
  blockingTaskSerial: string;
  type: "finish_to_start" | "start_to_start" | "finish_to_finish" | "start_to_finish";
  lagMinutes: number;
};
export type ProjectBaselineTask = {
  sourceTaskId: string;
  serial: string;
  title: string;
  startDate?: string | null;
  dueDate?: string | null;
  isMilestone: boolean;
  taskVersion: number;
};
export type ProjectBaseline = {
  id: string;
  organizationId: string;
  workspaceId: string;
  projectId: string;
  name: string;
  taskCount: number;
  createdBy?: string | null;
  createdAt: string;
  tasks: ProjectBaselineTask[];
};
export type TaskChecklist = {
  id: string;
  taskId: string;
  title: string;
  order: number;
  completedItems: number;
  totalItems: number;
  items: Array<{
    id: string;
    title: string;
    order: number;
    isCompleted: boolean;
    completedAt?: string | null;
  }>;
};
export type TaskApproval = {
  id: string;
  taskId: string;
  requestedBy: string;
  mode: "all" | "any" | "sequential";
  status: "pending" | "approved" | "rejected" | "canceled";
  message?: string | null;
  dueAt?: string | null;
  resolvedAt?: string | null;
  reviewers: Array<{
    reviewerId: string;
    sequence: number;
    status: "pending" | "approved" | "rejected" | "skipped";
    comment?: string | null;
    decidedAt?: string | null;
    user: User;
  }>;
};
export type Task = {
  id: string;
  serial: string;
  title: string;
  description?: string;
  status: string;
  priority: string;
  assigneeId?: string | null;
  assigneeIds?: string[];
  followerIds?: string[];
  assignees?: User[];
  followers?: User[];
  reporterId?: string;
  projectId: string;
  workspaceId: string;
  organizationId: string;
  sectionId?: string;
  tags: string[];
  progress: number;
  order: number;
  dueDate?: string;
  startDate?: string;
  timezone: string;
  estimatedHours?: number;
  loggedHours?: number;
  storyPoints?: number;
  assignee?: User;
  section?: { id: string; name: string } | null;
  createdAt: string;
  parentId?: string | null;
  sprintId?: string | null;
  subtaskStats?: { total: number; done: number };
  customFields?: Record<string, any>;
  isRecurring?: boolean;
  isMilestone?: boolean;
  delayReason?: string;
  dependencies?: string[];
  dependencyLinks?: TaskDependencyLink[];
  reminders?: Array<{ id: string; time: string; label: string; sent?: boolean }>;
  recurrence?: TaskRecurrence;
  version: number;
  updatedAt?: string;
  deletedAt?: string | null;
};
export type Team = { id: string; name: string; color: string };
export type Notification = {
  id: string;
  title: string;
  body?: string;
  type: string;
  entityType?: string;
  entityId?: string;
  actionPath?: string;
  isRead: boolean;
  createdAt: string;
};
export type Comment = {
  id: string;
  content: string;
  createdAt: string;
  user?: User;
  userId: string;
  parentId?: string | null;
  mentionedUserIds?: string[];
  reactions?: Record<string, string[]>;
  isPinned?: boolean;
};
export type Doc = {
  id: string;
  organizationId: string;
  workspaceId: string;
  projectId?: string | null;
  parentId?: string | null;
  title: string;
  content?: string;
  icon: string;
  authorId?: string;
  isPublic?: boolean;
  workspaceAccess?: "none" | "viewer" | "editor";
  inheritPermissions?: boolean;
  accessLevel?: "viewer" | "editor" | "manager";
  updatedAt?: string;
  author?: User | null;
};
export type Goal = {
  id: string;
  organizationId: string;
  workspaceId: string;
  title: string;
  description?: string | null;
  progress: number;
  status: "on_track" | "at_risk" | "off_track" | "achieved";
  type: "objective" | "key_result";
  parentId?: string | null;
  progressMode: "manual" | "measurement" | "tasks" | "children";
  measurementUnit: "percentage" | "number" | "currency" | "boolean";
  startValue: number;
  currentValue: number;
  targetValue: number;
  weight: number;
  ownerId?: string | null;
  owner?: User | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  linkedTasks?: Array<{
    id: string;
    serial: string;
    title: string;
    progress: number;
    status: string;
    weight: number;
  }>;
  checkins?: Array<{
    id: string;
    progress: number;
    currentValue?: number | null;
    status?: string;
    note: string;
    date: string | Date;
    author?: string;
  }>;
};
export type TimeLog = {
  id: string;
  organizationId: string;
  workspaceId: string;
  timesheetId: string;
  taskId: string;
  userId: string;
  description?: string | null;
  durationMinutes: number;
  billable: boolean;
  startedAt: string;
  endedAt: string;
  task?: { title: string; serial: string } | null;
};
export type Timesheet = {
  id: string;
  organizationId: string;
  workspaceId: string;
  userId: string;
  periodStart: string;
  periodEnd: string;
  status: "draft" | "submitted" | "approved" | "rejected";
  submittedAt?: string | null;
  reviewedById?: string | null;
  reviewedAt?: string | null;
  rejectionReason?: string | null;
  lockedAt?: string | null;
  version: number;
  totalMinutes: number;
  billableMinutes: number;
  entriesCount: number;
  tasksCount: number;
  user?: Pick<User, "id" | "name" | "email" | "avatarUrl"> | null;
  entries?: TimeLog[];
};
export type Automation = {
  id: string;
  name: string;
  trigger: string;
  conditions: Record<string, string>;
  actions: Record<string, string>;
  enabled: boolean;
  runs: number;
  lastRunAt?: string | null;
};
export type AutomationRun = {
  id: string;
  automationId: string;
  status: string;
  message?: string;
  durationMs: number;
  createdAt: string;
};
export type Activity = {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  createdAt: string;
  actor?: User | null;
  entityLabel?: string;
  entitySerial?: string | null;
  ip?: string;
};
export type Member = {
  id: string;
  userId: string;
  role: string;
  status: string;
  joinedAt: string;
  user?: User | null;
  team?: { id: string; name: string; color: string } | null;
};
export type WorkloadCapacity = {
  id: string;
  organizationId: string;
  workspaceId: string;
  userId: string;
  weeklyMinutes: number;
  workdayMask: number;
  createdAt: string;
  updatedAt: string;
};
export type WorkloadTimeOff = {
  id: string;
  organizationId: string;
  workspaceId: string;
  userId?: string | null;
  kind: "vacation" | "sick" | "personal" | "public_holiday";
  status: "requested" | "approved" | "rejected";
  startsOn: string;
  endsOn: string;
  minutesPerDay?: number | null;
  note?: string | null;
  createdBy?: string | null;
  createdAt: string;
  updatedAt: string;
};
export type WorkloadSettings = { capacities: WorkloadCapacity[]; timeOff: WorkloadTimeOff[] };
export type Invitation = {
  id: string;
  email: string;
  role: string;
  status: string;
  tokenVersion?: number;
  expiresAt?: string | null;
  lastSentAt?: string | null;
  createdAt: string;
};
export type SavedViewFilters = Partial<Record<"search" | "status" | "priority" | "assignee" | "assigneeId", string>>;

export type SavedViewCustomGroup = {
  id: string;
  name: string;
  color: string;
  taskIds: string[];
};

export type SavedViewTableConfiguration = {
  sorting: Array<{ id: string; desc: boolean }>;
  columnVisibility: Record<string, boolean>;
  columnOrder: string[];
  columnPinning: { left: string[]; right: string[] };
  columnSizing: Record<string, number>;
  groupBy: "none" | "status" | "priority" | "custom";
  collapsedGroups: Record<string, boolean>;
  customGroups: SavedViewCustomGroup[];
};

export type SavedViewBoardConfiguration = {
  groupBy: "status" | "priority" | "assignee";
  collapsedColumns: Record<string, boolean>;
};

export type SavedViewCalendarConfiguration = {
  mode: "month" | "week" | "day";
};

export type SavedViewTimelineConfiguration = {
  zoom: "days" | "weeks" | "months";
  showCritical: boolean;
};

export type SavedViewListConfiguration = {
  sorting: Array<{ id: string; desc: boolean }>;
  groupBy: "none" | "status" | "priority";
};

export type SavedViewConfiguration = {
  schemaVersion: 1 | 2;
  table?: Partial<SavedViewTableConfiguration>;
  board?: Partial<SavedViewBoardConfiguration>;
  calendar?: Partial<SavedViewCalendarConfiguration>;
  timeline?: Partial<SavedViewTimelineConfiguration>;
  list?: Partial<SavedViewListConfiguration>;
};

export type SavedView = {
  id: string;
  organizationId: string;
  workspaceId: string;
  projectId?: string | null;
  name: string;
  viewType: string;
  filters: Record<string, string | undefined>;
  configuration: SavedViewConfiguration;
  isShared: boolean;
  isDefault: boolean;
  createdBy?: string | null;
  updatedAt?: string;
};
export type FormFieldType = "text" | "textarea" | "email" | "number" | "date" | "select" | "radio" | "checkbox";
export type FormConditionOperator = "equals" | "not_equals" | "contains" | "is_empty" | "not_empty";
export type FormFieldCondition = { fieldId: string; operator: FormConditionOperator; value?: string };
export type FormField = {
  id: string;
  type: FormFieldType;
  label: string;
  description?: string;
  placeholder?: string;
  required?: boolean;
  options?: string[];
  condition?: FormFieldCondition;
};
export type FormSettings = {
  schemaVersion: 1;
  createTask: boolean;
  status: "backlog" | "todo" | "in_progress" | "review";
  priority: "low" | "medium" | "high" | "urgent";
  captchaEnabled: boolean;
  submitLabel?: string;
  successMessage?: string;
  taskTitleFieldId?: string;
  taskDescriptionFieldId?: string;
};
export type FormInput = {
  name: string;
  description: string;
  projectId: string | null;
  fields: FormField[];
  settings: FormSettings;
};
export type Form = {
  id: string;
  name: string;
  description?: string;
  fields: FormField[];
  settings: FormSettings;
  responses: number;
  isActive: boolean;
  projectId?: string | null;
  workspaceId: string;
  createdAt: string;
};
export type FormResponse = {
  id: string;
  formId: string;
  data: Record<string, string>;
  createdTaskId?: string | null;
  submittedAt: string;
};
export type DashboardWidgetId =
  | "total_tasks"
  | "completed_tasks"
  | "in_progress_tasks"
  | "overdue_tasks"
  | "status_chart"
  | "project_completion"
  | "custom_chart"
  | "goals"
  | "team_distribution"
  | "time_logged"
  | "activity";
export type DashboardWidgetWidth = "small" | "medium" | "wide" | "full";
export type DashboardWidget = {
  id: DashboardWidgetId;
  width: DashboardWidgetWidth;
  settings?: {
    chartType?: "bar" | "rank" | "donut";
    groupBy?: "assignee" | "priority" | "status" | "tag";
    metric?: "count" | "points" | "estimate" | "logged";
  };
};
export type DashboardLayout = {
  id: string | null;
  organizationId: string;
  workspaceId: string;
  userId: string;
  widgets: DashboardWidget[];
  version: number;
  createdAt: string | null;
  updatedAt: string | null;
};
export type Invoice = {
  id: string;
  number: string;
  amount: number;
  currency: string;
  status: string;
  createdAt: string;
};
export type Attachment = {
  id: string;
  taskId?: string | null;
  projectId?: string | null;
  uploaderId: string;
  fileName: string;
  fileSize: number;
  mimeType?: string;
  scanStatus?: "pending" | "clean" | "infected" | "failed";
  previewStatus?: "pending" | "ready" | "source" | "unsupported" | "failed";
  previewUrl?: string | null;
  previewMimeType?: string | null;
  previewWidth?: number | null;
  previewHeight?: number | null;
  url: string;
  createdAt: string;
};
export type CustomField = {
  id: string;
  name: string;
  key: string;
  type: string;
  description?: string | null;
  required: boolean;
  sensitive: boolean;
  order: number;
  options?: Array<{ label: string; value: string; color?: string }>;
};

export type StatusTone = "neutral" | "indigo" | "amber" | "cyan" | "emerald" | "rose" | "violet";

export const STATUS_ORDER = ["backlog", "todo", "in_progress", "review", "done"] as const;

export const STATUS_CONFIG: Record<string, { ar: string; en: string; tone: StatusTone; dot: string }> = {
  backlog: { ar: "متراكم", en: "Backlog", tone: "neutral", dot: "bg-zinc-500" },
  todo: { ar: "للقيام", en: "To Do", tone: "indigo", dot: "bg-indigo-400" },
  in_progress: { ar: "قيد التنفيذ", en: "In Progress", tone: "amber", dot: "bg-amber-400" },
  review: { ar: "مراجعة", en: "Review", tone: "cyan", dot: "bg-cyan-400" },
  done: { ar: "مكتمل", en: "Done", tone: "emerald", dot: "bg-emerald-400" },
  canceled: { ar: "ملغي", en: "Canceled", tone: "neutral", dot: "bg-zinc-600" },
};

export const PRIORITY_CONFIG: Record<
  string,
  { ar: string; en: string; tone: StatusTone; bar: string; weight: number }
> = {
  low: { ar: "منخفض", en: "Low", tone: "neutral", bar: "bg-zinc-500", weight: 0 },
  medium: { ar: "متوسط", en: "Medium", tone: "amber", bar: "bg-amber-400", weight: 1 },
  high: { ar: "مرتفع", en: "High", tone: "rose", bar: "bg-rose-400", weight: 2 },
  urgent: { ar: "عاجل", en: "Urgent", tone: "rose", bar: "bg-gradient-to-b from-rose-400 to-red-500", weight: 3 },
};

/** Everything a view needs, bundled to keep prop signatures small. */
export type ViewCtx = {
  locale: "ar" | "en";
  t: (ar: string, en: string) => string;
  users: User[];
  currentUser: User | null;
  authorization: AuthorizationCapabilities | null;
  can: (permission: string) => boolean;
  tasks: Task[];
  projects: Project[];
  workspaces: Workspace[];
  workspaceDataError: string | null;
  activeWorkspace: Workspace | null;
  activeProject: Project | null;
  goals: Goal[];
  docs: Doc[];
  timeLogs: TimeLog[];
  timeTotals: { totalMinutes: number; billableMinutes: number };
  timesheets: Timesheet[];
  timesheetReviewQueue: Timesheet[];
  automations: Automation[];
  automationRuns: AutomationRun[];
  activities: Activity[];
  members: Member[];
  invitations: Invitation[];
  notifications: Notification[];
  openNotification: (notification: Notification) => void;
  markAllNotificationsRead: () => Promise<void>;
  markAsRead?: (id: string) => Promise<void>;
  savedViews: SavedView[];
  forms: Form[];
  invoices: Invoice[];
  customFields: CustomField[];
  attachments: Attachment[];
  addAttachment: (taskId: string, file: File) => Promise<void>;
  toggleReaction: (commentId: string, emoji: string) => void;
  createForm: (input: FormInput) => void | Promise<void>;
  updateForm: (id: string, input: FormInput) => void | Promise<void>;
  toggleForm: (id: string, isActive: boolean) => void | Promise<void>;
  stats: { total: number; done: number; inProgress: number; overdue: number; progress: number };
  groupedByStatus: Record<string, Task[]>;
  taskPagination: {
    mode: "page" | "board" | "full";
    loading: boolean;
    total: number;
    hasMore: boolean;
    statusTotals: Record<string, number>;
    statusHasMore: Record<string, boolean>;
    loadMore: () => Promise<void>;
    loadMoreStatus: (status: string) => Promise<void>;
  };
  timerSeconds: number;
  timerRunning: boolean;
  timerTask: string | null;
  setTimerTask: (id: string | null) => void;
  setTimerRunning: (v: boolean) => void;
  openTask: (task: Task) => void;
  openTaskById?: (task: Pick<Task, "id" | "organizationId" | "workspaceId">) => void;
  setTaskSprintMembership: (taskId: string, sprintId: string | null) => void;
  refreshProjectTasks: () => Promise<void>;
  updateTask: (id: string, updates: Partial<Task> & { expectedVersion?: number }) => boolean | Promise<boolean>;
  deleteTask?: (id: string) => Promise<boolean>;
  moveTask: (
    id: string,
    status: string,
    targetIndex: number,
    anchors: { beforeTaskId: string | null; afterTaskId: string | null },
  ) => Promise<void>;
  setProjectWipLimit: (status: string, limit: number | null) => Promise<void>;
  createTask: (data: Partial<Task> & { title: string }) => boolean | Promise<boolean>;
  setTaskFilter: (f: Record<string, string | undefined>) => void;
  setShowAddTask: (v: boolean) => void;
  setShowNewDoc: (v: boolean) => void;
  setShowNewGoal: (v: boolean) => void;
  switchProject: (p: Project) => void;
  switchWorkspace: (workspace: Workspace) => Promise<void>;
  updateProject: (project: Project, patch: Partial<Project>) => Promise<void>;
  archiveProject: (project: Project) => Promise<void>;
  restoreProject: (project: Project) => Promise<void>;
  deleteProject: (project: Project) => Promise<void>;
  setShowAddProject?: (v: boolean) => void;
  setShowAddWorkspace: (v: boolean) => void;
  activeView?: string;
  setShowNewAutomation: (v: boolean) => void;
  setShowInvite: (v: boolean) => void;
  setShowSaveView: (v: boolean) => void;
  setActiveDoc: (d: Doc | null) => void;
  activeDoc: Doc | null;
  patchDoc: (id: string, patch: Partial<Doc>) => void;
  addGoalCheckin: (
    id: string,
    input: { note: string; progress?: number; currentValue?: number },
  ) => void | Promise<void>;
  linkGoalTask: (goalId: string, taskId: string, weight?: number) => void | Promise<void>;
  unlinkGoalTask: (goalId: string, taskId: string) => void | Promise<void>;
  toggleAutomation: (id: string, enabled: boolean) => void | Promise<void>;
  updateMemberRole: (id: string, role: string) => void | Promise<void>;
  resendInvitation: (id: string) => Promise<void>;
  revokeInvitation: (id: string) => Promise<void>;
  updateUserSkills: (userId: string, skills: string[]) => void | Promise<void>;
  updateWorkspace: (patch: Partial<Workspace>, workspace?: Workspace) => void | Promise<void>;
  createCustomField: (field: {
    name: string;
    type: string;
    description?: string;
    required?: boolean;
    sensitive?: boolean;
    options?: Array<{ label: string; value: string }>;
  }) => void;
  deleteCustomField: (id: string) => void;
  logTime: (taskId: string, minutes: number, description: string) => void | Promise<void>;
  submitTimesheet: (timesheet: Timesheet) => void | Promise<void>;
  reviewTimesheet: (timesheet: Timesheet, decision: "approved" | "rejected", reason?: string) => void | Promise<void>;
  togglePinComment: (id: string, isPinned: boolean) => void;
  deleteComment: (id: string) => void;
  activeOrg: Organization | null;
  taskFilter: Record<string, string | undefined>;
  setActiveView: (v: string) => void;
  notify: (msg: string, kind?: "success" | "error" | "warning" | "info") => void;
};

export const fmtDate = (d: string | Date | null | undefined, locale: string) => {
  if (!d) return "";
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-u-nu-latn" : "en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(d));
};

export const fmtNumber = (value: number, _locale?: string, options?: Intl.NumberFormatOptions) =>
  new Intl.NumberFormat("en-US", options).format(value);

export type Sprint = {
  id: string;
  name: string;
  goal?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  cancelledAt?: string | null;
  status: "planned" | "active" | "completed" | "cancelled";
  projectId: string;
  workspaceId: string;
  organizationId: string;
  createdBy?: string | null;
  createdAt: string;
  updatedAt: string;
};

export const fmtMinutes = (mins: number, locale = "en") => {
  const safeMinutes = Math.max(0, Math.round(mins));
  const hours = Math.floor(safeMinutes / 60);
  const minutes = safeMinutes % 60;
  const number = (value: number) => fmtNumber(value, locale);
  return locale === "ar" ? `${number(hours)} س ${number(minutes)} د` : `${number(hours)}h ${number(minutes)}m`;
};
