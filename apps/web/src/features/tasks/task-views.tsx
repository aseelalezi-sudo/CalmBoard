"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import {
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  type DraggableAttributes,
  type DraggableSyntheticListeners,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { ViewCtx, Task } from "@/lib/types";
import { STATUS_CONFIG, PRIORITY_CONFIG, STATUS_ORDER, fmtDate, fmtNumber } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge, Avatar, Bar, Card, Empty, SectionTitle, Btn, Toggle, ScreenState } from "@/components/ui";
import { confirmAction, promptAction } from "@/components/feedback";
import { useBulkTaskActions } from "@/features/tasks/use-bulk-task-actions";
import { AdvancedWorkload } from "./advanced-workload";
import {
  IconPlus,
  IconSearch,
  IconList,
  IconCalendar,
  IconCheck,
  IconPlay,
  IconSparkle,
  IconTag,
  IconSubtask,
  IconTrend,
  IconFlag,
  IconCollapse,
  IconChevronDown,
  IconTrash,
  IconX,
} from "@/components/icons";

export { AdvancedTaskTable as TableView } from "./advanced-task-table";
export { AdvancedTaskCalendar as CalendarView } from "./advanced-task-calendar";
export { AdvancedTaskGantt as TimelineView } from "./advanced-task-gantt";

const dateLocale = (l: string) => (l === "ar" ? "ar-u-nu-latn" : "en-US");

