"use client";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { Comment, Task, User, ViewCtx, Workspace } from "@/lib/types";
import { PRIORITY_CONFIG, STATUS_CONFIG } from "@/lib/types";
import { cn } from "@/lib/utils";
import { areaCls, Avatar, Badge, Bar, Btn, Field, inputCls, selectCls } from "@/components/ui";
import { confirmAction, promptAction } from "@/components/feedback";
import {
  IconAt,
  IconCheck,
  IconClock,
  IconComment,
  IconDoc,
  IconPaperclip,
  IconPlus,
  IconSend,
  IconShield,
  IconSparkle,
  IconSubtask,
  IconTrash,
  IconUsers,
  IconX,
} from "@/components/icons";
import { useMentionUsers } from "@/features/comments/use-mention-users";
import { TaskAssigneePicker } from "./task-assignee-picker";
import {
  buildClearAllAssigneesMutation,
  buildRemoveAssigneeMutation,
  buildSetLeadMutation,
  resolveTaskPeople,
} from "./assignment-domain";

/* ================= Task Drawer ================= */
export function TaskDrawer({
  ctx,
  task,
  onClose,
  comments,
  subtasks,
  addSubtask,
  toggleSubtask,
  deleteSubtask,
  deleteTask,
  addComment,
  editComment,
  logTime,
}: {
  ctx: ViewCtx;
  task: Task | null;
  onClose: () => void;
  comments: Comment[];
  subtasks: Task[];
  addSubtask: (t: string) => void;
  toggleSubtask: (s: Task) => void;
  deleteSubtask?: (s: Task) => void | Promise<void>;
  deleteTask?: (id: string) => Promise<boolean | void>;
  addComment: (c: string, options?: { parentId?: string; mentionedUserIds?: string[] }) => void | Promise<void>;
  editComment: (id: string, content: string, mentionedUserIds?: string[]) => void | Promise<void>;
  logTime: (id: string, m: number, d: string) => void;
}) {
  const [comment, setComment] = useState("");
  const [replyTo, setReplyTo] = useState<Comment | null>(null);
  const [selectedMentions, setSelectedMentions] = useState<Array<Pick<User, "id" | "name">>>([]);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [editingComment, setEditingComment] = useState<Comment | null>(null);
  const [editText, setEditText] = useState("");
  const [editSelectedMentions, setEditSelectedMentions] = useState<Array<Pick<User, "id" | "name">>>([]);
  const [editMentionIndex, setEditMentionIndex] = useState(0);
  const [activeSection, setActiveSection] = useState<"details" | "work" | "activity">("details");
  const [draftTitle, setDraftTitle] = useState(task?.title ?? "");
  const [draftProgress, setDraftProgress] = useState(task?.progress ?? 0);
  const [assigneePickerOpen, setAssigneePickerOpen] = useState(false);
  const [isAssigning, setIsAssigning] = useState(false);
  const peopleCardRef = useRef<HTMLDivElement>(null);
  const [assigneePickerAnchorRect, setAssigneePickerAnchorRect] = useState<DOMRect | null>(null);

  const people = resolveTaskPeople(task, ctx.users, ctx.members);
  const leadPerson = people.find((p) => p.isLead);
  const contributorPeople = people.filter((p) => p.isContributor);

  const handleSetLead = async (userId: string): Promise<boolean> => {
    if (!task || isAssigning) return false;
    setIsAssigning(true);
    try {
      const payload = buildSetLeadMutation(task, userId);
      return await ctx.updateTask(task.id, {
        expectedVersion: task.version,
        ...payload,
      });
    } finally {
      setIsAssigning(false);
    }
  };

  const handleRemoveAssignee = async (userId: string): Promise<boolean> => {
    if (!task || isAssigning) return false;
    setIsAssigning(true);
    try {
      const payload = buildRemoveAssigneeMutation(task, userId);
      return await ctx.updateTask(task.id, {
        expectedVersion: task.version,
        ...payload,
      });
    } finally {
      setIsAssigning(false);
    }
  };

  const handleClearAssignees = async (): Promise<boolean> => {
    if (!task || isAssigning) return false;
    setIsAssigning(true);
    try {
      const payload = buildClearAllAssigneesMutation();
      return await ctx.updateTask(task.id, {
        expectedVersion: task.version,
        ...payload,
      });
    } finally {
      setIsAssigning(false);
    }
  };

  const handlePickerSave = async (
    result: import("./assignment-domain").AssignmentMutationPayload,
  ): Promise<boolean> => {
    if (!task || isAssigning) return false;
    setIsAssigning(true);
    try {
      const success = await ctx.updateTask(task.id, {
        expectedVersion: task.version,
        ...(result.assigneeId !== undefined ? { assigneeId: result.assigneeId } : {}),
        assigneeIds: result.assigneeIds,
      });
      if (success) {
        setAssigneePickerOpen(false);
        return true;
      }
      return false;
    } finally {
      setIsAssigning(false);
    }
  };

  const mentionMatch = /(?:^|\s)@([^\s@]*)$/.exec(comment);
  const mentionQuery = mentionMatch?.[1] ?? "";
  const { users: mentionUsers, clear: clearMentionUsers } = useMentionUsers({
    taskId: task?.id,
    organizationId: ctx.activeOrg?.id,
    workspaceId: ctx.activeWorkspace?.id,
    actorId: ctx.currentUser?.id,
    query: mentionQuery,
    enabled: mentionMatch !== null,
  });
  const editMentionMatch = /(?:^|\s)@([^\s@]*)$/.exec(editText);
  const editMentionQuery = editMentionMatch?.[1] ?? "";
  const { users: editMentionUsers, clear: clearEditMentionUsers } = useMentionUsers({
    taskId: task?.id,
    organizationId: ctx.activeOrg?.id,
    workspaceId: ctx.activeWorkspace?.id,
    actorId: ctx.currentUser?.id,
    query: editMentionQuery,
    enabled: editingComment !== null && editMentionMatch !== null,
  });

  useEffect(() => setMentionIndex(0), [mentionQuery]);
  useEffect(() => setEditMentionIndex(0), [editMentionQuery]);

  useEffect(() => {
    setDraftTitle(task?.title ?? "");
    setDraftProgress(task?.progress ?? 0);
  }, [task?.id, task?.title, task?.progress]);

  useEffect(() => {
    if (!task) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = originalOverflow;
    };
  }, [task, onClose]);

  if (!task) return null;

  const commitTitle = () => {
    if (draftTitle.trim() && draftTitle !== task.title) {
      ctx.updateTask(task.id, { title: draftTitle.trim() });
    }
  };

  const commitProgress = () => {
    if (draftProgress !== task.progress) {
      ctx.updateTask(task.id, { progress: draftProgress });
    }
  };

  const chooseMention = (user: Pick<User, "id" | "name">) => {
    setComment((current) =>
      current.replace(/(?:^|\s)@([^\s@]*)$/, (match) => `${match.startsWith(" ") ? " " : ""}@[${user.name}] `),
    );
    setSelectedMentions((current) => (current.some((item) => item.id === user.id) ? current : [...current, user]));
    clearMentionUsers();
  };
  const submitComment = async () => {
    if (!comment.trim()) return;
    const activeMentions = selectedMentions
      .filter((user) => comment.includes(`@[${user.name}]`))
      .map((user) => user.id);
    await addComment(comment.trim(), {
      ...(replyTo ? { parentId: replyTo.id } : {}),
      mentionedUserIds: activeMentions,
    });
    setComment("");
    setSelectedMentions([]);
    setReplyTo(null);
  };
  const startEditingComment = (item: Comment) => {
    const mentioned = new Set(item.mentionedUserIds ?? []);
    setEditingComment(item);
    setEditText(item.content);
    setEditSelectedMentions(
      ctx.members
        .filter((member) => mentioned.has(member.userId) && member.user)
        .map((member) => ({ id: member.userId, name: member.user!.name })),
    );
  };
  const chooseEditMention = (user: Pick<User, "id" | "name">) => {
    setEditText((current) =>
      current.replace(/(?:^|\s)@([^\s@]*)$/, (match) => `${match.startsWith(" ") ? " " : ""}@[${user.name}] `),
    );
    setEditSelectedMentions((current) => (current.some((item) => item.id === user.id) ? current : [...current, user]));
    clearEditMentionUsers();
  };
  const submitEdit = async () => {
    if (!editingComment || !editText.trim()) return;
    const activeMentions = editSelectedMentions
      .filter((user) => editText.includes(`@[${user.name}]`))
      .map((user) => user.id);
    await editComment(editingComment.id, editText.trim(), activeMentions);
    setEditingComment(null);
    setEditText("");
    setEditSelectedMentions([]);
  };
  const topLevelComments = comments.filter((item) => !item.parentId);
  const orphanReplies = comments.filter(
    (item) => item.parentId && !topLevelComments.some((parent) => parent.id === item.parentId),
  );
  const threadedComments = topLevelComments
    .sort((a, b) => Number(Boolean(b.isPinned)) - Number(Boolean(a.isPinned)))
    .flatMap((parent) => [parent, ...comments.filter((reply) => reply.parentId === parent.id)])
    .concat(orphanReplies);
  const currentMembershipRole = ctx.members.find((member) => member.userId === ctx.currentUser?.id)?.role;
  const canModerateComments = currentMembershipRole === "owner" || currentMembershipRole === "admin";

  const sections = [
    { id: "details", label: ctx.t("التفاصيل", "Details") },
    { id: "work", label: ctx.t("العمل والمهام الفرعية", "Work & Subtasks") },
    { id: "activity", label: ctx.t("النشاط والتعليقات", "Activity & Comments") },
  ] as const;

  const parentTask = task.parentId ? ctx.tasks.find((t) => t.id === task.parentId) : null;
  const candidateParentTasks = ctx.tasks.filter((t) => !t.parentId && t.id !== task.id);

  const st = STATUS_CONFIG[task.status];
  const pr = PRIORITY_CONFIG[task.priority];
  return (
    <div className="fixed inset-0 z-50 flex justify-end h-dvh">
      <div
        className="absolute inset-0 bg-slate-900/45 backdrop-blur-sm dark:bg-zinc-950/60 animate-fade"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={task.title}
        className="theme-adaptive-panel animate-slide relative flex w-full max-w-[580px] flex-col border-s border-line bg-surface/98 text-ink shadow-2xl"
        style={{ "--slide-x": "-32px" } as CSSProperties}
      >
        {/* Parent Task Breadcrumb / Banner */}
        {task.parentId && (
          <div className="flex items-center gap-2 border-b border-accent/20 bg-accent/5 px-5 py-2 text-[11.5px] select-none">
            <span className="text-accent font-bold">↳ {ctx.t("مهمة فرعية تابعة لـ:", "Subtask of:")}</span>
            <button
              type="button"
              onClick={() =>
                parentTask
                  ? ctx.openTask(parentTask)
                  : ctx.openTaskById?.({
                      id: task.parentId!,
                      organizationId: task.organizationId,
                      workspaceId: task.workspaceId,
                    })
              }
              className="flex items-center gap-1.5 font-bold text-accent hover:underline rounded bg-accent/10 px-2 py-0.5"
            >
              {parentTask ? (
                <>
                  <span className="mono">{parentTask.serial}</span>
                  <span className="truncate max-w-[200px] sm:max-w-[260px]">{parentTask.title}</span>
                </>
              ) : (
                <span>{ctx.t("المهمة الرئيسية", "Parent Task")}</span>
              )}
            </button>
            <Btn
              size="sm"
              variant="ghost"
              onClick={() =>
                parentTask
                  ? ctx.openTask(parentTask)
                  : ctx.openTaskById?.({
                      id: task.parentId!,
                      organizationId: task.organizationId,
                      workspaceId: task.workspaceId,
                    })
              }
              className="ms-auto text-[11px] h-6.5 px-2.5 text-accent font-semibold hover:bg-accent/10"
            >
              {ctx.t("الانتقال للمهمة الرئيسية ←", "Go to Parent →")}
            </Btn>
          </div>
        )}

        <div className="flex h-16 shrink-0 items-center gap-2.5 border-b border-line px-5 bg-surface/90">
          <span className="mono rounded-lg border border-line bg-raised px-2.5 py-1 text-[11px] font-bold text-accent shadow-xs">
            {task.serial}
          </span>
          <Badge tone={st?.tone}>{st?.[ctx.locale === "ar" ? "ar" : "en"]}</Badge>
          <Badge tone={pr?.tone}>{pr?.[ctx.locale === "ar" ? "ar" : "en"]}</Badge>
          {task.parentId && <Badge tone="indigo">{ctx.t("مهمة فرعية", "Subtask")}</Badge>}
          <div className="flex-1" />
          <button
            onClick={onClose}
            aria-label={ctx.t("إغلاق", "Close")}
            className="grid h-8 w-8 place-items-center rounded-xl border border-line text-ink-soft transition-all duration-150 hover:bg-raised hover:text-ink active:scale-95 shadow-xs"
          >
            <IconX size={15} />
          </button>
        </div>

        <nav
          role="tablist"
          aria-label={ctx.t("أقسام المهمة", "Task sections")}
          className="flex border-b border-line px-4 bg-surface/60 backdrop-blur-sm gap-1"
        >
          {sections.map((section) => (
            <button
              key={section.id}
              id={section.id}
              role="tab"
              aria-selected={activeSection === section.id}
              onClick={() => setActiveSection(section.id)}
              className={cn(
                "relative px-3.5 py-3 text-[12.5px] font-semibold transition-all duration-150 active:scale-[0.99]",
                activeSection === section.id
                  ? "text-accent font-bold"
                  : "text-ink-soft hover:text-ink hover:bg-raised/50 rounded-t-lg",
              )}
            >
              {section.label}
              {activeSection === section.id && (
                <span className="absolute bottom-0 inset-x-2 h-0.5 rounded-full bg-accent shadow-[0_0_8px_var(--color-accent)]" />
              )}
            </button>
          ))}
        </nav>

        <div className="flex-1 overflow-y-auto scrollbar-thin">
          <div className="p-5 sm:p-6 space-y-6">
            {/* Title - Always Accessible */}
            <div className="rounded-2xl border border-line bg-raised/40 p-3.5 focus-within:border-accent/40 focus-within:bg-surface focus-within:shadow-sm transition-all duration-200">
              <span className="block text-[10.5px] font-bold uppercase tracking-wider text-ink-faint mb-1">
                {ctx.t("عنوان المهمة", "Task Title")}
              </span>
              <input
                name="auto-field-d5nhmo7"
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
                onBlur={commitTitle}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    commitTitle();
                    e.currentTarget.blur();
                  }
                }}
                className="w-full bg-transparent text-[17px] sm:text-[19px] font-semibold text-ink leading-tight outline-none placeholder:text-ink-faint"
                placeholder={ctx.t("عنوان المهمة…", "Task title…")}
              />
            </div>

            {/* SECTION 1: DETAILS */}
            {activeSection === "details" && (
              <div className="space-y-6 animate-fade">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* People & Assignment Section */}
                  <div
                    ref={peopleCardRef}
                    className="sm:col-span-2 rounded-2xl border border-line bg-raised/20 p-4 space-y-3.5"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <IconUsers size={15} className="text-accent" />
                        <span className="text-[13px] font-bold text-ink">
                          {ctx.t("المسؤولون والمشاركون", "People & Assignment")}
                        </span>
                      </div>
                      {ctx.can("tasks.update") && (
                        <div className="flex items-center gap-1.5">
                          {people.length > 0 && (
                            <button
                              type="button"
                              disabled={isAssigning}
                              onClick={() => void handleClearAssignees()}
                              className="text-[11px] font-medium text-rose-600 dark:text-rose-400 hover:underline px-1.5 py-0.5 disabled:opacity-50"
                            >
                              {ctx.t("إلغاء الكل", "Clear all")}
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={isAssigning}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (peopleCardRef.current) {
                                setAssigneePickerAnchorRect(peopleCardRef.current.getBoundingClientRect());
                              }
                              setAssigneePickerOpen(true);
                            }}
                            className="inline-flex items-center gap-1 rounded-lg border border-line bg-raised px-2.5 py-1 text-[11px] font-semibold text-ink-soft hover:text-ink hover:border-accent/40 transition disabled:opacity-50"
                          >
                            <IconPlus size={11} />
                            {people.length > 0 ? ctx.t("إدارة", "Manage") : ctx.t("تعيين", "Assign")}
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Lead Display */}
                    <div className="space-y-1.5">
                      <div className="text-[10.5px] font-bold uppercase tracking-wider text-ink-faint flex items-center gap-1">
                        <span className="text-amber-500">★</span>
                        {ctx.t("المسؤول الرئيسي (Lead)", "Lead Assignee")}
                      </div>
                      {leadPerson ? (
                        <div className="flex items-center justify-between rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <Avatar src={leadPerson.user.avatarUrl} name={leadPerson.user.name} size={26} />
                            <div className="min-w-0">
                              <div className="text-[12.5px] font-semibold text-ink truncate">
                                {leadPerson.user.name}
                              </div>
                              {leadPerson.user.email && (
                                <div className="text-[10.5px] text-ink-faint truncate">{leadPerson.user.email}</div>
                              )}
                            </div>
                          </div>
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-300 shrink-0">
                            ★ {ctx.t("رئيسي", "Lead")}
                          </span>
                        </div>
                      ) : (
                        <div className="text-[11.5px] italic text-ink-faint px-1">
                          {ctx.t("لا يوجد مسؤول رئيسي معيّن", "No lead assignee")}
                        </div>
                      )}
                    </div>

                    {/* Contributors Display */}
                    <div className="space-y-1.5 pt-0.5">
                      <div className="text-[10.5px] font-bold uppercase tracking-wider text-ink-faint">
                        {ctx.t("المشاركون في التنفيذ (Contributors)", "Contributors")} ({contributorPeople.length})
                      </div>
                      {contributorPeople.length > 0 ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {contributorPeople.map((cp) => (
                            <div
                              key={cp.user.id}
                              className="flex items-center justify-between gap-2 rounded-xl border border-line bg-surface/80 px-2.5 py-1.5"
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <Avatar src={cp.user.avatarUrl} name={cp.user.name} size={22} />
                                <span className="text-[12px] font-medium text-ink truncate">{cp.user.name}</span>
                              </div>
                              {ctx.can("tasks.update") && (
                                <div className="flex items-center gap-1 shrink-0">
                                  <button
                                    type="button"
                                    disabled={isAssigning}
                                    title={ctx.t("تعيين كمسؤول رئيسي", "Set as Lead")}
                                    aria-label={ctx.t(
                                      `تعيين ${cp.user.name} كمسؤول رئيسي`,
                                      `Set ${cp.user.name} as Lead`,
                                    )}
                                    onClick={() => void handleSetLead(cp.user.id)}
                                    className="rounded px-1.5 py-0.5 text-[10px] font-medium text-ink-faint hover:text-amber-600 dark:hover:text-amber-400 hover:bg-raised transition disabled:opacity-50"
                                  >
                                    ★ {ctx.t("رئيسي", "Lead")}
                                  </button>
                                  <button
                                    type="button"
                                    disabled={isAssigning}
                                    title={ctx.t("إزالة من المهمة", "Remove")}
                                    aria-label={ctx.t(`إزالة ${cp.user.name} من المهمة`, `Remove ${cp.user.name}`)}
                                    onClick={() => void handleRemoveAssignee(cp.user.id)}
                                    className="rounded p-1 text-ink-faint hover:text-rose-600 hover:bg-rose-500/10 transition disabled:opacity-50"
                                  >
                                    <IconX size={12} />
                                  </button>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-[11.5px] italic text-ink-faint px-1">
                          {ctx.t("لا يوجد مشاركون إضافيون", "No contributors")}
                        </div>
                      )}
                    </div>

                    {/* Assignee Picker Popover */}
                    {assigneePickerOpen && (
                      <TaskAssigneePicker
                        task={task}
                        users={ctx.users}
                        members={ctx.members}
                        canEdit={ctx.can("tasks.update")}
                        anchorRect={assigneePickerAnchorRect}
                        onSave={handlePickerSave}
                        onClose={() => setAssigneePickerOpen(false)}
                        t={ctx.t}
                        locale={ctx.locale}
                      />
                    )}
                  </div>

                  <Field label={ctx.t("تاريخ الاستحقاق", "Due date")}>
                    <input
                      name="auto-field-qjf1fey"
                      type="date"
                      defaultValue={task.dueDate ? new Date(task.dueDate).toISOString().split("T")[0] : ""}
                      onChange={(e) =>
                        ctx.updateTask(task.id, {
                          dueDate: e.target.value ? new Date(e.target.value).toISOString() : undefined,
                          ...(task.isMilestone
                            ? { startDate: e.target.value ? new Date(e.target.value).toISOString() : undefined }
                            : {}),
                        })
                      }
                      className={inputCls}
                    />
                  </Field>

                  {/* Parent Task & Hierarchy Management */}
                  <div className="sm:col-span-2">
                    <div className="rounded-2xl border border-line bg-raised/30 p-3.5 space-y-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[11.5px] font-bold text-ink flex items-center gap-1.5">
                          <IconSubtask size={14} className="text-accent" />
                          {ctx.t("المهمة الرئيسية والتبعية (Parent Task)", "Parent Task & Hierarchy")}
                        </span>
                        {parentTask ? (
                          <Badge tone="indigo">{ctx.t("مهمة فرعية", "Subtask")}</Badge>
                        ) : (
                          <Badge tone="neutral">{ctx.t("مهمة رئيسية مستقلة", "Top-level Task")}</Badge>
                        )}
                      </div>

                      {parentTask ? (
                        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5 rounded-xl border border-line bg-surface p-3">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="mono rounded bg-raised px-1.5 py-0.5 text-[10.5px] font-bold text-accent">
                              {parentTask.serial}
                            </span>
                            <span className="truncate text-[13px] font-semibold text-ink">{parentTask.title}</span>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <Btn
                              size="sm"
                              variant="ghost"
                              onClick={() => ctx.openTask(parentTask)}
                              className="h-7.5 text-[11.5px]"
                            >
                              {ctx.t("فتح الأصل", "Open")}
                            </Btn>
                            <button
                              type="button"
                              onClick={() => ctx.updateTask(task.id, { parentId: null })}
                              className="text-[11px] text-rose-600 dark:text-rose-400 hover:underline px-2 py-1 font-medium"
                            >
                              {ctx.t("فصل لتصبح رئيسية", "Make Top-Level")}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <select
                            value=""
                            onChange={(e) => {
                              if (e.target.value) {
                                ctx.updateTask(task.id, { parentId: e.target.value });
                              }
                            }}
                            className={cn(selectCls, "h-9 text-[12px]")}
                          >
                            <option value="">
                              {ctx.t(
                                "+ ربط هذه المهمة كمهمة فرعية لمهمة رئيسية أخرى…",
                                "+ Attach as subtask to another task…",
                              )}
                            </option>
                            {candidateParentTasks.map((candidate) => (
                              <option key={candidate.id} value={candidate.id}>
                                {candidate.serial} — {candidate.title}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="sm:col-span-2">
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5 rounded-xl border border-accent/25 bg-accent/5 p-3 text-[12px]">
                      <div className="flex items-center gap-2 text-accent font-semibold">
                        <span className="text-[15px]">🤖</span>
                        <span>
                          {ctx.t("المسؤول الأمثل بناءً على المهارات والعبء:", "Best assignee by skills & load:")}
                        </span>
                      </div>
                      <button
                        onClick={() => {
                          const bestUser =
                            ctx.users.find((u) =>
                              (u.skills || []).some(
                                (s) =>
                                  task.title.toLowerCase().includes(s.toLowerCase()) ||
                                  (task.description || "").toLowerCase().includes(s.toLowerCase()),
                              ),
                            ) || ctx.users[0];
                          if (bestUser) {
                            ctx.updateTask(task.id, { assigneeId: bestUser.id });
                            ctx.notify(
                              `🤖 ${ctx.t("تم اقتراح وتعيين", "AI assigned to")} ${bestUser.name} (${(bestUser.skills || []).slice(0, 2).join(", ")}) ✓`,
                            );
                          }
                        }}
                        className="rounded-lg bg-accent px-3 py-1.5 text-[11.5px] font-bold text-white shadow-sm hover:brightness-110 active:scale-95 transition-all"
                      >
                        ✨ {ctx.t("تعيين تلقائي (AI Match)", "AI Match Assignee")}
                      </button>
                    </div>
                  </div>

                  <Field label={ctx.t("الحالة", "Status")}>
                    <select
                      name="auto-field-pqwbctu"
                      value={task.status}
                      onChange={(e) => ctx.updateTask(task.id, { status: e.target.value })}
                      className={selectCls}
                    >
                      {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                        <option key={k} value={k}>
                          {ctx.t(v.ar, v.en)}
                        </option>
                      ))}
                    </select>
                  </Field>

                  <Field label={ctx.t("الأولوية", "Priority")}>
                    <select
                      name="auto-field-n6s0sz3"
                      value={task.priority}
                      onChange={(e) => ctx.updateTask(task.id, { priority: e.target.value })}
                      className={selectCls}
                    >
                      {Object.entries(PRIORITY_CONFIG).map(([k, v]) => (
                        <option key={k} value={k}>
                          {ctx.t(v.ar, v.en)}
                        </option>
                      ))}
                    </select>
                  </Field>

                  <Field label={ctx.t("نوع المهمة", "Milestone")}>
                    <button
                      disabled={!task.dueDate && !task.isMilestone}
                      onClick={() => {
                        if (task.isMilestone) {
                          ctx.updateTask(task.id, { isMilestone: false });
                          return;
                        }
                        if (!task.dueDate) return;
                        ctx.updateTask(task.id, {
                          isMilestone: true,
                          startDate: task.dueDate,
                          dueDate: task.dueDate,
                        });
                      }}
                      className={`flex h-10 w-full items-center justify-between rounded-xl border px-3 text-[12px] font-semibold transition-all active:scale-[0.99] disabled:opacity-40 ${task.isMilestone ? "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-300" : "border-line bg-surface text-ink-soft hover:bg-raised"}`}
                    >
                      <span>
                        {task.isMilestone
                          ? ctx.t("علامة فارقة (Milestone)", "Milestone")
                          : ctx.t("مهمة عادية (Task)", "Regular task")}
                      </span>
                      <span className={task.isMilestone ? "rotate-45 text-amber-500 font-bold" : "text-ink-faint"}>
                        ◆
                      </span>
                    </button>
                  </Field>

                  <Field label={ctx.t("سبب التأخير", "Delay Reason")}>
                    <input
                      name="auto-field-g5z8jgo"
                      defaultValue={task.delayReason || ""}
                      onBlur={(e) => ctx.updateTask(task.id, { delayReason: e.target.value })}
                      placeholder={ctx.t("اختياري: بانتظار العميل...", "Optional: waiting on client...")}
                      className={inputCls}
                    />
                  </Field>
                </div>

                {/* Description */}
                <div>
                  <Field label={ctx.t("الوصف والتفاصيل", "Description")}>
                    <textarea
                      name="auto-field-dvv1hqe"
                      defaultValue={task.description || ""}
                      onBlur={(e) => ctx.updateTask(task.id, { description: e.target.value })}
                      placeholder={ctx.t("أضف وصفاً شاملاً للمهمة…", "Add a comprehensive description…")}
                      className={cn(areaCls, "min-h-[120px]")}
                    />
                  </Field>
                </div>

                {/* Custom Fields */}
                {ctx.customFields && ctx.customFields.length > 0 && (
                  <div className="rounded-2xl border border-line bg-raised/40 p-4">
                    <div className="mb-3 text-[11.5px] font-bold uppercase tracking-wider text-accent flex items-center gap-1.5">
                      <IconSparkle size={13} />
                      {ctx.t("الحقول المخصصة لمساحة العمل", "Workspace Custom Fields")}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {ctx.customFields.map((cf) => {
                        const val = (task.customFields || {})[cf.key] || "";
                        return (
                          <Field key={cf.id} label={cf.name}>
                            {cf.type === "single_select" || cf.type === "select" ? (
                              <select
                                name="auto-field-xmd61iv"
                                value={val}
                                onChange={(e) =>
                                  ctx.updateTask(task.id, {
                                    customFields: { ...(task.customFields || {}), [cf.key]: e.target.value },
                                  })
                                }
                                className={selectCls}
                              >
                                <option value="">{ctx.t("اختر...", "Select...")}</option>
                                {(cf.options || []).map((o) => (
                                  <option key={o.value || o.label} value={o.value || o.label}>
                                    {o.label}
                                  </option>
                                ))}
                              </select>
                            ) : cf.type === "date" ? (
                              <input
                                name="auto-field-7nsk28y"
                                type="date"
                                value={val}
                                onChange={(e) =>
                                  ctx.updateTask(task.id, {
                                    customFields: { ...(task.customFields || {}), [cf.key]: e.target.value },
                                  })
                                }
                                className={inputCls}
                              />
                            ) : (
                              <input
                                name="auto-field-8vsbu1t"
                                value={val}
                                onChange={(e) =>
                                  ctx.updateTask(task.id, {
                                    customFields: { ...(task.customFields || {}), [cf.key]: e.target.value },
                                  })
                                }
                                placeholder={cf.description || cf.key}
                                className={inputCls}
                              />
                            )}
                          </Field>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* SECTION 2: WORK & SUBTASKS */}
            {activeSection === "work" && (
              <div className="space-y-6 animate-fade">
                {/* Progress Control */}
                <div className="rounded-2xl border border-line bg-raised/40 p-4">
                  <div className="mb-2.5 flex items-center justify-between">
                    <span className="text-[13px] font-semibold text-ink">{ctx.t("نسبة الإنجاز", "Progress")}</span>
                    <span className="mono text-[13px] font-bold text-accent tabular">{draftProgress}%</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <input
                      name="auto-field-liwpg42"
                      type="range"
                      min={0}
                      max={100}
                      value={draftProgress}
                      onChange={(e) => setDraftProgress(Number(e.target.value))}
                      onPointerUp={commitProgress}
                      onKeyUp={commitProgress}
                      className="w-full accent-accent h-2 bg-line rounded-lg cursor-pointer"
                    />
                  </div>
                </div>

                {/* Subtasks Section */}
                {parentTask ? (
                  <div className="rounded-2xl border border-accent/25 bg-accent/5 p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <IconSubtask size={16} className="text-accent" />
                        <span className="text-[13px] font-bold text-ink">
                          {ctx.t("مهمة فرعية تابعة لـ", "Subtask of")}
                        </span>
                      </div>
                      <Badge tone="indigo">{ctx.t("مهمة فرعية", "Subtask")}</Badge>
                    </div>
                    <div
                      onClick={() => ctx.openTask(parentTask)}
                      className="flex items-center justify-between gap-3 p-3 rounded-xl border border-line bg-surface hover:bg-raised/70 cursor-pointer transition shadow-xs"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="mono rounded bg-raised px-1.5 py-0.5 text-[10.5px] font-bold text-accent">
                          {parentTask.serial}
                        </span>
                        <span className="truncate text-[13px] font-semibold text-ink">{parentTask.title}</span>
                      </div>
                      <Btn size="sm" variant="ghost" onClick={() => ctx.openTask(parentTask)} className="text-accent">
                        {ctx.t("الانتقال للأصل ←", "Go to Parent →")}
                      </Btn>
                    </div>
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => ctx.updateTask(task.id, { parentId: null })}
                        className="text-[11.5px] text-rose-600 dark:text-rose-400 hover:underline flex items-center gap-1 font-medium"
                      >
                        {ctx.t("فصل لتصبح مهمة رئيسية مستقلة", "Convert to Standalone Top-Level Task")}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-line bg-raised/40 p-4">
                    <div className="mb-3.5 flex items-center justify-between gap-2.5">
                      <div className="flex items-center gap-2">
                        <IconSubtask size={15} className="text-accent" />
                        <span className="text-[13px] font-semibold text-ink">
                          {ctx.t("المهام الفرعية", "Subtasks")}
                        </span>
                        <span className="mono rounded-full bg-raised border border-line px-2 py-0.5 text-[10.5px] font-bold text-ink-soft tabular">
                          {subtasks.filter((s) => s.status === "done").length}/{subtasks.length}
                        </span>
                      </div>
                      {subtasks.length > 0 && (
                        <Bar
                          value={(subtasks.filter((s) => s.status === "done").length / subtasks.length) * 100}
                          className="max-w-[120px]"
                        />
                      )}
                    </div>
                    <div className="space-y-2">
                      {subtasks.map((s) => (
                        <div
                          key={s.id}
                          className="flex items-center gap-3 rounded-xl border border-line bg-surface px-3.5 py-2.5 shadow-xs transition-colors hover:bg-raised/60 group"
                        >
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleSubtask(s);
                            }}
                            className={cn(
                              "grid h-5 w-5 place-items-center rounded-md border transition-all duration-150 active:scale-90",
                              s.status === "done"
                                ? "border-emerald-500 bg-emerald-500 text-white"
                                : "border-line text-transparent hover:border-accent",
                            )}
                            style={{ height: 18, width: 18 }}
                          >
                            <IconCheck size={11} />
                          </button>
                          <span
                            onClick={() => ctx.openTask(s)}
                            className={cn(
                              "flex-1 text-[12.5px] font-medium transition-colors cursor-pointer hover:text-accent hover:underline",
                              s.status === "done" ? "text-ink-faint line-through" : "text-ink",
                            )}
                          >
                            {s.title}
                          </span>
                          <span className="mono text-[10px] text-ink-faint">{s.serial}</span>
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              type="button"
                              onClick={() => ctx.openTask(s)}
                              className="text-[10.5px] text-accent font-semibold px-2 py-0.5 rounded bg-accent/10 hover:bg-accent/20 transition"
                            >
                              {ctx.t("تعديل", "Edit")}
                            </button>
                            {ctx.can("tasks.delete") && (
                              <button
                                type="button"
                                title={ctx.t("حذف المهمة الفرعية", "Delete subtask")}
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  const ok = await confirmAction({
                                    title: ctx.t("حذف المهمة الفرعية", "Delete Subtask"),
                                    message: ctx.t(
                                      `هل أنت متأكد من حذف المهمة الفرعية "${s.title}"؟`,
                                      `Are you sure you want to delete subtask "${s.title}"?`,
                                    ),
                                    confirmLabel: ctx.t("حذف", "Delete"),
                                    tone: "danger",
                                  });
                                  if (ok) {
                                    if (deleteSubtask) await deleteSubtask(s);
                                    else if (deleteTask) await deleteTask(s.id);
                                    else if (ctx.deleteTask) await ctx.deleteTask(s.id);
                                  }
                                }}
                                className="p-1 text-ink-faint hover:text-rose-500 rounded hover:bg-rose-500/10 transition"
                              >
                                <IconTrash size={12} />
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          const f = e.target as HTMLFormElement;
                          const i = f.elements.namedItem("sub") as HTMLInputElement;
                          if (i.value.trim()) {
                            addSubtask(i.value.trim());
                            i.value = "";
                          }
                        }}
                        className="flex gap-2 pt-1"
                      >
                        <input
                          name="sub"
                          placeholder={ctx.t("أضف مهمة فرعية جديدة…", "New subtask…")}
                          className={cn(inputCls, "flex-1 h-9 text-[12.5px]")}
                        />
                        <Btn type="submit" variant="primary" size="sm">
                          <IconPlus size={14} />
                          <span>{ctx.t("إضافة", "Add")}</span>
                        </Btn>
                      </form>
                    </div>
                  </div>
                )}

                {/* Estimation, Points, Recurrence */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                  <Field label={ctx.t("الوقت المسجل", "Time Logged")}>
                    <div className="flex h-10 items-center justify-between rounded-xl border border-line bg-surface px-3 shadow-xs">
                      <span className="mono text-[11.5px] font-medium text-ink-soft tabular">
                        {task.estimatedHours}h / {(task.loggedHours ?? 0).toFixed(1)}h
                      </span>
                      <button
                        onClick={async () => {
                          const v = await promptAction({
                            title: ctx.t("تسجيل الوقت", "Log time"),
                            label: ctx.t("عدد الدقائق", "Minutes"),
                            inputMode: "numeric",
                            type: "number",
                            placeholder: "30",
                          });
                          const m = Number(v);
                          if (m > 0) logTime(task.id, m, task.title);
                        }}
                        className="flex items-center gap-1 rounded-lg bg-accent/10 border border-accent/25 px-2 py-1 text-[10.5px] font-semibold text-accent hover:bg-accent hover:text-white transition-all active:scale-95"
                      >
                        <IconClock size={11} />
                        {ctx.t("تسجيل", "Log")}
                      </button>
                    </div>
                  </Field>

                  <Field label={ctx.t("نقاط القصة", "Story Points")}>
                    <div className="flex h-10 items-center rounded-xl border border-line bg-surface px-3 shadow-xs">
                      <span className="mono text-[12px] font-bold text-amber-600 dark:text-amber-400 tabular">
                        {task.storyPoints ?? "—"} pts
                      </span>
                    </div>
                  </Field>

                  <Field label={ctx.t("التكرار", "Recurrence")}>
                    <div className="flex h-10 items-center justify-between rounded-xl border border-line bg-surface px-3 shadow-xs">
                      <span className="text-[11.5px] font-medium text-ink">
                        {task.isRecurring ? ctx.t("أسبوعياً", "Weekly") : ctx.t("مرة واحدة", "One-off")}
                      </span>
                      <button
                        onClick={() => ctx.updateTask(task.id, { isRecurring: !task.isRecurring })}
                        className={`px-2 py-0.5 rounded-md text-[10.5px] font-bold border transition-all active:scale-90 ${task.isRecurring ? "bg-accent text-white border-accent" : "bg-raised border-line text-ink-soft hover:text-ink"}`}
                      >
                        {task.isRecurring ? "✓" : "+"}
                      </button>
                    </div>
                  </Field>
                </div>

                {/* Dependencies */}
                <div className="rounded-2xl border border-line bg-raised/40 p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-[12.5px] font-semibold text-ink">
                      {ctx.t("التبعيات والعلاقات (يسبق / يعتمد على)", "Dependencies & Blocking")}
                    </span>
                    {(task.dependencies || []).length > 0 && (
                      <span className="mono rounded-full bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-300">
                        {(task.dependencies || []).length} {ctx.t("مرتبط", "linked")}
                      </span>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <select id={`dep-${task.id}`} className={cn(selectCls, "flex-1 text-[12px]")}>
                      <option value="">
                        {ctx.t("+ إضافة مهمة يعتمد عليها هذا العمل...", "+ Add blocking dependency task...")}
                      </option>
                      {ctx.tasks
                        .filter((t) => t.id !== task.id && !(task.dependencies || []).includes(t.serial))
                        .map((t) => (
                          <option key={t.id} value={t.serial}>
                            {t.serial} — {t.title.slice(0, 45)} ({t.status})
                          </option>
                        ))}
                    </select>
                    <Btn
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        const el = document.getElementById(`dep-${task.id}`) as HTMLSelectElement;
                        if (el && el.value) {
                          ctx.updateTask(task.id, { dependencies: [...(task.dependencies || []), el.value] });
                          el.value = "";
                        }
                      }}
                    >
                      {ctx.t("ربط", "Link")}
                    </Btn>
                  </div>
                  {(task.dependencies || []).length > 0 && (
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {(task.dependencies || []).map((depSer) => {
                        const depTask = ctx.tasks.find((t) => t.serial === depSer);
                        const isDone = depTask?.status === "done";
                        return (
                          <span
                            key={depSer}
                            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11.5px] ${isDone ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"}`}
                          >
                            <span className="mono font-bold">{depSer}</span>
                            <span className="truncate max-w-[140px]">{depTask?.title || "Linked Task"}</span>
                            <span className="text-[10px] opacity-75">({depTask?.status || "pending"})</span>
                            <button
                              onClick={() =>
                                ctx.updateTask(task.id, {
                                  dependencies: (task.dependencies || []).filter((d) => d !== depSer),
                                })
                              }
                              className="ms-1 hover:text-rose-500 font-bold"
                            >
                              ×
                            </button>
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Reminders */}
                <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                    <div className="flex items-center gap-2 text-amber-700 dark:text-amber-300 font-bold text-[12.5px]">
                      <span>⏰</span>
                      <span>{ctx.t("تذكيرات المهمة والمتابعة", "Task Reminders & Follow-ups")}</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {[
                        ["1h", "بعد ساعة", "In 1 hour"],
                        ["tomorrow", "غداً صباحاً", "Tomorrow morning"],
                        ["2h_before", "قبل الاستحقاق", "2h before due"],
                      ].map(([val, ar, en]) => (
                        <button
                          key={val}
                          onClick={() => {
                            const rems = [
                              ...(task.reminders || []),
                              { id: `rem_${Date.now()}`, time: val, label: ctx.t(ar, en), sent: false },
                            ];
                            ctx.updateTask(task.id, { reminders: rems });
                            ctx.notify(`⏰ ${ctx.t("تم جدولة إشعار تذكير:", "Reminder set:")} ${ctx.t(ar, en)} ✓`);
                          }}
                          className="rounded-lg bg-amber-500/15 border border-amber-500/30 px-2.5 py-1 text-[11px] font-bold text-amber-800 dark:text-amber-200 hover:bg-amber-500/25 transition-all shadow-xs active:scale-95"
                        >
                          + {ctx.t(ar, en)}
                        </button>
                      ))}
                    </div>
                  </div>
                  {(task.reminders || []).length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5 pt-2 border-t border-amber-500/20">
                      {(task.reminders || []).map((rem: any, idx: number) => (
                        <span
                          key={rem.id || idx}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-surface border border-amber-500/30 px-2.5 py-1 text-[11px] font-semibold text-amber-700 dark:text-amber-300 shadow-xs"
                        >
                          <span>🔔 {rem.label}</span>
                          <button
                            onClick={() => {
                              const rems = (task.reminders || []).filter((_: any, i: number) => i !== idx);
                              ctx.updateTask(task.id, { reminders: rems });
                            }}
                            className="hover:text-rose-500 font-bold"
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* SECTION 3: ACTIVITY & COMMENTS */}
            {activeSection === "activity" && (
              <div className="space-y-6 animate-fade">
                {/* Attachments */}
                <div className="rounded-2xl border border-line bg-raised/40 p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <IconPaperclip size={15} className="text-accent" />
                      <span className="text-[13px] font-semibold text-ink">{ctx.t("المرفقات", "Attachments")}</span>
                      <span className="mono rounded-full bg-raised border border-line px-2 py-0.5 text-[10px] font-bold text-ink-soft tabular">
                        {ctx.attachments.length}
                      </span>
                    </div>
                    <label className="inline-flex h-8 cursor-pointer items-center rounded-xl border border-line bg-surface px-3 text-[11px] font-bold text-ink shadow-xs transition hover:bg-raised active:scale-95">
                      <input
                        name="auto-field-julf0ha"
                        type="file"
                        className="hidden"
                        onChange={async (event) => {
                          const input = event.currentTarget;
                          const file = input.files?.[0];
                          if (file) await ctx.addAttachment(task.id, file);
                          input.value = "";
                        }}
                      />
                      + {ctx.t("رفع ملف", "Upload")}
                    </label>
                  </div>
                  <div className="space-y-2">
                    {ctx.attachments.map((att) => (
                      <div
                        key={att.id}
                        className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface px-3.5 py-2.5 text-[12px] shadow-xs"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          {att.previewUrl && att.previewMimeType?.startsWith("image/") ? (
                            <a
                              href={att.previewUrl}
                              target="_blank"
                              rel="noreferrer"
                              aria-label={ctx.t("معاينة المرفق", "Preview attachment")}
                              className="h-10 w-10 shrink-0 rounded-lg border border-accent/20 bg-cover bg-center"
                              style={{ backgroundImage: `url(${JSON.stringify(att.previewUrl)})` }}
                            />
                          ) : (
                            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent border border-accent/20">
                              <IconDoc size={13} />
                            </span>
                          )}
                          <div className="min-w-0">
                            <div className="truncate font-semibold text-ink">{att.fileName}</div>
                            <div className="text-[10px] text-ink-faint mono tabular">
                              {(att.fileSize / 1024 / 1024).toFixed(2)} MB ·{" "}
                              {new Date(att.createdAt).toLocaleDateString(
                                ctx.locale === "ar" ? "ar-u-nu-latn" : "en-US",
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {att.previewUrl && (
                            <a
                              href={att.previewUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-accent hover:underline text-[11px] font-bold"
                            >
                              {ctx.t("معاينة", "Preview")}
                            </a>
                          )}
                          <a
                            href={att.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-accent hover:underline text-[11px] font-bold"
                          >
                            {ctx.t("تحميل ↓", "Download ↓")}
                          </a>
                        </div>
                      </div>
                    ))}
                    {ctx.attachments.length === 0 && (
                      <div className="py-4 text-center text-[11.5px] text-ink-faint border border-dashed border-line rounded-xl">
                        {ctx.t("لا توجد مرفقات مرتبطة بهذه المهمة", "No attachments linked to this task")}
                      </div>
                    )}
                  </div>
                </div>

                {/* Links */}
                <div className="rounded-2xl border border-line bg-raised/40 p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-[15px]">🔗</span>
                      <span className="text-[13px] font-semibold text-ink">
                        {ctx.t("الروابط والمراجع", "External Links")}
                      </span>
                      <span className="mono rounded-full bg-raised border border-line px-2 py-0.5 text-[10px] font-bold text-ink-soft tabular">
                        {((task.customFields?.links as any[]) || []).length}
                      </span>
                    </div>
                    <Btn
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        const title = await promptAction({
                          title: ctx.t("إضافة رابط خارجي", "Add external link"),
                          label: ctx.t(
                            "عنوان الرابط (مثال: Figma UI Spec أو GitHub PR #42)",
                            "Link Title (e.g. Figma Spec or GitHub PR)",
                          ),
                          defaultValue: "Figma UI Specs",
                        });
                        if (!title) return;
                        const url = await promptAction({
                          title: ctx.t("رابط المرجع", "Reference URL"),
                          label: ctx.t("الرابط (URL)", "URL"),
                          defaultValue: "https://figma.com/design/calmboard-v2",
                          inputMode: "url",
                          type: "url",
                        });
                        if (title && url) {
                          const links = [
                            ...((task.customFields?.links as any[]) || []),
                            {
                              id: Date.now(),
                              title,
                              url,
                              icon: url.includes("figma")
                                ? "🎨"
                                : url.includes("github")
                                  ? "🐙"
                                  : url.includes("google")
                                    ? "📑"
                                    : "🔗",
                            },
                          ];
                          ctx.updateTask(task.id, { customFields: { ...(task.customFields || {}), links } });
                          ctx.notify(ctx.t("تم إرفاق الرابط بنجاح ✓", "Link attached ✓"));
                        }
                      }}
                    >
                      + {ctx.t("إضافة رابط", "Add Link")}
                    </Btn>
                  </div>
                  <div className="space-y-2">
                    {((task.customFields?.links as any[]) || []).map((lnk: any, i: number) => (
                      <div
                        key={lnk.id || i}
                        className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface px-3.5 py-2.5 text-[12px] shadow-xs"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent border border-accent/20">
                            {lnk.icon || "🔗"}
                          </span>
                          <div className="min-w-0">
                            <div className="truncate font-semibold text-ink">{lnk.title}</div>
                            <div className="text-[10.5px] text-ink-faint mono truncate">{lnk.url}</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <a
                            href={lnk.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-accent hover:underline text-[11px] font-bold"
                          >
                            {ctx.t("فتح ↗", "Open ↗")}
                          </a>
                          <button
                            onClick={() => {
                              const links = ((task.customFields?.links as any[]) || []).filter(
                                (_: any, idx: number) => idx !== i,
                              );
                              ctx.updateTask(task.id, { customFields: { ...(task.customFields || {}), links } });
                            }}
                            className="text-ink-faint hover:text-rose-500 font-bold"
                          >
                            ×
                          </button>
                        </div>
                      </div>
                    ))}
                    {((task.customFields?.links as any[]) || []).length === 0 && (
                      <div className="py-4 text-center text-[11.5px] text-ink-faint border border-dashed border-line rounded-xl">
                        {ctx.t(
                          "لا توجد روابط مضافة، أضف روابط لتصاميم Figma أو فروع GitHub",
                          "No external links attached. Add Figma designs or GitHub PRs",
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Comments Section */}
                <div className="rounded-2xl border border-line bg-raised/40 p-4">
                  <div className="mb-4 flex items-center gap-2">
                    <IconComment size={15} className="text-accent" />
                    <span className="text-[13px] font-semibold text-ink">{ctx.t("التعليقات", "Comments")}</span>
                    <span className="mono rounded-full bg-raised border border-line px-2 py-0.5 text-[10.5px] font-bold text-ink-soft tabular">
                      {comments.length}
                    </span>
                  </div>
                  <div className="flex gap-3">
                    <Avatar src={ctx.currentUser?.avatarUrl} name={ctx.currentUser?.name} size={30} />
                    <div className="flex-1">
                      {replyTo && (
                        <div className="mb-2 flex items-center justify-between rounded-lg bg-accent/10 border border-accent/20 px-3 py-2 text-[11px] text-accent font-semibold">
                          <span>
                            {ctx.t("رد على", "Replying to")} {replyTo.user?.name}
                          </span>
                          <button
                            type="button"
                            onClick={() => setReplyTo(null)}
                            aria-label={ctx.t("إلغاء الرد", "Cancel reply")}
                          >
                            <IconX size={13} />
                          </button>
                        </div>
                      )}
                      <textarea
                        name="auto-field-489335h"
                        value={comment}
                        onChange={(e) => setComment(e.target.value)}
                        aria-label={ctx.t("نص التعليق", "Comment text")}
                        aria-autocomplete="list"
                        placeholder={ctx.t("اكتب تعليقاً… (@ للإشارة)", "Write a comment… (@ to mention)")}
                        className={areaCls}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                            void submitComment();
                          } else if (mentionUsers.length && e.key === "ArrowDown") {
                            e.preventDefault();
                            setMentionIndex((current) => (current + 1) % mentionUsers.length);
                          } else if (mentionUsers.length && e.key === "ArrowUp") {
                            e.preventDefault();
                            setMentionIndex((current) => (current - 1 + mentionUsers.length) % mentionUsers.length);
                          } else if (mentionUsers.length && e.key === "Enter") {
                            e.preventDefault();
                            const selected = mentionUsers[mentionIndex];
                            if (selected) chooseMention(selected);
                          }
                        }}
                      />
                      {mentionUsers.length > 0 && (
                        <div
                          role="listbox"
                          aria-label={ctx.t("أعضاء يمكن الإشارة إليهم", "Mentionable members")}
                          className="mt-1 max-h-48 overflow-y-auto rounded-xl border border-line bg-surface p-1 shadow-xl ring-1 ring-line"
                        >
                          {mentionUsers.map((user, index) => (
                            <button
                              key={user.id}
                              type="button"
                              role="option"
                              aria-selected={index === mentionIndex}
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={() => chooseMention(user)}
                              className={cn(
                                "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-start text-xs transition-colors",
                                index === mentionIndex
                                  ? "bg-accent/15 text-accent font-semibold"
                                  : "text-ink-soft hover:bg-raised hover:text-ink",
                              )}
                            >
                              <Avatar src={user.avatarUrl} name={user.name} size={24} />
                              <span className="min-w-0">
                                <strong className="block truncate text-ink">{user.name}</strong>
                                <bdi dir="ltr" className="block truncate text-[10px] text-ink-faint">
                                  {user.email}
                                </bdi>
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                      <div className="mt-2.5 flex items-center justify-between">
                        <span className="text-[10.5px] text-ink-faint">
                          {ctx.t("⌘+Enter للإرسال", "⌘+Enter to send")}
                        </span>
                        <div className="flex gap-1.5">
                          <label className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-line text-ink-soft transition hover:bg-raised hover:text-ink active:scale-95">
                            <input
                              name="auto-field-pnzuus9"
                              type="file"
                              className="hidden"
                              onChange={async (event) => {
                                const input = event.currentTarget;
                                const file = input.files?.[0];
                                if (file) await ctx.addAttachment(task.id, file);
                                input.value = "";
                              }}
                            />
                            <IconPaperclip size={13} />
                          </label>
                          <Btn
                            size="sm"
                            variant="ghost"
                            onClick={() => setComment((p) => `${p}${p && !p.endsWith(" ") ? " " : ""}@`)}
                          >
                            <IconAt size={13} />
                          </Btn>
                          <Btn
                            size="sm"
                            variant="glow"
                            onClick={() => {
                              void submitComment();
                            }}
                          >
                            <IconSend size={13} />
                            {ctx.t("إرسال", "Send")}
                          </Btn>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="mt-5 space-y-3.5">
                    {threadedComments.map((c) => {
                      const canModerateComments = ctx.can("comments.moderate") || ctx.can("comments.manage");
                      const canModifyComment = (comment: Comment) =>
                        comment.userId === ctx.currentUser?.id || canModerateComments;
                      return (
                        <div
                          key={c.id}
                          className={`flex gap-3 rounded-2xl p-3 border border-line bg-surface shadow-xs transition ${c.parentId ? "ms-6 sm:ms-8 border-s-2 border-accent/40 bg-accent/5" : ""} ${c.isPinned ? "border-amber-500/40 bg-amber-500/5 ring-1 ring-amber-500/20" : ""}`}
                        >
                          <Avatar src={c.user?.avatarUrl} name={c.user?.name} size={30} />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <span className="text-[12.5px] font-bold text-ink">{c.user?.name}</span>
                                {c.isPinned && (
                                  <Badge tone="amber" className="px-1.5! text-[10px]!">
                                    📌 {ctx.t("مثبت", "Pinned")}
                                  </Badge>
                                )}
                                <span className="text-[10px] text-ink-faint">
                                  {new Date(c.createdAt).toLocaleString(ctx.locale === "ar" ? "ar-u-nu-latn" : "en-US")}
                                </span>
                              </div>
                              <div className="flex items-center gap-1 opacity-80 hover:opacity-100">
                                {canModerateComments && (
                                  <button
                                    onClick={() => ctx.togglePinComment(c.id, !c.isPinned)}
                                    className="px-1 text-[11px] text-ink-soft hover:text-amber-500"
                                    title={ctx.t("تثبيت / إلغاء", "Pin / Unpin")}
                                  >
                                    {c.isPinned ? "📌" : "📍"}
                                  </button>
                                )}
                                {canModifyComment(c) && (
                                  <button
                                    onClick={() => startEditingComment(c)}
                                    className="px-1 text-[11px] text-ink-soft hover:text-accent"
                                    title={ctx.t("تعديل", "Edit")}
                                  >
                                    ✏️
                                  </button>
                                )}
                                {ctx.can("tasks.create") && (
                                  <button
                                    onClick={() => {
                                      if (ctx.createTask) {
                                        ctx.createTask({
                                          title: c.content.slice(0, 80),
                                          description: `تم إنشاؤه من تعليق بواسطة @${c.user?.name || "عضو"}:\n\n> ${c.content}`,
                                        });
                                        ctx.notify(
                                          ctx.t("تم تحويل التعليق إلى مهمة ✨", "Comment turned into task ✨"),
                                        );
                                      }
                                    }}
                                    className="text-[11px] text-ink-soft hover:text-accent px-1"
                                    title={ctx.t("تحويل إلى مهمة", "Turn into task")}
                                  >
                                    ✨
                                  </button>
                                )}
                                {canModifyComment(c) && (
                                  <button
                                    onClick={() => ctx.deleteComment(c.id)}
                                    className="px-1 text-[11px] text-ink-soft hover:text-rose-500"
                                    title={ctx.t("حذف", "Delete")}
                                  >
                                    🗑️
                                  </button>
                                )}
                              </div>
                            </div>
                            {editingComment?.id === c.id ? (
                              <div className="relative mt-2 space-y-2">
                                <textarea
                                  value={editText}
                                  onChange={(event) => setEditText(event.target.value)}
                                  aria-label={ctx.t("تعديل نص التعليق", "Edit comment text")}
                                  aria-autocomplete="list"
                                  className={areaCls}
                                  onKeyDown={(event) => {
                                    if (editMentionUsers.length && event.key === "ArrowDown") {
                                      event.preventDefault();
                                      setEditMentionIndex((current) => (current + 1) % editMentionUsers.length);
                                    } else if (editMentionUsers.length && event.key === "ArrowUp") {
                                      event.preventDefault();
                                      setEditMentionIndex(
                                        (current) => (current - 1 + editMentionUsers.length) % editMentionUsers.length,
                                      );
                                    } else if (editMentionUsers.length && event.key === "Enter") {
                                      event.preventDefault();
                                      const selected = editMentionUsers[editMentionIndex];
                                      if (selected) chooseEditMention(selected);
                                    } else if (event.key === "Escape") {
                                      setEditingComment(null);
                                    }
                                  }}
                                />
                                {editMentionUsers.length > 0 && (
                                  <div
                                    role="listbox"
                                    className="absolute z-20 w-full rounded-xl border border-line bg-surface p-1 shadow-xl ring-1 ring-line"
                                  >
                                    {editMentionUsers.map((user, index) => (
                                      <button
                                        key={user.id}
                                        type="button"
                                        role="option"
                                        aria-selected={index === editMentionIndex}
                                        onMouseDown={(event) => event.preventDefault()}
                                        onClick={() => chooseEditMention(user)}
                                        className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-start text-xs ${index === editMentionIndex ? "bg-accent/15 text-accent font-bold" : "text-ink-soft hover:bg-raised"}`}
                                      >
                                        <Avatar src={user.avatarUrl} name={user.name} size={24} />
                                        <span className="text-ink font-semibold">{user.name}</span>
                                        <bdi dir="ltr" className="ms-auto text-[10px] text-ink-faint">
                                          {user.email}
                                        </bdi>
                                      </button>
                                    ))}
                                  </div>
                                )}
                                <div className="flex gap-2">
                                  <Btn size="sm" variant="glow" onClick={() => void submitEdit()}>
                                    {ctx.t("حفظ", "Save")}
                                  </Btn>
                                  <Btn size="sm" variant="ghost" onClick={() => setEditingComment(null)}>
                                    {ctx.t("إلغاء", "Cancel")}
                                  </Btn>
                                </div>
                              </div>
                            ) : (
                              <div className="mt-1.5 rounded-xl rounded-ss-sm border border-line bg-raised/50 px-3.5 py-2.5 text-[12.5px] leading-relaxed text-ink">
                                {c.content}
                              </div>
                            )}
                            <div className="mt-2.5 flex items-center gap-1.5 flex-wrap">
                              {!c.parentId && (
                                <button
                                  type="button"
                                  onClick={() => setReplyTo(c)}
                                  className="rounded-full px-2.5 py-0.5 text-[11px] font-bold text-accent hover:bg-accent/10 transition-colors"
                                >
                                  {ctx.t("رد", "Reply")}
                                </button>
                              )}
                              {["👍", "❤️", "🎉", "🚀", "👀"].map((em) => {
                                const list = (c.reactions || {})[em] || [];
                                const active = ctx.currentUser && list.includes(ctx.currentUser.name);
                                return (
                                  <button
                                    key={em}
                                    onClick={() => ctx.toggleReaction(c.id, em)}
                                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] border transition-all active:scale-90 ${active ? "border-accent/50 bg-accent/15 text-accent font-bold shadow-xs" : "border-line bg-surface text-ink-soft hover:text-ink hover:bg-raised"}`}
                                  >
                                    <span>{em}</span>
                                    {list.length > 0 && <span className="mono font-bold tabular">{list.length}</span>}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    {comments.length === 0 && (
                      <div className="py-6 text-center text-[12px] text-ink-faint">
                        {ctx.t("لا توجد تعليقات بعد، كن أول من يعلّق!", "No comments yet. Be the first to comment!")}
                      </div>
                    )}
                  </div>
                </div>

                {/* Tenant Security Badge */}
                <div className="flex gap-3 rounded-2xl border border-accent/20 bg-accent/5 p-4 shadow-xs">
                  <IconShield size={16} className="shrink-0 text-accent mt-0.5" />
                  <div>
                    <div className="text-[12px] font-bold text-ink">
                      {ctx.t("عزل المستأجرين مفعّل وآمن", "Tenant isolation active & verified")}
                    </div>
                    <div className="mt-0.5 text-[11px] leading-relaxed text-ink-soft">
                      {ctx.t(
                        "كل عملية تُفحص صلاحياتها في الخادم مع RLS وعزل كامل للبيانات.",
                        "Every operation is permission-checked server-side with RLS & full data isolation.",
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Drawer Sticky Footer */}
        <div className="shrink-0 flex items-center justify-between gap-3 border-t border-line bg-surface/95 px-5 py-3.5 backdrop-blur-md">
          {ctx.can("tasks.delete") ? (
            <button
              type="button"
              onClick={async () => {
                const ok = await confirmAction({
                  title: task.parentId
                    ? ctx.t("حذف المهمة الفرعية", "Delete Subtask")
                    : ctx.t("حذف المهمة", "Delete Task"),
                  message: ctx.t(
                    `هل أنت متأكد من حذف "${task.title}"؟ لا يمكن التراجع عن هذا الإجراء.`,
                    `Are you sure you want to delete "${task.title}"? This cannot be undone.`,
                  ),
                  confirmLabel: ctx.t("حذف", "Delete"),
                  tone: "danger",
                });
                if (ok) {
                  if (deleteTask) await deleteTask(task.id);
                  else if (ctx.deleteTask) await ctx.deleteTask(task.id);
                  onClose();
                }
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-rose-500/30 bg-rose-500/10 text-[11.5px] font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-500/20 transition active:scale-95"
            >
              <IconTrash size={13} />
              <span>
                {task.parentId ? ctx.t("حذف المهمة الفرعية", "Delete Subtask") : ctx.t("حذف المهمة", "Delete Task")}
              </span>
            </button>
          ) : (
            <div />
          )}

          <div className="flex items-center gap-2">
            <Btn variant="outline" size="sm" onClick={onClose}>
              {ctx.t("إغلاق", "Close")}
            </Btn>
          </div>
        </div>
      </div>
    </div>
  );
}