/* ================= Quick Inline Task Input ================= */
function QuickInlineTaskInput({ ctx, status, onClose }: { ctx: ViewCtx; status: string; onClose: () => void }) {
  const [title, setTitle] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = async () => {
    if (!title.trim() || submitting) return;
    setSubmitting(true);
    const success = await ctx.createTask({
      title: title.trim(),
      status,
    });
    setSubmitting(false);
    if (success) {
      setTitle("");
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      onClose();
    } else if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      await submit();
    }
  };

  return (
    <div className="rounded-xl border-2 border-indigo-500/40 bg-white p-2.5 shadow-md dark:border-indigo-400/40 dark:bg-[#151522] animate-fade">
      <input
        ref={inputRef}
        type="text"
        value={title}
        disabled={submitting}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={ctx.t(
          "ما الذي تريد إنجازه؟ (Enter للحفظ، Esc للإلغاء)",
          "What needs to be done? (Enter to save, Esc)",
        )}
        className="w-full bg-transparent text-[13px] font-medium text-slate-900 placeholder:text-slate-400 focus:outline-none dark:text-zinc-100 dark:placeholder:text-zinc-500"
      />
      <div className="mt-2 flex items-center justify-between gap-2 border-t border-slate-100 pt-2 dark:border-white/5">
        <span className="text-[10px] text-slate-400 dark:text-zinc-500">
          {ctx.t("اضغط Enter للإضافة السريعة", "Press Enter to add")}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 py-1 text-[11px] font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-zinc-400 dark:hover:bg-white/5"
          >
            {ctx.t("إلغاء", "Cancel")}
          </button>
          <button
            type="button"
            disabled={!title.trim() || submitting}
            onClick={() => void submit()}
            className="rounded-lg bg-indigo-600 px-2.5 py-1 text-[11px] font-bold text-white shadow-xs transition hover:bg-indigo-500 disabled:opacity-50"
          >
            {submitting ? ctx.t("جارٍ الإضافة…", "Adding…") : ctx.t("إضافة", "Add")}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ================= Task Card (Board) ================= */
function TaskCard({
  ctx,
  task,
  dragHandle,
  overlay = false,
}: {
  ctx: ViewCtx;
  task: Task;
  dragHandle?: { attributes: DraggableAttributes; listeners: DraggableSyntheticListeners };
  overlay?: boolean;
}) {
  const [expandedSubtasks, setExpandedSubtasks] = useState(false);
  const [subtaskInput, setSubtaskInput] = useState("");
  const [subtaskSubmitting, setSubtaskSubmitting] = useState(false);

  const pr = PRIORITY_CONFIG[task.priority];
  const isDone = task.status === "done";
  const overdue = task.dueDate && new Date(task.dueDate) < new Date() && !isDone;

  const taskSubtasks = useMemo(() => ctx.tasks.filter((t) => t.parentId === task.id), [ctx.tasks, task.id]);

  return (
    <div
      onClick={() => {
        if (!overlay) ctx.openTask(task);
      }}
      className={cn(
        "task-card group relative cursor-pointer overflow-hidden rounded-xl border bg-white p-3.5 shadow-sm transition-all duration-150 hover:shadow-md dark:bg-[#12121c]",
        isDone
          ? "border-emerald-200/80 bg-emerald-50/15 opacity-90 dark:border-emerald-500/20 dark:bg-emerald-500/5 hover:opacity-100"
          : "border-slate-200/80 hover:border-slate-300 dark:border-white/[0.07] dark:hover:border-white/15 dark:shadow-none",
        overlay && "cursor-grabbing shadow-xl ring-2 ring-indigo-500/30 dark:shadow-2xl scale-[1.02]",
      )}
    >
      <span className={`absolute inset-y-0 start-0 w-[3px] ${isDone ? "bg-emerald-500" : pr?.bar}`} />
      <div className="flex items-center justify-between gap-2">
        <span className="mono flex items-center gap-1 rounded-md border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 dark:border-white/6 dark:bg-white/5 dark:text-zinc-400">
          {isDone && <IconCheck size={10} className="text-emerald-600 dark:text-emerald-400" />}
          {task.serial}
        </span>
        <div className="flex items-center gap-1.5">
          <Badge tone={isDone ? "emerald" : pr?.tone}>
            {isDone ? ctx.t("منجز", "Done") : pr?.[ctx.locale === "ar" ? "ar" : "en"]}
          </Badge>
          {dragHandle && (
            <button
              {...dragHandle.attributes}
              {...dragHandle.listeners}
              onClick={(event) => event.stopPropagation()}
              aria-label={ctx.t(`اسحب ${task.title}`, `Drag ${task.title}`)}
              className="touch-none rounded-md px-1 py-0.5 text-sm leading-none text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 active:cursor-grabbing dark:text-zinc-500 dark:hover:bg-white/[0.07] dark:hover:text-zinc-200"
            >
              ⠿
            </button>
          )}
        </div>
      </div>
      <div className="mt-2.5">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            if (!overlay) ctx.openTask(task);
          }}
          className={cn(
            "text-start font-semibold transition-colors hover:text-accent hover:underline focus-ring text-[13.5px] leading-snug",
            isDone
              ? "text-slate-600 line-through decoration-slate-400 dark:text-zinc-400"
              : "text-slate-900 dark:text-zinc-100",
          )}
        >
          {task.title}
        </button>
      </div>
      {task.tags?.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1">
          {task.tags.slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 rounded-md border border-indigo-200 bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700 dark:border-indigo-500/15 dark:bg-indigo-500/8 dark:text-indigo-300/90"
            >
              <IconTag size={9} />
              {tag}
            </span>
          ))}
        </div>
      )}
      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Avatar src={task.assignee?.avatarUrl} name={task.assignee?.name} size={22} />
          {task.dueDate && (
            <span
              className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10.5px] ${overdue ? "border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300" : "border-slate-200 bg-slate-100 text-slate-600 dark:border-white/[0.07] dark:bg-white/3 dark:text-zinc-400"}`}
            >
              <IconCalendar size={10} />
              {fmtDate(task.dueDate, ctx.locale)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {taskSubtasks.length > 0 ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setExpandedSubtasks((prev) => !prev);
              }}
              title={ctx.t("عرض/إخفاء المهام الفرعية", "Toggle subtasks checklist")}
              className={cn(
                "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium transition hover:scale-105 active:scale-95",
                taskSubtasks.filter((s) => s.status === "done").length === taskSubtasks.length &&
                  taskSubtasks.length > 0
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300"
                  : "border-slate-200 bg-slate-100 text-slate-600 dark:border-white/[0.07] dark:bg-white/3 dark:text-zinc-400",
              )}
            >
              <IconSubtask size={10} />
              {taskSubtasks.filter((s) => s.status === "done").length}/{taskSubtasks.length}
              <IconChevronDown
                size={10}
                className={cn("transition-transform duration-200", expandedSubtasks && "rotate-180")}
              />
            </button>
          ) : (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setExpandedSubtasks((prev) => !prev);
              }}
              title={ctx.t("إضافة مهمة فرعية", "Add subtask")}
              className="opacity-0 group-hover:opacity-100 inline-flex items-center gap-1 rounded-md border border-dashed border-slate-300 px-1.5 py-0.5 text-[10px] text-slate-500 hover:border-accent hover:text-accent dark:border-white/10 dark:text-zinc-400 transition"
            >
              <IconSubtask size={10} />+
            </button>
          )}
          {task.storyPoints && (
            <span className="grid h-5 w-5 place-items-center rounded-md border border-amber-300 bg-amber-50 text-[10px] font-bold text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300">
              {task.storyPoints}
            </span>
          )}
        </div>
      </div>

      {expandedSubtasks && (
        <div
          className="mt-3 pt-2.5 border-t border-line/60 space-y-1.5 animate-fade-in"
          onClick={(e) => e.stopPropagation()}
        >
          {taskSubtasks.map((sub) => {
            const isSubDone = sub.status === "done";
            return (
              <div
                key={sub.id}
                className="flex items-center gap-2 rounded-lg px-1.5 py-1 text-[11px] hover:bg-slate-50 dark:hover:bg-white/5 transition"
              >
                <input
                  type="checkbox"
                  checked={isSubDone}
                  onChange={async () => {
                    await ctx.updateTask(sub.id, {
                      status: isSubDone ? "todo" : "done",
                      progress: isSubDone ? 0 : 100,
                    });
                  }}
                  className="h-3.5 w-3.5 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500/20 cursor-pointer"
                />
                <span
                  className={cn(
                    "truncate flex-1 font-medium",
                    isSubDone ? "line-through text-slate-400 dark:text-zinc-500" : "text-slate-700 dark:text-zinc-300",
                  )}
                >
                  {sub.title}
                </span>
              </div>
            );
          })}
          <div className="flex items-center gap-1.5 pt-1 px-1">
            <input
              type="text"
              value={subtaskInput}
              disabled={subtaskSubmitting}
              onChange={(e) => setSubtaskInput(e.target.value)}
              onKeyDown={async (e) => {
                if (e.key === "Enter" && !e.shiftKey && subtaskInput.trim()) {
                  e.preventDefault();
                  const val = subtaskInput.trim();
                  setSubtaskSubmitting(true);
                  await ctx.createTask({
                    title: val,
                    parentId: task.id,
                  });
                  setSubtaskSubmitting(false);
                  setSubtaskInput("");
                }
              }}
              placeholder={ctx.t("+ أضف مهمة فرعية… (Enter)", "+ Add subtask… (Enter)")}
              className="flex-1 rounded-md border border-line bg-transparent px-2 py-1 text-[11px] text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
            />
          </div>
        </div>
      )}

      <Bar value={task.progress} className={cn("mt-3 h-[3px]", isDone && "bg-emerald-100 dark:bg-emerald-950")} />
    </div>
  );
}

function SortableTaskCard({ ctx, task, reorderDisabled }: { ctx: ViewCtx; task: Task; reorderDisabled: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: { type: "task", status: task.status },
    disabled: reorderDisabled,
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.3 : 1 }}
    >
      <TaskCard ctx={ctx} task={task} dragHandle={reorderDisabled ? undefined : { attributes, listeners }} />
    </div>
  );
}

function BoardColumn({
  ctx,
  status,
  tasks,
  total,
  hasMore,
  limit,
  reorderDisabled,
  isCollapsed = false,
  onToggleCollapse,
}: {
  ctx: ViewCtx;
  status: string;
  tasks: Task[];
  total: number;
  hasMore: boolean;
  limit?: number;
  reorderDisabled: boolean;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const [quickAdd, setQuickAdd] = useState(false);
  const { setNodeRef, isOver } = useDroppable({
    id: `column:${status}`,
    data: { type: "column", status },
    disabled: reorderDisabled,
  });
  const cfg = STATUS_CONFIG[status];
  const isOverWip = Boolean(limit && total > limit);

  if (isCollapsed) {
    return (
      <div
        ref={setNodeRef}
        onClick={onToggleCollapse}
        title={ctx.t(
          `توسيع عمود (${cfg[ctx.locale === "ar" ? "ar" : "en"]})`,
          `Expand column (${cfg[ctx.locale === "ar" ? "ar" : "en"]})`,
        )}
        className={cn(
          "column-drop group flex w-[48px] shrink-0 cursor-pointer flex-col items-center rounded-2xl border py-4 transition-all duration-200 select-none",
          isOverWip
            ? "border-rose-400/80 bg-rose-50/40 dark:border-rose-500/50 dark:bg-rose-500/4"
            : "border-slate-200/80 bg-slate-100/60 hover:bg-slate-200/60 dark:border-white/6 dark:bg-white/2 dark:hover:bg-white/4",
          isOver && "over ring-2 ring-indigo-500/30 scale-[1.02]",
        )}
      >
        <span className={`h-2.5 w-2.5 rounded-full ${cfg.dot} shadow-[0_0_8px_currentColor]`} />
        <span className="mono mt-3 rounded-md border border-slate-200 bg-white px-1 py-0.5 text-[10px] font-semibold text-slate-700 dark:border-transparent dark:bg-white/10 dark:text-zinc-300 tabular">
          {fmtNumber(total, ctx.locale)}
        </span>
        <div className="mt-6 flex-1 [writing-mode:vertical-rl] rotate-180 text-[12.5px] font-semibold text-slate-700 dark:text-zinc-300 tracking-wide">
          {cfg[ctx.locale === "ar" ? "ar" : "en"]}
        </div>
        <span className="mt-4 grid h-6 w-6 place-items-center rounded-lg text-slate-400 opacity-60 group-hover:opacity-100 group-hover:text-accent transition-opacity">
          <IconCollapse size={13} className="rotate-90" />
        </span>
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "column-drop flex w-[290px] shrink-0 flex-col rounded-2xl border transition",
        isOverWip
          ? "border-rose-400/80 bg-rose-50/40 dark:border-rose-500/50 dark:bg-rose-500/4"
          : "border-slate-200/80 bg-slate-100/60 dark:border-white/6 dark:bg-white/2",
        isOver && "over ring-2 ring-indigo-500/30",
      )}
    >
      <div className="relative px-4 pt-4 pb-3">
        <span className={`absolute inset-x-4 top-0 h-0.5 rounded-full ${cfg.dot} opacity-70`} />
        <div className="flex flex-wrap items-center justify-between gap-1">
          <div className="flex items-center gap-2 min-w-0">
            <span className={`h-2 w-2 shrink-0 rounded-full ${cfg.dot} shadow-[0_0_8px_currentColor]`} />
            <span className="text-[13px] font-semibold text-slate-800 dark:text-zinc-200 truncate">
              {cfg[ctx.locale === "ar" ? "ar" : "en"]}
            </span>
            <span
              className={cn(
                "mono rounded-md border px-1.5 py-0.5 text-[10.5px] font-semibold tabular",
                isOverWip
                  ? "animate-pulse border-rose-300 bg-rose-100 text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/20 dark:text-rose-300"
                  : "border-slate-200 bg-white text-slate-600 dark:border-transparent dark:bg-white/5 dark:text-zinc-400",
              )}
            >
              {fmtNumber(total, ctx.locale)}
              {limit ? ` / ${fmtNumber(limit, ctx.locale)}` : ""}
            </span>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {ctx.can("projects.update") && (
              <button
                onClick={async () => {
                  const value = await promptAction({
                    title: ctx.t("تعيين حد العمل الجاري", "Set WIP limit"),
                    label: ctx.t(
                      `حد العمل الجاري لعمود (${cfg.ar}): أدخل رقماً أو 0 للإلغاء`,
                      `WIP limit for (${cfg.en}): enter a number or 0 to clear`,
                    ),
                    defaultValue: limit ? String(limit) : "5",
                    inputMode: "numeric",
                    type: "number",
                  });
                  if (value === null) return;
                  const parsed = Number(value);
                  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 100_000) {
                    ctx.notify(ctx.t("أدخل عدداً صحيحاً بين 0 و100000", "Enter an integer from 0 to 100000"), "error");
                    return;
                  }
                  void ctx.setProjectWipLimit(status, parsed === 0 ? null : parsed);
                }}
                title={ctx.t("تعيين حد العمل الجاري", "Set WIP limit")}
                className="rounded px-1.5 py-0.5 text-[10px] font-bold text-slate-400 hover:bg-slate-200/60 hover:text-slate-800 dark:text-zinc-500 dark:hover:bg-white/6 dark:hover:text-white"
              >
                WIP
              </button>
            )}
            <button
              disabled={!ctx.can("tasks.create")}
              onClick={() => setQuickAdd(true)}
              title={ctx.t("إضافة مهمة سريعة في هذا العمود", "Quick add task in this column")}
              className="grid h-6 w-6 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-200/60 hover:text-slate-800 disabled:hidden dark:text-zinc-500 dark:hover:bg-white/6 dark:hover:text-white"
            >
              <IconPlus size={13} />
            </button>
            {onToggleCollapse && (
              <button
                type="button"
                onClick={onToggleCollapse}
                title={ctx.t("طي العمود", "Collapse column")}
                className="grid h-6 w-6 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-200/60 hover:text-slate-800 dark:text-zinc-500 dark:hover:bg-white/6 dark:hover:text-white"
              >
                <IconCollapse size={13} className="-rotate-90" />
              </button>
            )}
          </div>
        </div>
        {isOverWip && (
          <div className="mt-1.5 flex items-center gap-1 text-[10.5px] font-bold text-rose-600 dark:text-rose-400">
            <span>⚠️</span>
            <span>{ctx.t("تم تجاوز حد العمل الجاري", "WIP limit exceeded")}</span>
          </div>
        )}
      </div>
      <SortableContext items={tasks.map((task) => task.id)} strategy={verticalListSortingStrategy}>
        <div className="stagger flex min-h-[200px] flex-col gap-2.5 px-3 pb-3">
          {tasks.map((task) => (
            <SortableTaskCard key={task.id} ctx={ctx} task={task} reorderDisabled={reorderDisabled} />
          ))}
          {quickAdd && <QuickInlineTaskInput ctx={ctx} status={status} onClose={() => setQuickAdd(false)} />}
          {tasks.length === 0 && !ctx.can("tasks.create") && (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white/40 py-8 text-center text-[12px] text-slate-500 dark:border-white/10 dark:text-zinc-500">
              {ctx.t("لا توجد مهام في هذا العمود", "No tasks in this column")}
            </div>
          )}
          {tasks.length === 0 && !quickAdd && ctx.can("tasks.create") && (
            <button
              type="button"
              onClick={() => setQuickAdd(true)}
              className="rounded-xl border border-dashed border-slate-300 bg-white/40 py-8 text-[12px] text-slate-500 transition hover:border-indigo-500 hover:text-indigo-600 dark:border-white/10 dark:bg-transparent dark:text-zinc-600 dark:hover:border-indigo-400/40 dark:hover:text-indigo-300"
            >
              {ctx.t("اسحب المهام هنا أو أضف مهمة", "Drop tasks here or add one")}
            </button>
          )}
          {tasks.length > 0 && !quickAdd && ctx.can("tasks.create") && (
            <button
              onClick={() => setQuickAdd(true)}
              className="flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-slate-300 bg-white/40 py-2.5 text-[12px] font-medium text-slate-600 transition hover:border-indigo-500 hover:text-indigo-600 dark:border-white/10 dark:bg-transparent dark:text-zinc-500 dark:hover:border-indigo-400/40 dark:hover:text-indigo-300"
            >
              <IconPlus size={13} />
              {ctx.t("إضافة مهمة سريعة", "Quick add task")}
            </button>
          )}
          {hasMore && (
            <button
              disabled={ctx.taskPagination.loading}
              onClick={() => void ctx.taskPagination.loadMoreStatus(status).catch(() => undefined)}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] font-semibold text-indigo-600 transition hover:bg-indigo-50 disabled:opacity-50 dark:border-white/10 dark:bg-white/3 dark:text-indigo-300 dark:hover:bg-white/6"
            >
              {ctx.taskPagination.loading ? ctx.t("جارٍ التحميل…", "Loading…") : ctx.t("تحميل المزيد", "Load more")}
            </button>
          )}
        </div>
      </SortableContext>
    </div>
  );
}

/* ================= Board View ================= */
export function BoardView({ ctx }: { ctx: ViewCtx }) {
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [collapsedColumns, setCollapsedColumns] = useState<Record<string, boolean>>({});
  const hasActiveFilters = Object.values(ctx.taskFilter).some(Boolean);
  const reorderDisabled = !ctx.can("tasks.update") || hasActiveFilters;
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onDragStart = (event: DragStartEvent) => {
    if (reorderDisabled) return;
    setActiveTask(ctx.tasks.find((task) => task.id === String(event.active.id)) ?? null);
  };
  const onDragEnd = (event: DragEndEvent) => {
    setActiveTask(null);
    if (reorderDisabled) return;
    if (!event.over) return;
    const moving = ctx.tasks.find((task) => task.id === String(event.active.id));
    const targetStatus = event.over.data.current?.status;
    if (!moving || typeof targetStatus !== "string") return;
    const targetTasks = ctx.groupedByStatus[targetStatus] ?? [];
    const overId = String(event.over.id);
    const overIndex = targetTasks.findIndex((task) => task.id === overId);
    const targetIndex =
      event.over.data.current?.type === "task"
        ? Math.max(0, overIndex)
        : targetTasks.filter((task) => task.id !== moving.id).length;
    const currentIndex = (ctx.groupedByStatus[moving.status] ?? []).findIndex((task) => task.id === moving.id);
    if (moving.status === targetStatus && currentIndex === targetIndex) return;
    const limit = ctx.activeProject?.wipLimits?.[targetStatus];
    const targetTotal = ctx.taskPagination.statusTotals[targetStatus] ?? targetTasks.length;
    if (moving.status !== targetStatus && limit && targetTotal >= limit) {
      ctx.notify(
        ctx.t(`لا يمكن النقل: حد العمل الجاري للعمود هو ${limit}`, `Move blocked: this column's WIP limit is ${limit}`),
        "error",
      );
      return;
    }
    const targetWithoutMoving = targetTasks.filter((task) => task.id !== moving.id);
    const boundedTargetIndex = Math.min(targetIndex, targetWithoutMoving.length);
    void ctx.moveTask(moving.id, targetStatus, targetIndex, {
      beforeTaskId: targetWithoutMoving[boundedTargetIndex - 1]?.id ?? null,
      afterTaskId: targetWithoutMoving[boundedTargetIndex]?.id ?? null,
    });
  };

  const toggleColumnCollapse = (status: string) => {
    setCollapsedColumns((prev) => ({
      ...prev,
      [status]: !prev[status],
    }));
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragCancel={() => setActiveTask(null)}
      onDragEnd={onDragEnd}
    >
      {ctx.workspaceDataError && (
        <div
          role="alert"
          className="mb-4 rounded-xl border border-rose-500/20 bg-rose-500/10 p-4 text-xs text-rose-700 dark:text-rose-300"
        >
          {ctx.t("تعذر تحميل لوحة المهام", "Could not load task board")}
        </div>
      )}
      {hasActiveFilters && ctx.can("tasks.update") && (
        <div className="mb-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-[12px] font-medium text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          {ctx.t(
            "امسح مرشحات المهام لإعادة ترتيب البطاقات؛ يمنع ذلك تغيير ترتيب العناصر المخفية دون قصد.",
            "Clear task filters to reorder cards; this prevents hidden tasks from being repositioned accidentally.",
          )}
        </div>
      )}
      <div className="flex items-start gap-4 overflow-x-auto overscroll-x-contain pb-4">
        {STATUS_ORDER.map((status) => (
          <BoardColumn
            key={status}
            ctx={ctx}
            status={status}
            tasks={ctx.groupedByStatus[status] ?? []}
            total={ctx.taskPagination.statusTotals[status] ?? (ctx.groupedByStatus[status] ?? []).length}
            hasMore={ctx.taskPagination.statusHasMore[status] ?? false}
            limit={ctx.activeProject?.wipLimits?.[status]}
            reorderDisabled={reorderDisabled}
            isCollapsed={collapsedColumns[status]}
            onToggleCollapse={() => toggleColumnCollapse(status)}
          />
        ))}
      </div>
      <DragOverlay>{activeTask ? <TaskCard ctx={ctx} task={activeTask} overlay /> : null}</DragOverlay>
    </DndContext>
  );
}

function normalizedTaskProgress(task: Task) {
  return Math.max(0, Math.min(100, Math.round(task.progress || 0)));
}

/* ================= List View ================= */
export function ListView({ ctx }: { ctx: ViewCtx }) {
  const topLevelTasks = useMemo(() => ctx.tasks.filter((t) => !t.parentId), [ctx.tasks]);

  if (ctx.workspaceDataError) {
    return (
      <div
        role="alert"
        className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-6 text-center text-xs text-rose-700 dark:text-rose-300"
      >
        {ctx.t("تعذر تحميل قائمة المهام", "Could not load task list")}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Phone layout */}
      <div className="space-y-3 md:hidden">
        {topLevelTasks.map((task) => {
          const progress = normalizedTaskProgress(task);
          const pr = PRIORITY_CONFIG[task.priority];
          const st = STATUS_CONFIG[task.status];
          return (
            <Card
              key={task.id}
              className="cursor-pointer border border-line bg-surface p-4 transition hover:border-accent/30"
              onClick={() => ctx.openTask(task)}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="mono rounded border border-line bg-raised px-1.5 py-0.5 text-[10.5px] font-bold text-ink-soft">
                  {task.serial}
                </span>
                <Badge tone={pr?.tone}>{pr?.[ctx.locale === "ar" ? "ar" : "en"]}</Badge>
              </div>
              <div className="mt-2 text-start font-semibold text-ink text-[13.5px]">{task.title}</div>
              <div className="mt-3 flex items-center justify-between gap-2 text-xs text-ink-faint">
                <span>{st?.[ctx.locale === "ar" ? "ar" : "en"]}</span>
                <span>{fmtNumber(progress, ctx.locale)}%</span>
              </div>
              <Bar value={progress} className="mt-1.5 h-1" />
            </Card>
          );
        })}
        {topLevelTasks.length === 0 && (
          <Empty
            icon={<IconSearch size={22} />}
            title={ctx.t("لا توجد مهام", "No tasks found")}
            hint={ctx.t("جرّب تغيير الفلاتر أو أنشئ مهمة جديدة", "Try adjusting filters or create a new task")}
          />
        )}
      </div>

      {/* Desktop layout */}
      <div className="hidden overflow-hidden md:block">
        <Card className="overflow-hidden border border-line bg-surface">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-line text-start text-[10.5px] uppercase tracking-wider text-ink-faint bg-raised/50">
                <th className="px-5 py-3.5 font-semibold text-start">{ctx.t("المهمة", "Task")}</th>
                <th className="px-4 py-3.5 font-semibold text-start">{ctx.t("الحالة", "Status")}</th>
                <th className="px-4 py-3.5 font-semibold text-start">{ctx.t("الأولوية", "Priority")}</th>
                <th className="px-4 py-3.5 font-semibold text-start">{ctx.t("المسؤول", "Assignee")}</th>
                <th className="px-4 py-3.5 font-semibold text-start">{ctx.t("الموعد", "Due")}</th>
                <th className="px-4 py-3.5 font-semibold text-start w-[140px]">{ctx.t("التقدم", "Progress")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {topLevelTasks.map((task) => {
                const st = STATUS_CONFIG[task.status];
                const pr = PRIORITY_CONFIG[task.priority];
                const progress = normalizedTaskProgress(task);
                return (
                  <tr
                    key={task.id}
                    onClick={() => ctx.openTask(task)}
                    className="group cursor-pointer transition hover:bg-raised/40"
                  >
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <span className="mono rounded border border-line bg-raised px-1.5 py-0.5 text-[10.5px] font-bold text-ink-soft">
                          {task.serial}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            ctx.openTask(task);
                          }}
                          className="hover:text-accent hover:underline focus-ring text-start font-bold text-ink text-[13.5px]"
                        >
                          {task.title}
                        </button>
                      </div>
                    </td>
                    <td className="px-4 py-3.5" onClick={(e) => e.stopPropagation()}>
                      {(() => {
                        const st = STATUS_CONFIG[task.status] || STATUS_CONFIG.todo;
                        return (
                          <div className="relative inline-flex items-center">
                            <Badge
                              tone={st.tone}
                              className="cursor-pointer font-medium hover:opacity-85 transition-opacity"
                            >
                              <span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} />
                              <span>{ctx.t(st.ar, st.en)}</span>
                            </Badge>
                            <select
                              disabled={!ctx.can("tasks.update")}
                              name={`status-${task.id}`}
                              value={task.status}
                              onChange={(e) =>
                                ctx.updateTask(task.id, {
                                  status: e.target.value,
                                  progress: e.target.value === "done" ? 100 : undefined,
                                })
                              }
                              className="absolute inset-0 cursor-pointer opacity-0"
                              aria-label={ctx.t("تغيير الحالة", "Change status")}
                            >
                              {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                                <option key={k} value={k}>
                                  {ctx.t(v.ar, v.en)}
                                </option>
                              ))}
                            </select>
                          </div>
                        );
                      })()}
                    </td>
                    <td className="px-4 py-3.5" onClick={(e) => e.stopPropagation()}>
                      {(() => {
                        const pr = PRIORITY_CONFIG[task.priority] || PRIORITY_CONFIG.medium;
                        return (
                          <div className="relative inline-flex items-center">
                            <Badge
                              tone={pr.tone}
                              className="cursor-pointer font-medium hover:opacity-85 transition-opacity"
                            >
                              <span>{ctx.t(pr.ar, pr.en)}</span>
                            </Badge>
                            <select
                              disabled={!ctx.can("tasks.update")}
                              name={`priority-${task.id}`}
                              value={task.priority}
                              onChange={(e) => ctx.updateTask(task.id, { priority: e.target.value })}
                              className="absolute inset-0 cursor-pointer opacity-0"
                              aria-label={ctx.t("تغيير الأولوية", "Change priority")}
                            >
                              {Object.entries(PRIORITY_CONFIG).map(([k, v]) => (
                                <option key={k} value={k}>
                                  {ctx.t(v.ar, v.en)}
                                </option>
                              ))}
                            </select>
                          </div>
                        );
                      })()}
                    </td>
                    <td className="px-4 py-3.5" onClick={(e) => e.stopPropagation()}>
                      {(() => {
                        const assigneeName =
                          task.assignee?.name || ctx.users.find((u) => u.id === task.assigneeId)?.name;
                        const avatarUrl =
                          task.assignee?.avatarUrl || ctx.users.find((u) => u.id === task.assigneeId)?.avatarUrl;
                        return (
                          <div className="group relative inline-flex items-center gap-1.5 rounded-lg px-1.5 py-0.5 transition-colors hover:bg-raised cursor-pointer max-w-full">
                            <Avatar src={avatarUrl} name={assigneeName} size={22} />
                            <span className="truncate text-[11.5px] font-medium text-ink-soft group-hover:text-ink">
                              {assigneeName ? assigneeName.split(" ")[0] : ctx.t("غير محدد", "Unassigned")}
                            </span>
                            <select
                              disabled={!ctx.can("tasks.update")}
                              name={`assignee-${task.id}`}
                              value={task.assigneeId || ""}
                              onChange={(e) => ctx.updateTask(task.id, { assigneeId: e.target.value || undefined })}
                              className="absolute inset-0 cursor-pointer opacity-0"
                              aria-label={ctx.t("تعيين مسؤول", "Assign task")}
                            >
                              <option value="">{ctx.t("غير محدد", "Unassigned")}</option>
                              {ctx.users.map((u) => (
                                <option key={u.id} value={u.id}>
                                  {u.name}
                                </option>
                              ))}
                            </select>
                          </div>
                        );
                      })()}
                    </td>
                    <td className="px-4 py-3.5 text-[12px] text-ink-faint font-medium">
                      {task.dueDate ? fmtDate(task.dueDate, ctx.locale) : "—"}
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-2">
                        <Bar value={progress} />
                        <span className="mono w-8 text-end text-[11px] font-bold text-ink-soft tabular">
                          {fmtNumber(progress, ctx.locale)}%
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {ctx.tasks.length === 0 && (
            <Empty
              icon={<IconSearch size={22} />}
              title={ctx.t("لا توجد مهام", "No tasks found")}
              hint={ctx.t("جرّب تغيير الفلاتر أو أنشئ مهمة جديدة", "Try adjusting filters or create a new task")}
            />
          )}
        </Card>
      </div>
    </div>
  );
}

/* ================= Table View (data grid) ================= */
export function LegacyTableView({ ctx }: { ctx: ViewCtx }) {
  const { deleteTasks } = useBulkTaskActions(ctx.tasks, ctx.currentUser?.id);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [sortField, setSortField] = useState<string>("title");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [hiddenCols, setHiddenCols] = useState<string[]>([]);
  const [showColMenu, setShowColMenu] = useState(false);

  const cols = [
    { key: "title", ar: "المهمة", en: "Task", flex: true },
    { key: "status", ar: "الحالة", en: "Status", w: "w-[130px]" },
    { key: "priority", ar: "الأولوية", en: "Priority", w: "w-[110px]" },
    { key: "assignee", ar: "المسؤول", en: "Assignee", w: "w-[150px]" },
    { key: "points", ar: "النقاط", en: "Points", w: "w-[80px]" },
    { key: "estimate", ar: "التقدير", en: "Estimate", w: "w-[90px]" },
    { key: "logged", ar: "المسجل", en: "Logged", w: "w-[90px]" },
    { key: "due", ar: "الموعد", en: "Due", w: "w-[110px]" },
  ].filter((c) => !hiddenCols.includes(c.key));

  const sortedTasks = useMemo(() => {
    return [...ctx.tasks].sort((a, b) => {
      let va: any = a[sortField as keyof Task] || "";
      let vb: any = b[sortField as keyof Task] || "";
      if (sortField === "priority") {
        va = PRIORITY_CONFIG[a.priority]?.weight ?? 0;
        vb = PRIORITY_CONFIG[b.priority]?.weight ?? 0;
      }
      if (va < vb) return sortDir === "asc" ? -1 : 1;
      if (va > vb) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
  }, [ctx.tasks, sortField, sortDir]);

  const toggleSelect = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const toggleSelectAll = () => {
    if (selectedIds.length === ctx.tasks.length) setSelectedIds([]);
    else setSelectedIds(ctx.tasks.map((t) => t.id));
  };

  const handleSort = (key: string) => {
    if (sortField === key) setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    else {
      setSortField(key);
      setSortDir("asc");
    }
  };

  const bulkStatusChange = (status: string) => {
    selectedIds.forEach((id) => ctx.updateTask(id, { status, progress: status === "done" ? 100 : undefined }));
    setSelectedIds([]);
  };

  const bulkAssignChange = (assigneeId: string) => {
    selectedIds.forEach((id) => ctx.updateTask(id, { assigneeId: assigneeId || undefined }));
    setSelectedIds([]);
  };

  return (
    <Card className="overflow-hidden relative">
      {/* Top action bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 dark:border-white/6 px-5 py-3 bg-white/50 dark:bg-transparent">
        <div className="flex items-center gap-3">
          <span className="text-[13px] font-semibold text-slate-900 dark:text-white">
            {ctx.t("شبكة البيانات المتقدمة (TanStack Grid)", "Advanced Data Grid")}
          </span>
          <span className="rounded-full bg-slate-100 dark:bg-white/6 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:text-zinc-400">
            {ctx.tasks.length} {ctx.t("صف", "rows")}
          </span>
        </div>

        <div className="flex items-center gap-2 relative">
          <button
            onClick={() => setShowColMenu(!showColMenu)}
            className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-medium text-slate-700 hover:bg-slate-50 dark:border-white/10 dark:bg-white/4 dark:text-zinc-300 dark:hover:bg-white/8"
          >
            ⚙️ {ctx.t("إدارة الأعمدة", "Columns")}
          </button>
          {showColMenu && (
            <div className="absolute end-0 top-10 z-30 w-48 rounded-xl border border-slate-200 bg-white p-2 shadow-xl dark:border-white/10 dark:bg-zinc-900 dark:shadow-[0_12px_40px_rgba(0,0,0,0.6)] animate-pop">
              <div className="mb-1.5 px-2 text-[10px] font-bold uppercase text-slate-400 dark:text-zinc-500">
                {ctx.t("إظهار / إخفاء الأعمدة", "Toggle columns")}
              </div>
              {["status", "priority", "assignee", "points", "estimate", "logged", "due"].map((key) => {
                const isHidden = hiddenCols.includes(key);
                return (
                  <label
                    key={key}
                    className="flex cursor-pointer items-center justify-between rounded-lg px-2.5 py-1.5 text-[12px] text-slate-700 hover:bg-slate-100 dark:text-zinc-300 dark:hover:bg-white/5"
                  >
                    <span className="capitalize">{key}</span>
                    <input
                      name="auto-field-d29uy1z"
                      type="checkbox"
                      checked={!isHidden}
                      onChange={() =>
                        setHiddenCols((prev) => (isHidden ? prev.filter((x) => x !== key) : [...prev, key]))
                      }
                      className="h-4 w-4 rounded accent-indigo-600 dark:accent-cyan-400"
                    />
                  </label>
                );
              })}
            </div>
          )}

          <Btn
            size="sm"
            variant="ghost"
            onClick={async () => {
              const head = [
                "Serial",
                "Title",
                "Status",
                "Priority",
                "Assignee",
                "Points",
                "Estimate",
                "Logged",
                "Progress",
                "Due",
              ];
              const rows = ctx.tasks.map((x) =>
                [
                  x.serial,
                  `"${(x.title || "").replace(/"/g, '""')}"`,
                  x.status,
                  x.priority,
                  x.assignee?.name || "",
                  x.storyPoints ?? "",
                  x.estimatedHours ?? "",
                  x.loggedHours ?? "",
                  `${x.progress}%`,
                  x.dueDate ? new Date(x.dueDate).toISOString().split("T")[0] : "",
                ].join(","),
              );
              const csv = "\uFEFF" + [head.join(","), ...rows].join("\n");
              const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
              const a = document.createElement("a");
              a.href = URL.createObjectURL(blob);
              a.download = `calmboard-tasks-${new Date().toISOString().split("T")[0]}.csv`;
              a.click();
              URL.revokeObjectURL(a.href);
            }}
          >
            <IconTrend size={13} />
            {ctx.t("تصدير CSV", "Export CSV")}
          </Btn>
          <Btn
            size="sm"
            variant="ghost"
            onClick={() => {
              const tableHtml = `
              <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
              <head><meta charset="UTF-8" /></head>
              <body>
                <table border="1">
                  <thead><tr style="background:#f1f5f9;font-weight:bold;"><th>Serial</th><th>Title</th><th>Status</th><th>Priority</th><th>Assignee</th><th>Points</th><th>Estimate</th><th>Logged</th><th>Progress</th><th>Due Date</th></tr></thead>
                  <tbody>
                    ${ctx.tasks.map((t) => `<tr><td>${t.serial}</td><td>${t.title}</td><td>${t.status}</td><td>${t.priority}</td><td>${t.assignee?.name || ""}</td><td>${t.storyPoints ?? ""}</td><td>${t.estimatedHours ?? ""}</td><td>${t.loggedHours ?? ""}</td><td>${t.progress}%</td><td>${t.dueDate ? new Date(t.dueDate).toISOString().split("T")[0] : ""}</td></tr>`).join("")}
                  </tbody>
                </table>
              </body></html>`;
              const blob = new Blob([tableHtml], { type: "application/vnd.ms-excel;charset=utf-8" });
              const a = document.createElement("a");
              a.href = URL.createObjectURL(blob);
              a.download = `calmboard-grid-${new Date().toISOString().split("T")[0]}.xls`;
              a.click();
              URL.revokeObjectURL(a.href);
              ctx.notify(ctx.t("تم تصدير ملف Excel ✓", "Excel exported ✓"));
            }}
          >
            📊 {ctx.t("تصدير Excel (.xls)", "Excel (.xls)")}
          </Btn>
          <Btn size="sm" variant="ghost" onClick={() => window.print()}>
            🖨️ {ctx.t("طباعة / PDF", "Print / PDF")}
          </Btn>
        </div>
      </div>

      {/* Grid Table */}
      <div className="overflow-x-auto">
        <div className="min-w-[920px]">
          {/* Header Row */}
          <div className="flex items-center border-b border-slate-100 dark:border-white/6 bg-slate-50/70 dark:bg-white/2 px-5 text-[10.5px] uppercase tracking-wider text-slate-500 dark:text-zinc-500">
            <div className="w-8 py-3 shrink-0 flex items-center">
              <input
                name="auto-field-3ttpqy1"
                type="checkbox"
                checked={selectedIds.length === ctx.tasks.length && ctx.tasks.length > 0}
                onChange={toggleSelectAll}
                className="h-4 w-4 rounded border-slate-300 accent-indigo-600 dark:border-white/20 dark:accent-cyan-400"
              />
            </div>
            {cols.map((c) => (
              <button
                key={c.key}
                onClick={() => handleSort(c.key === "title" ? "title" : c.key === "due" ? "dueDate" : c.key)}
                className={`py-3 font-semibold text-start flex items-center gap-1 hover:text-slate-900 dark:hover:text-white transition ${c.flex ? "flex-1" : c.w}`}
              >
                <span>{c[ctx.locale === "ar" ? "ar" : "en"]}</span>
                {(sortField === c.key || (c.key === "due" && sortField === "dueDate")) && (
                  <span className="text-indigo-600 dark:text-violet-400 font-bold">
                    {sortDir === "asc" ? "↑" : "↓"}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Rows */}
          {sortedTasks.map((task) => {
            const st = STATUS_CONFIG[task.status];
            const pr = PRIORITY_CONFIG[task.priority];
            const isSelected = selectedIds.includes(task.id);
            return (
              <div
                key={task.id}
                onClick={() => ctx.openTask(task)}
                className={cn(
                  "flex cursor-pointer items-center border-b border-slate-100 dark:border-white/4 px-5 text-[12.5px] transition last:border-0 hover:bg-slate-50 dark:hover:bg-white/3",
                  isSelected && "bg-indigo-50/60 dark:bg-indigo-500/8",
                )}
              >
                <div className="w-8 py-3 shrink-0 flex items-center" onClick={(e) => e.stopPropagation()}>
                  <input
                    name="auto-field-lvfna4m"
                    type="checkbox"
                    checked={isSelected}
                    onChange={(e) => toggleSelect(task.id, e as any)}
                    className="h-4 w-4 rounded border-slate-300 accent-indigo-600 dark:border-white/20 dark:accent-cyan-400"
                  />
                </div>
                <div className="flex flex-1 items-center gap-2.5 py-3 min-w-0">
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${pr?.bar}`} />
                  <span className="truncate font-medium text-slate-800 dark:text-zinc-200">{task.title}</span>
                </div>
                {!hiddenCols.includes("status") && (
                  <div className="w-[130px] py-3 shrink-0" onClick={(e) => e.stopPropagation()}>
                    {(() => {
                      const st = STATUS_CONFIG[task.status] || STATUS_CONFIG.todo;
                      return (
                        <div className="relative inline-flex items-center">
                          <Badge
                            tone={st.tone}
                            className="cursor-pointer font-medium hover:opacity-85 transition-opacity"
                          >
                            <span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} />
                            <span>{ctx.t(st.ar, st.en)}</span>
                          </Badge>
                          <select
                            name="auto-field-zd2l8bx"
                            value={task.status}
                            disabled={!ctx.can("tasks.update")}
                            onChange={(e) =>
                              ctx.updateTask(task.id, {
                                status: e.target.value,
                                progress: e.target.value === "done" ? 100 : undefined,
                              })
                            }
                            className="absolute inset-0 cursor-pointer opacity-0"
                            aria-label={ctx.t("تغيير الحالة", "Change status")}
                          >
                            {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                              <option key={k} value={k}>
                                {ctx.t(v.ar, v.en)}
                              </option>
                            ))}
                          </select>
                        </div>
                      );
                    })()}
                  </div>
                )}
                {!hiddenCols.includes("priority") && (
                  <div className="w-[110px] py-3 shrink-0">
                    <Badge tone={pr?.tone}>{pr?.[ctx.locale === "ar" ? "ar" : "en"]}</Badge>
                  </div>
                )}
                {!hiddenCols.includes("assignee") && (
                  <div className="w-[150px] py-3 shrink-0" onClick={(e) => e.stopPropagation()}>
                    {(() => {
                      const assigneeName = task.assignee?.name || ctx.users.find((u) => u.id === task.assigneeId)?.name;
                      const avatarUrl =
                        task.assignee?.avatarUrl || ctx.users.find((u) => u.id === task.assigneeId)?.avatarUrl;
                      return (
                        <div className="group relative inline-flex items-center gap-1.5 rounded-lg px-1.5 py-0.5 transition-colors hover:bg-raised cursor-pointer max-w-full">
                          <Avatar src={avatarUrl} name={assigneeName} size={20} />
                          <span className="truncate text-[11.5px] font-medium text-ink-soft group-hover:text-ink">
                            {assigneeName ? assigneeName.split(" ")[0] : ctx.t("غير محدد", "Unassigned")}
                          </span>
                          <select
                            name="auto-field-clqbiye"
                            value={task.assigneeId || ""}
                            disabled={!ctx.can("tasks.update")}
                            onChange={(e) => ctx.updateTask(task.id, { assigneeId: e.target.value || undefined })}
                            className="absolute inset-0 cursor-pointer opacity-0"
                            aria-label={ctx.t("تعيين مسؤول", "Assign task")}
                          >
                            <option value="">{ctx.t("غير محدد", "Unassigned")}</option>
                            {ctx.users.map((u) => (
                              <option key={u.id} value={u.id}>
                                {u.name.split(" ")[0]}
                              </option>
                            ))}
                          </select>
                        </div>
                      );
                    })()}
                  </div>
                )}
                {!hiddenCols.includes("points") && (
                  <div className="w-20 py-3 mono text-[11.5px] text-slate-500 dark:text-zinc-500 tabular shrink-0">
                    {task.storyPoints ?? "—"}
                  </div>
                )}
                {!hiddenCols.includes("estimate") && (
                  <div className="w-[90px] py-3 mono text-[11.5px] text-slate-500 dark:text-zinc-500 tabular shrink-0">
                    {task.estimatedHours ? `${task.estimatedHours}h` : "—"}
                  </div>
                )}
                {!hiddenCols.includes("logged") && (
                  <div className="w-[90px] py-3 mono text-[11.5px] text-indigo-600 dark:text-violet-300/80 tabular shrink-0">
                    {task.loggedHours ? `${Number(task.loggedHours).toFixed(1)}h` : "—"}
                  </div>
                )}
                {!hiddenCols.includes("due") && (
                  <div className="w-[110px] py-3 text-[12px] text-slate-500 dark:text-zinc-500 shrink-0">
                    {task.dueDate ? fmtDate(task.dueDate, ctx.locale) : "—"}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      {ctx.tasks.length === 0 && <Empty icon={<IconSearch size={22} />} title={ctx.t("لا توجد بيانات", "No data")} />}

      {/* Floating Bulk Actions Island Toolbar */}
      {selectedIds.length > 0 &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed bottom-7 inset-x-0 mx-auto w-fit max-w-[calc(100%-2rem)] z-[9999] flex items-center gap-2.5 rounded-2xl border border-line/90 bg-surface/95 dark:bg-zinc-900/95 px-4 py-2.5 shadow-[0_20px_50px_rgba(0,0,0,0.35)] backdrop-blur-xl animate-slide-up text-ink ring-1 ring-black/10 dark:ring-white/10 select-none">
            <div className="flex items-center gap-1.5 rounded-xl bg-accent/15 px-3 py-1.5 text-[12px] font-bold text-accent shrink-0 select-none">
              <IconCheck size={13} />
              <span>
                {fmtNumber(selectedIds.length, ctx.locale)} {ctx.t("مهمة محددة", "selected")}
              </span>
            </div>

            <div className="h-4 w-px bg-line/60 shrink-0" />

            <select
              name="auto-field-iwa4v9b"
              onChange={(e) => {
                if (e.target.value) bulkStatusChange(e.target.value);
              }}
              className="h-8 rounded-xl border border-line bg-raised/80 px-2.5 text-[11.5px] font-semibold text-ink outline-none cursor-pointer hover:bg-surface transition shrink-0"
              aria-label={ctx.t("تغيير الحالة لجميع المهام المحددة", "Bulk change status")}
            >
              <option value="">⚡ {ctx.t("تغيير الحالة…", "Change status…")}</option>
              {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                <option key={k} value={k}>
                  {ctx.t(v.ar, v.en)}
                </option>
              ))}
            </select>

            <select
              name="auto-field-lmlotin"
              onChange={(e) => {
                if (e.target.value !== undefined) bulkAssignChange(e.target.value);
              }}
              className="h-8 rounded-xl border border-line bg-raised/80 px-2.5 text-[11.5px] font-semibold text-ink outline-none cursor-pointer hover:bg-surface transition shrink-0 max-w-[130px] truncate"
              aria-label={ctx.t("تعيين مسؤول لجميع المهام المحددة", "Bulk assign user")}
            >
              <option value="">👤 {ctx.t("تعيين لـ…", "Assign to…")}</option>
              <option value="">{ctx.t("غير محدد (إلغاء التعيين)", "Unassigned")}</option>
              {ctx.users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>

            <div className="h-4 w-px bg-line/60 shrink-0" />

            {ctx.can("tasks.delete") && (
              <button
                type="button"
                onClick={async () => {
                  const confirmed = await confirmAction({
                    title: ctx.t("حذف المهام المحددة", "Delete selected tasks"),
                    message: ctx.t(
                      `هل أنت متأكد من حذف ${fmtNumber(selectedIds.length, ctx.locale)} مهمة؟ لا يمكن التراجع عن هذا الإجراء.`,
                      `Are you sure you want to delete ${selectedIds.length} selected task(s)?`,
                    ),
                    confirmLabel: ctx.t("حذف", "Delete"),
                    tone: "danger",
                  });
                  if (confirmed) {
                    try {
                      if (ctx.deleteTask) {
                        await Promise.all(selectedIds.map((id) => ctx.deleteTask!(id)));
                      } else {
                        await deleteTasks(selectedIds);
                      }
                      setSelectedIds([]);
                    } catch (error: any) {
                      ctx.notify(
                        error?.message ||
                          ctx.t(
                            "تعذر حذف المهام. تحقق من صلاحياتك.",
                            "Could not delete tasks. Check your permissions.",
                          ),
                        "error",
                      );
                    }
                  }
                }}
                className="flex items-center gap-1.5 h-8 rounded-xl bg-rose-500/15 border border-rose-500/30 px-3 text-[11.5px] font-bold text-rose-600 dark:text-rose-400 hover:bg-rose-500/25 transition active:scale-95 shrink-0"
              >
                <IconTrash size={13} />
                <span>{ctx.t("حذف جماعي", "Delete")}</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setSelectedIds([])}
              className="h-8 w-8 grid place-items-center rounded-xl text-ink-faint hover:text-ink hover:bg-raised transition active:scale-95 shrink-0"
              title={ctx.t("إلغاء التحديد", "Deselect")}
            >
              <IconX size={14} />
            </button>
          </div>,
          document.body,
        )}
    </Card>
  );
}

/* ================= Calendar View ================= */
export function LegacyCalendarView({ ctx }: { ctx: ViewCtx }) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  let startOffset = firstDay.getDay(); // 0=Sun
  startOffset = (startOffset + 1) % 7; // shift so Saturday=0 (Arab week start)
  const cells = startOffset + daysInMonth;
  const tasksByDay = new Map<number, Task[]>();
  ctx.tasks.forEach((t) => {
    if (!t.dueDate) return;
    const d = new Date(t.dueDate);
    if (d.getFullYear() === year && d.getMonth() === month) {
      const arr = tasksByDay.get(d.getDate()) || [];
      arr.push(t);
      tasksByDay.set(d.getDate(), arr);
    }
  });
  const monthName = now.toLocaleDateString(dateLocale(ctx.locale), { month: "long", year: "numeric" });
  const weekdays =
    ctx.locale === "ar"
      ? ["السبت", "الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة"]
      : ["Sat", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri"];
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-slate-100 dark:border-white/6 px-5 py-4">
        <span className="text-[15px] font-semibold text-slate-900 dark:text-white">{monthName}</span>
        <Badge tone="indigo">
          {ctx.tasks.filter((t) => t.dueDate).length} {ctx.t("مهمة مجدولة", "scheduled")}
        </Badge>
      </div>
      <div className="grid grid-cols-7 border-b border-slate-100 dark:border-white/6">
        {weekdays.map((d) => (
          <div
            key={d}
            className="border-e border-slate-100 dark:border-white/4 px-3 py-2.5 text-center text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-zinc-500 last:border-e-0"
          >
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {Array.from({ length: Math.ceil(cells / 7) * 7 }).map((_, i) => {
          const day = i - startOffset + 1;
          const inMonth = day >= 1 && day <= daysInMonth;
          const isToday = inMonth && day === now.getDate();
          const dayTasks = inMonth ? tasksByDay.get(day) || [] : [];
          return (
            <div
              key={i}
              className={`group min-h-[104px] border-b border-e border-slate-100 dark:border-white/4 p-2 last:border-e-0 ${!inMonth ? "bg-slate-50/60 dark:bg-white/1" : ""}`}
            >
              {inMonth && (
                <div className="mb-1.5 flex items-center justify-between">
                  <div
                    className={`grid h-6 w-6 place-items-center rounded-lg text-[11.5px] font-semibold ${isToday ? "bg-linear-to-br from-indigo-500 to-violet-500 text-white shadow-sm dark:shadow-[0_0_12px_rgba(99,102,241,0.5)]" : "text-slate-600 dark:text-zinc-500"}`}
                  >
                    {day}
                  </div>
                  <button
                    disabled={!ctx.can("tasks.create")}
                    onClick={async () => {
                      const title = await promptAction({
                        title: ctx.t("إضافة مهمة مجدولة", "Add scheduled task"),
                        label: ctx.t(`مهمة جديدة ليوم ${day} ${monthName}:`, `New task for ${monthName} ${day}:`),
                        defaultValue: ctx.t("مهمة مجدولة", "Scheduled task"),
                      });
                      if (title && title.trim()) {
                        const targetDate = new Date(year, month, day, 12, 0, 0);
                        ctx.createTask({ title, dueDate: targetDate.toISOString() });
                      }
                    }}
                    title={ctx.t("إضافة مهمة في هذا اليوم", "Add task on this day")}
                    className="grid h-5 w-5 place-items-center rounded text-slate-400 opacity-0 transition hover:bg-slate-200/60 hover:text-slate-800 disabled:hidden group-hover:opacity-100 dark:text-zinc-500 dark:hover:bg-white/6 dark:hover:text-white"
                  >
                    +
                  </button>
                </div>
              )}
              <div className="space-y-1">
                {dayTasks.slice(0, 2).map((t) => (
                  <button
                    key={t.id}
                    onClick={() => ctx.openTask(t)}
                    className={`block w-full truncate rounded-md border px-1.5 py-1 text-start text-[10.5px] transition hover:brightness-105 dark:hover:brightness-125 ${STATUS_CONFIG[t.status]?.tone === "emerald" ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-300" : "border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-500/25 dark:bg-indigo-500/10 dark:text-indigo-300"}`}
                  >
                    {t.title}
                  </button>
                ))}
                {dayTasks.length > 2 && (
                  <div className="px-1 text-[10px] text-slate-500 dark:text-zinc-500">
                    +{dayTasks.length - 2} {ctx.t("أخرى", "more")}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/* ================= Workload View ================= */
export function LegacyWorkloadView({ ctx }: { ctx: ViewCtx }) {
  const capacity = 40;
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
      <Card className="p-6">
        <SectionTitle count={ctx.users.length}>{ctx.t("عبء العمل الأسبوعي", "Weekly Workload")}</SectionTitle>
        <div className="stagger space-y-5">
          {ctx.users.map((u) => {
            const userTasks = ctx.tasks.filter((t) => t.assigneeId === u.id);
            const hours = userTasks.reduce((a, t) => a + (t.estimatedHours || 0), 0);
            const pct = Math.min(100, Math.round((hours / capacity) * 100));
            const level = pct > 90 ? "over" : pct > 70 ? "full" : "free";
            return (
              <div
                key={u.id}
                className="flex items-center justify-between gap-4 rounded-xl p-2 transition hover:bg-slate-50 dark:hover:bg-white/2"
              >
                <div className="flex items-center gap-4 flex-1 min-w-0">
                  <Avatar src={u.avatarUrl} name={u.name} size={38} />
                  <div className="w-[140px] shrink-0">
                    <div className="truncate text-[13.5px] font-bold text-slate-900 dark:text-white">{u.name}</div>
                    <div className="text-[11px] text-slate-500 dark:text-zinc-500">
                      {userTasks.length} {ctx.t("مهمة مفتوحة", "tasks")}
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="mb-1.5 flex items-center justify-between text-[11.5px]">
                      <span className="mono text-slate-500 dark:text-zinc-400 font-semibold tabular">
                        {hours}h / {capacity}h {ctx.t("سعة", "cap")}
                      </span>
                      <span
                        className={`mono font-black tabular ${level === "over" ? "text-rose-600 dark:text-rose-400" : level === "full" ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}`}
                      >
                        {pct}%
                      </span>
                    </div>
                    <div className="h-2.5 overflow-hidden rounded-full bg-slate-200 dark:bg-white/6">
                      <div
                        className={`h-full rounded-full transition-all duration-700 ${level === "over" ? "bg-linear-to-r from-rose-500 to-red-500 shadow-[0_0_12px_rgba(244,63,94,0.5)]" : level === "full" ? "bg-linear-to-r from-amber-500 to-orange-400" : "bg-linear-to-r from-emerald-500 to-teal-400"}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <Badge
                    tone={level === "over" ? "rose" : level === "full" ? "amber" : "emerald"}
                    className="px-2.5 py-1 text-[11px]"
                  >
                    {level === "over"
                      ? ctx.t("مثقل 🚨", "Overloaded 🚨")
                      : level === "full"
                        ? ctx.t("ممتلئ", "Full")
                        : ctx.t("متاح ✓", "Available ✓")}
                  </Badge>
                  {level === "over" && userTasks.length > 0 && (
                    <button
                      onClick={() => {
                        const freeUser =
                          ctx.users.find((x) => {
                            const xHours = ctx.tasks
                              .filter((t) => t.assigneeId === x.id)
                              .reduce((a, t) => a + (t.estimatedHours || 0), 0);
                            return x.id !== u.id && xHours <= 25;
                          }) ||
                          ctx.users.find((x) => x.id !== u.id) ||
                          ctx.users[0];
                        const targetTask = userTasks[0];
                        if (targetTask && freeUser) {
                          ctx.updateTask(targetTask.id, { assigneeId: freeUser.id });
                          ctx.notify(
                            `⚖️ ${ctx.t("توازن فوري:", "Quick Rebalance:")} ${ctx.t("نُقلت المهمة", "Moved")} [${targetTask.serial}] ${ctx.t("من", "from")} ${u.name.split(" ")[0]} ${ctx.t("إلى", "to")} ${freeUser.name.split(" ")[0]} ✓`,
                          );
                        }
                      }}
                      title={ctx.t(
                        "نقل مهمة إلى عضو متاح لتوازن الفريق (القسم 10)",
                        "Reassign one task to an available member (Section 10)",
                      )}
                      className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-1.5 text-[11px] font-bold text-rose-700 hover:bg-rose-100 transition shadow-sm dark:border-rose-500/40 dark:bg-rose-500/20 dark:text-rose-200"
                    >
                      ⚖️ {ctx.t("توازن فوري", "Rebalance")}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Card>
      <div className="space-y-5">
        <Card className="p-5">
          <SectionTitle>{ctx.t("ملخص", "Summary")}</SectionTitle>
          <div className="space-y-2.5">
            {[
              {
                k: ctx.t("الساعات المقدرة", "Estimated"),
                v: `${ctx.tasks.reduce((a, b) => a + (b.estimatedHours || 0), 0)}h`,
              },
              { k: ctx.t("مهام متأخرة", "Overdue"), v: `${ctx.stats.overdue}`, danger: ctx.stats.overdue > 0 },
              {
                k: ctx.t("متوسط الإنجاز", "Avg progress"),
                v: `${ctx.tasks.length ? Math.round(ctx.tasks.reduce((a, b) => a + b.progress, 0) / ctx.tasks.length) : 0}%`,
              },
            ].map((it, i) => (
              <div
                key={i}
                className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-3.5 py-3 dark:border-white/6 dark:bg-white/2"
              >
                <span className="text-[12px] text-slate-600 dark:text-zinc-400">{it.k}</span>
                <span
                  className={`mono text-[14px] font-bold tabular ${it.danger ? "text-rose-600 dark:text-rose-400" : "text-slate-900 dark:text-white"}`}
                >
                  {it.v}
                </span>
              </div>
            ))}
          </div>
        </Card>
        <Card className="p-5" glow>
          <div className="flex items-center gap-2 text-indigo-600 dark:text-violet-300">
            <IconSparkle size={15} />
            <span className="text-[12.5px] font-semibold">{ctx.t("اقتراح ذكي", "Smart suggestion")}</span>
          </div>
          <p className="mt-2 text-[12px] leading-relaxed text-slate-600 dark:text-zinc-400">
            {ctx.t(
              "أعد توزيع 3 مهام من الأعضاء المثقلين إلى المتاحين لتوازن الفريق هذا الأسبوع.",
              "Rebalance 3 tasks from overloaded members to available ones this week.",
            )}
          </p>
        </Card>
      </div>
    </div>
  );
}

export function WorkloadView({ ctx }: { ctx: ViewCtx }) {
  return <AdvancedWorkload ctx={ctx} />;
}

/* ================= My Work View ================= */
const PRIORITY_ORDER: Record<string, number> = {
  urgent: 4,
  high: 3,
  medium: 2,
  low: 1,
};

export function MyWorkView({ ctx }: { ctx: ViewCtx }) {
  const [pendingTaskId, setPendingTaskId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  if (!ctx.currentUser) {
    return (
      <Card className="p-8 text-center border border-line bg-surface">
        <ScreenState
          tone="permission"
          title={ctx.t("تسجيل الدخول مطلوب", "Sign in required")}
          description={ctx.t("يرجى تسجيل الدخول للوصول إلى مهامك وأنشطتك.", "Please sign in to view your tasks.")}
        />
      </Card>
    );
  }

  const mine = ctx.tasks.filter((task) => !task.deletedAt && task.assigneeId === ctx.currentUser?.id);
  const open = mine.filter(
    (task) => task.status !== "done" && task.status !== "canceled" && task.status !== "cancelled",
  );
  const now = new Date();
  const todayDateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const dueToday = open
    .filter((task) => task.dueDate && task.dueDate.slice(0, 10) === todayDateStr)
    .sort(
      (a, b) =>
        (PRIORITY_ORDER[b.priority] ?? 0) - (PRIORITY_ORDER[a.priority] ?? 0) || a.serial.localeCompare(b.serial),
    );
  const overdue = open
    .filter((task) => task.dueDate && task.dueDate.slice(0, 10) < todayDateStr)
    .sort(
      (a, b) =>
        (a.dueDate ?? "").localeCompare(b.dueDate ?? "") ||
        (PRIORITY_ORDER[b.priority] ?? 0) - (PRIORITY_ORDER[a.priority] ?? 0) ||
        a.serial.localeCompare(b.serial),
    );
  const upcoming = open
    .filter((task) => task.dueDate && task.dueDate.slice(0, 10) > todayDateStr)
    .sort(
      (a, b) =>
        (a.dueDate ?? "").localeCompare(b.dueDate ?? "") ||
        (PRIORITY_ORDER[b.priority] ?? 0) - (PRIORITY_ORDER[a.priority] ?? 0) ||
        a.serial.localeCompare(b.serial),
    );
  const noDueDate = open
    .filter((task) => !task.dueDate)
    .sort(
      (a, b) =>
        (PRIORITY_ORDER[b.priority] ?? 0) - (PRIORITY_ORDER[a.priority] ?? 0) || a.serial.localeCompare(b.serial),
    );
  const completed = mine
    .filter((task) => task.status === "done")
    .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "") || b.serial.localeCompare(a.serial));

  const toggleTask = async (task: Task) => {
    if (pendingTaskId) return;
    setPendingTaskId(task.id);
    setActionError(null);
    try {
      const isDone = task.status === "done";
      const saved = await ctx.updateTask(task.id, {
        expectedVersion: task.version,
        status: isDone ? "todo" : "done",
        progress: isDone ? 0 : 100,
      });
      if (saved === false) {
        setActionError(
          ctx.t("تعذر تحديث المهمة. بقيت حالتها السابقة.", "Could not update task. Previous state retained."),
        );
      }
    } catch {
      setActionError(
        ctx.t("تعذر تحديث المهمة. بقيت حالتها السابقة.", "Could not update task. Previous state retained."),
      );
    } finally {
      setPendingTaskId(null);
    }
  };

  const sections = [
    {
      id: "today",
      icon: <IconPlay size={14} />,
      title_ar: "مهامي اليوم",
      title_en: "Today",
      list: dueToday,
    },
    {
      id: "upcoming",
      icon: <IconCalendar size={14} />,
      title_ar: "المهام القادمة",
      title_en: "Upcoming",
      list: upcoming,
    },
    {
      id: "overdue",
      icon: <IconFlag size={14} />,
      title_ar: "متأخرة",
      title_en: "Overdue",
      list: overdue,
    },
    {
      id: "no_due_date",
      icon: <IconList size={14} />,
      title_ar: "بدون موعد استحقاق",
      title_en: "No Due Date",
      list: noDueDate,
    },
    {
      id: "done",
      icon: <IconCheck size={14} />,
      title_ar: "أنجزتها",
      title_en: "Completed",
      list: completed,
    },
  ];

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
      <div className="space-y-5">
        {actionError && (
          <div
            role="alert"
            className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-xs text-rose-700 dark:text-rose-300"
          >
            {actionError}
          </div>
        )}
        {sections.map((s) => (
          <Card key={s.id} className="overflow-hidden border border-line bg-surface">
            <div className="flex items-center gap-2.5 border-b border-line px-5 py-3.5">
              <span className="grid h-7 w-7 place-items-center rounded-lg bg-accent/10 border border-accent/20 text-accent">
                {s.icon}
              </span>
              <span className="text-[13.5px] font-semibold text-ink">{ctx.t(s.title_ar, s.title_en)}</span>
              <span className="mono rounded-md bg-raised px-1.5 py-0.5 text-[10.5px] text-ink-faint tabular">
                {fmtNumber(s.list.length, ctx.locale)}
              </span>
            </div>
            <div className="divide-y divide-line">
              {s.list.map((task) => {
                const pr = PRIORITY_CONFIG[task.priority];
                return (
                  <div
                    key={task.id}
                    onClick={() => ctx.openTask(task)}
                    className="group flex cursor-pointer items-center gap-3 px-5 py-3.5 transition hover:bg-raised/40"
                  >
                    <button
                      type="button"
                      disabled={pendingTaskId === task.id}
                      aria-busy={pendingTaskId === task.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        void toggleTask(task);
                      }}
                      className={`grid h-5 w-5 shrink-0 place-items-center rounded-md border transition ${
                        task.status === "done"
                          ? "border-emerald-500 bg-emerald-500/20 text-emerald-600 dark:text-emerald-300"
                          : "border-line text-transparent hover:border-accent"
                      }`}
                    >
                      <IconCheck size={11} />
                    </button>
                    <div className="min-w-0 flex-1">
                      <div
                        className={`truncate text-[13px] font-medium ${
                          task.status === "done" ? "text-ink-faint line-through" : "text-ink group-hover:text-accent"
                        }`}
                      >
                        {task.title}
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-[11px] text-ink-faint">
                        <span className="mono">{task.serial}</span>
                        {task.dueDate && <span>• {fmtDate(task.dueDate, ctx.locale)}</span>}
                      </div>
                    </div>
                    <Badge tone={pr?.tone}>{pr?.[ctx.locale === "ar" ? "ar" : "en"]}</Badge>
                  </div>
                );
              })}
              {s.list.length === 0 && (
                <div className="px-5 py-8 text-center text-[12.5px] text-ink-faint">
                  {ctx.t("لا شيء هنا 🎉", "Nothing here 🎉")}
                </div>
              )}
            </div>
          </Card>
        ))}
      </div>
      <div className="space-y-5">
        <Card className="border border-line bg-surface p-5">
          <SectionTitle>{ctx.t("ملخص مهامي", "My Summary")}</SectionTitle>
          <p className="mb-3 text-[11.5px] text-ink-faint">
            {ctx.t("الأرقام مشتقة من المهام المحمّلة والمسندة إليك.", "Derived from loaded tasks assigned to you.")}
          </p>
          <div className="space-y-2.5">
            {[
              {
                k: ctx.t("المهام المفتوحة", "Open tasks"),
                v: fmtNumber(open.length, ctx.locale),
              },
              {
                k: ctx.t("مهامي اليوم", "Today"),
                v: fmtNumber(dueToday.length, ctx.locale),
              },
              {
                k: ctx.t("القادمة", "Upcoming"),
                v: fmtNumber(upcoming.length, ctx.locale),
              },
              {
                k: ctx.t("متأخرة", "Overdue"),
                v: fmtNumber(overdue.length, ctx.locale),
                danger: overdue.length > 0,
              },
              {
                k: ctx.t("بدون موعد", "No due date"),
                v: fmtNumber(noDueDate.length, ctx.locale),
              },
              {
                k: ctx.t("المنجزة", "Completed"),
                v: fmtNumber(completed.length, ctx.locale),
              },
            ].map((it, i) => (
              <div
                key={i}
                className="flex items-center justify-between rounded-xl border border-line bg-raised/40 px-3.5 py-3"
              >
                <span className="text-[12px] text-ink-soft">{it.k}</span>
                <span
                  className={`mono text-[14px] font-bold tabular ${it.danger ? "text-rose-600 dark:text-rose-400" : "text-ink"}`}
                >
                  {it.v}
                </span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
