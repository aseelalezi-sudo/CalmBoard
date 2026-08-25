"use client";

import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { useEffect, useMemo, useRef, useState } from "react";
import { Badge, Card, Empty, SegmentedTabs } from "@/components/ui";
import { IconCalendar, IconPlus, IconRefresh } from "@/components/icons";
import { promptAction } from "@/components/feedback";
import type { Task, ViewCtx } from "@/lib/types";
import { fmtNumber, PRIORITY_CONFIG, STATUS_CONFIG } from "@/lib/types";
import { useTaskViewStateStore } from "@/stores/task-view-state-store";
import { getCalendarTasks } from "./api";
import { cn } from "@/lib/utils";
import {
  addCalendarDays,
  calendarDayFromKey,
  calendarDayKey,
  matchesTaskFilters,
  resizeTaskCalendarEnd,
  shiftCalendarAnchor,
  shiftTaskCalendarDates,
  startOfCalendarWeek,
  taskOccursOnCalendarDay,
  taskOccursWithinVisibleRange,
  visibleCalendarQueryRange,
  type CalendarCommonFilters,
  type TaskCalendarMode,
} from "./task-calendar-range";

function isSameDay(left: Date, right: Date) {
  return calendarDayKey(left) === calendarDayKey(right);
}

type CalendarDragData = {
  type: "move" | "resize";
  task: Task;
  sourceDayKey: string;
};

function CalendarDayDropZone({
  day,
  className,
  children,
}: {
  day: Date;
  className?: string;
  children: React.ReactNode;
}) {
  const dayKey = calendarDayKey(day);
  const { isOver, setNodeRef } = useDroppable({
    id: `calendar-day:${dayKey}`,
    data: { type: "calendar-day", dayKey },
  });
  return (
    <div
      ref={setNodeRef}
      data-calendar-day={dayKey}
      className={cn(
        className,
        "transition-[background-color,box-shadow]",
        isOver && "bg-accent/10 shadow-[inset_0_0_0_2px_var(--color-accent)]",
      )}
    >
      {children}
    </div>
  );
}

function TaskCalendarCard({
  task,
  ctx,
  day,
  compact = false,
}: {
  task: Task;
  ctx: ViewCtx;
  day: Date;
  compact?: boolean;
}) {
  const priority = PRIORITY_CONFIG[task.priority];
  const dayKey = calendarDayKey(day);
  const canUpdate = ctx.can("tasks.update");
  const endDate = task.dueDate ?? task.startDate;
  const isEndOccurrence = Boolean(endDate && calendarDayKey(new Date(endDate)) === dayKey);
  const {
    attributes: moveAttributes,
    listeners: moveListeners,
    setNodeRef: setMoveNodeRef,
    transform: moveTransform,
    isDragging: isMoving,
  } = useDraggable({
    id: `calendar-move:${task.id}:${dayKey}`,
    data: { type: "move", task, sourceDayKey: dayKey } satisfies CalendarDragData,
    disabled: !canUpdate,
  });
  const {
    attributes: resizeAttributes,
    listeners: resizeListeners,
    setNodeRef: setResizeNodeRef,
    isDragging: isResizing,
  } = useDraggable({
    id: `calendar-resize:${task.id}:${dayKey}`,
    data: { type: "resize", task, sourceDayKey: dayKey } satisfies CalendarDragData,
    disabled: !canUpdate || !isEndOccurrence,
  });

  return (
    <div
      ref={setMoveNodeRef}
      style={{
        transform: CSS.Transform.toString(moveTransform),
        opacity: isMoving ? 0.35 : 1,
      }}
      className={cn(
        "flex w-full items-center overflow-hidden rounded-lg border text-start transition hover:brightness-105",
        compact ? "text-[10.5px]" : "text-[12px]",
        STATUS_CONFIG[task.status]?.tone === "emerald"
          ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200"
          : STATUS_CONFIG[task.status]?.tone === "amber"
            ? "border-amber-500/25 bg-amber-500/10 text-amber-800 dark:text-amber-200"
            : "border-accent/25 bg-accent/10 text-ink",
      )}
    >
      <button
        onClick={() => ctx.openTask(task)}
        title={`${task.serial} · ${task.title}`}
        className={cn("min-w-0 flex-1 text-start", compact ? "px-1.5 py-1" : "px-2.5 py-2")}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${priority?.bar}`} />
          {!compact && <span className="mono shrink-0 text-[9.5px] opacity-70">{task.serial}</span>}
          <span className="truncate font-semibold">{task.title}</span>
        </span>
      </button>
      {canUpdate && (
        <button
          {...moveAttributes}
          {...moveListeners}
          onClick={(event) => event.stopPropagation()}
          aria-label={ctx.t(`نقل المهمة ${task.title}`, `Move task ${task.title}`)}
          title={ctx.t("اسحب لنقل المهمة إلى يوم آخر", "Drag to move the task to another day")}
          className={cn(
            "touch-none self-stretch border-s border-current/10 px-1.5 font-bold opacity-55 hover:opacity-100 active:cursor-grabbing",
            isMoving ? "cursor-grabbing" : "cursor-grab",
          )}
        >
          ⠿
        </button>
      )}
      {canUpdate && isEndOccurrence && (
        <button
          ref={setResizeNodeRef}
          {...resizeAttributes}
          {...resizeListeners}
          onClick={(event) => event.stopPropagation()}
          aria-label={ctx.t(`تغيير مدة المهمة ${task.title}`, `Resize task ${task.title}`)}
          title={ctx.t("اسحب لتغيير تاريخ نهاية المهمة", "Drag to change the task end date")}
          className={cn(
            "touch-none self-stretch border-s border-current/10 px-1.5 font-bold opacity-55 hover:opacity-100 active:cursor-grabbing",
            isResizing ? "cursor-grabbing" : "cursor-ew-resize",
          )}
        >
          ↔
        </button>
      )}
    </div>
  );
}

function formatCalendarTitle(anchor: Date, mode: TaskCalendarMode, locale: "ar" | "en") {
  const dateLocale = locale === "ar" ? "ar-u-nu-latn" : "en-US";
  if (mode === "day") {
    return anchor.toLocaleDateString(dateLocale, {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }
  if (mode === "week") {
    const start = startOfCalendarWeek(anchor, locale === "ar" ? 6 : 0);
    const end = addCalendarDays(start, 6);
    return `${start.toLocaleDateString(dateLocale, { month: "short", day: "numeric" })} - ${end.toLocaleDateString(
      dateLocale,
      { month: "short", day: "numeric", year: "numeric" },
    )}`;
  }
  return anchor.toLocaleDateString(dateLocale, { year: "numeric", month: "long" });
}

export function AdvancedTaskCalendar({ ctx, calendarTimezone = "UTC" }: { ctx: ViewCtx; calendarTimezone?: string }) {
  const calendarViewState = useTaskViewStateStore((state) => state.calendar);
  const setCalendarViewState = useTaskViewStateStore((state) => state.setCalendar);
  const mode = calendarViewState.mode;
  const setMode = (nextMode: TaskCalendarMode) => setCalendarViewState({ mode: nextMode });
  const [anchor, setAnchor] = useState(() => new Date());
  const [activeDrag, setActiveDrag] = useState<CalendarDragData | null>(null);
  const [calendarTasks, setCalendarTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const requestVersion = useRef(0);
  const abortController = useRef<AbortController | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor),
  );
  const today = new Date();
  const weekStartsOn = ctx.locale === "ar" ? 6 : 0;
  const visibleRange = useMemo(
    () => visibleCalendarQueryRange(anchor, mode, weekStartsOn, calendarTimezone),
    [anchor, mode, weekStartsOn, calendarTimezone],
  );
  const days = visibleRange.days;

  const activeProject = ctx.activeProject;
  const notify = ctx.notify;
  const t = ctx.t;

  const searchFilter = ctx.taskFilter?.search;
  const statusFilter = ctx.taskFilter?.status;
  const priorityFilter = ctx.taskFilter?.priority;
  const assigneeFilter = ctx.taskFilter?.assignee || ctx.taskFilter?.assigneeId;
  const rawCustomFieldFilters = (ctx.taskFilter as Record<string, unknown> | undefined)?.customFieldFilters;
  const customFieldFilters = useMemo(() => {
    if (!rawCustomFieldFilters) return undefined;
    if (Array.isArray(rawCustomFieldFilters)) return rawCustomFieldFilters;
    if (typeof rawCustomFieldFilters === "string") {
      try {
        const parsed = JSON.parse(rawCustomFieldFilters);
        if (Array.isArray(parsed)) return parsed;
      } catch {
        return undefined;
      }
    }
    return undefined;
  }, [rawCustomFieldFilters]);

  const commonFilters: CalendarCommonFilters = useMemo(
    () => ({
      search: searchFilter || undefined,
      status: statusFilter || undefined,
      priority: priorityFilter || undefined,
      assigneeId: assigneeFilter || undefined,
      customFieldFilters,
    }),
    [assigneeFilter, customFieldFilters, priorityFilter, searchFilter, statusFilter],
  );

  // Range-aware query execution with requestVersion and AbortController
  useEffect(() => {
    if (!activeProject) {
      setCalendarTasks([]);
      setLoading(false);
      return;
    }

    abortController.current?.abort();
    const controller = new AbortController();
    abortController.current = controller;

    const version = ++requestVersion.current;
    setLoading(true);

    void getCalendarTasks(activeProject, {
      ...commonFilters,
      calendarFrom: visibleRange.calendarFrom,
      calendarTo: visibleRange.calendarTo,
      signal: controller.signal,
    })
      .then((records) => {
        if (version === requestVersion.current) {
          setCalendarTasks(records);
        }
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") return;
        if (version === requestVersion.current) {
          notify(t("تعذر تحميل مهام التقويم", "Could not load calendar tasks"), "error");
        }
      })
      .finally(() => {
        if (version === requestVersion.current) {
          setLoading(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, [activeProject, commonFilters, notify, t, visibleRange.calendarFrom, visibleRange.calendarTo]);

  // Authoritative grouping strictly from calendar range dataset and active filters
  const tasksByDay = useMemo(() => {
    const grouped = new Map<string, Task[]>();
    for (const day of days) {
      grouped.set(calendarDayKey(day), []);
    }

    for (const task of calendarTasks) {
      if (!matchesTaskFilters(task, commonFilters)) continue;
      for (const day of days) {
        if (taskOccursOnCalendarDay(task, day, calendarTimezone)) {
          grouped.get(calendarDayKey(day))?.push(task);
        }
      }
    }

    for (const [, list] of grouped.entries()) {
      list.sort((left, right) => {
        const leftDate = new Date(left.startDate ?? left.dueDate ?? 0).getTime();
        const rightDate = new Date(right.startDate ?? right.dueDate ?? 0).getTime();
        return leftDate - rightDate || left.order - right.order;
      });
    }

    return grouped;
  }, [calendarTasks, days, calendarTimezone, commonFilters]);

  const scheduledCount = useMemo(() => {
    const scheduledIds = new Set<string>();
    for (const tasksOnDay of tasksByDay.values()) {
      for (const task of tasksOnDay) {
        scheduledIds.add(task.id);
      }
    }
    return scheduledIds.size;
  }, [tasksByDay]);

  const createTaskForDay = async (day: Date) => {
    if (!ctx.can("tasks.create")) return;
    const title = await promptAction({
      title: ctx.t("مهمة جديدة", "New task"),
      label: ctx.t(
        `أدخل عنوان المهمة لتاريخ ${day.toLocaleDateString(ctx.locale === "ar" ? "ar-u-nu-latn" : "en-US")}:`,
        `Enter task title for ${day.toLocaleDateString(ctx.locale === "ar" ? "ar-u-nu-latn" : "en-US")}:`,
      ),
      defaultValue: ctx.t("مهمة مجدولة", "Scheduled task"),
    });
    if (!title?.trim()) return;
    const dueDate = new Date(Date.UTC(day.getFullYear(), day.getMonth(), day.getDate(), 12, 0, 0, 0));
    ctx.createTask({ title: title.trim(), dueDate: dueDate.toISOString() });
  };

  const handleDragStart = (event: DragStartEvent) => {
    const data = event.active.data.current as CalendarDragData | undefined;
    setActiveDrag(data?.task ? data : null);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveDrag(null);
    const drag = event.active.data.current as CalendarDragData | undefined;
    const targetDayKey = event.over?.data.current?.dayKey;
    if (!drag?.task || typeof targetDayKey !== "string" || !ctx.can("tasks.update")) return;
    const sourceDay = calendarDayFromKey(drag.sourceDayKey);
    const targetDay = calendarDayFromKey(targetDayKey);
    if (!sourceDay || !targetDay) return;

    const updates =
      drag.type === "move"
        ? shiftTaskCalendarDates(drag.task, targetDay, sourceDay)
        : resizeTaskCalendarEnd(drag.task, targetDay);
    if (!updates) {
      ctx.notify(
        ctx.t("لا يمكن أن تنتهي المهمة قبل تاريخ بدايتها", "A task cannot end before its start date"),
        "error",
      );
      return;
    }

    const payload = {
      ...updates,
      ...(drag.type === "resize" && drag.task.isMilestone ? { isMilestone: false } : {}),
    };

    const previousTasks = calendarTasks;

    // Optimistically update local scoped calendar state
    setCalendarTasks((current) => {
      return current
        .map((t) => (t.id === drag.task.id ? ({ ...t, ...payload } as Task) : t))
        .filter((t) => {
          if (t.id !== drag.task.id) return true;
          return taskOccursWithinVisibleRange(t, days, calendarTimezone) && matchesTaskFilters(t, commonFilters);
        });
    });

    try {
      const saved = await ctx.updateTask(drag.task.id, payload);
      if (saved !== false) {
        ctx.notify(
          drag.type === "move"
            ? ctx.t("تم نقل المهمة وحفظ تواريخها", "Task moved and dates saved")
            : ctx.t("تم تغيير مدة المهمة وحفظها", "Task duration changed and saved"),
          "success",
        );
      } else {
        setCalendarTasks(previousTasks);
      }
    } catch {
      setCalendarTasks(previousTasks);
    }
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragCancel={() => setActiveDrag(null)}
      onDragEnd={handleDragEnd}
    >
      <Card className="overflow-hidden border border-line bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setAnchor(shiftCalendarAnchor(anchor, mode, -1))}
              aria-label={ctx.t("الفترة السابقة", "Previous period")}
              className="grid h-8 w-8 place-items-center rounded-lg border border-line bg-surface text-ink-soft hover:bg-raised transition"
            >
              {ctx.locale === "ar" ? "›" : "‹"}
            </button>
            <button
              onClick={() => setAnchor(new Date())}
              className="h-8 rounded-lg border border-line bg-surface px-3 text-[11.5px] font-bold text-ink hover:bg-raised transition"
            >
              {ctx.t("اليوم", "Today")}
            </button>
            <button
              onClick={() => setAnchor(shiftCalendarAnchor(anchor, mode, 1))}
              aria-label={ctx.t("الفترة التالية", "Next period")}
              className="grid h-8 w-8 place-items-center rounded-lg border border-line bg-surface text-ink-soft hover:bg-raised transition"
            >
              {ctx.locale === "ar" ? "‹" : "›"}
            </button>
            <h3 className="ms-2 text-[14px] font-bold text-ink">{formatCalendarTitle(anchor, mode, ctx.locale)}</h3>
            {loading && <IconRefresh size={14} className="animate-spin text-accent ms-1" />}
          </div>
          <div className="flex items-center gap-3">
            <Badge tone="indigo">
              {fmtNumber(scheduledCount, ctx.locale)} {ctx.t("مجدولة", "scheduled")}
            </Badge>
            <SegmentedTabs
              label={ctx.t("طريقة عرض التقويم", "Calendar view mode")}
              value={mode}
              onChange={(val) => setMode(val as TaskCalendarMode)}
              items={[
                { id: "day", label: ctx.t("يومي", "Day") },
                { id: "week", label: ctx.t("أسبوعي", "Week") },
                { id: "month", label: ctx.t("شهري", "Month") },
              ]}
            />
          </div>
        </div>

        {mode === "day" &&
          (() => {
            const dayTasks = tasksByDay.get(calendarDayKey(days[0]!)) ?? [];
            return (
              <div className="p-4">
                <CalendarDayDropZone
                  day={days[0]!}
                  className="mx-auto max-w-3xl rounded-xl border border-line bg-surface"
                >
                  <div className="flex items-center justify-between border-b border-line px-4 py-3">
                    <div>
                      <div className="text-[13px] font-bold text-ink">
                        {days[0]!.toLocaleDateString(ctx.locale === "ar" ? "ar-u-nu-latn" : "en-US", {
                          weekday: "long",
                          month: "long",
                          day: "numeric",
                        })}
                      </div>
                      <div className="text-[10.5px] text-ink-faint">
                        {fmtNumber(dayTasks.length, ctx.locale)} {ctx.t("مهام", "tasks")}
                      </div>
                    </div>
                    <button
                      disabled={!ctx.can("tasks.create")}
                      onClick={() => void createTaskForDay(days[0]!)}
                      className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[11.5px] font-bold text-white transition hover:brightness-110 disabled:hidden"
                    >
                      <IconPlus size={12} />
                      {ctx.t("إضافة مهمة", "Add task")}
                    </button>
                  </div>
                  <div className="space-y-2 p-4">
                    {dayTasks.map((task) => (
                      <TaskCalendarCard key={task.id} task={task} ctx={ctx} day={days[0]!} />
                    ))}
                    {dayTasks.length === 0 && !loading && (
                      <Empty
                        icon={<IconCalendar size={22} />}
                        title={ctx.t("لا توجد مهام في هذا اليوم", "No tasks on this day")}
                        action={
                          ctx.can("tasks.create") ? (
                            <button
                              onClick={() => void createTaskForDay(days[0]!)}
                              className="text-[12px] font-bold text-accent hover:underline"
                            >
                              {ctx.t("إنشاء مهمة مجدولة", "Create a scheduled task")}
                            </button>
                          ) : undefined
                        }
                      />
                    )}
                  </div>
                </CalendarDayDropZone>
              </div>
            );
          })()}

        {mode === "week" && (
          <>
            <div className="space-y-2 p-3 sm:hidden">
              {days.map((day) => {
                const dayTasks = tasksByDay.get(calendarDayKey(day)) ?? [];
                return (
                  <div
                    key={calendarDayKey(day)}
                    className={cn(
                      "rounded-xl border border-line p-3 transition",
                      isSameDay(day, today) && "border-accent/40 bg-accent/5",
                    )}
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            "grid h-6 w-6 place-items-center rounded-lg text-[12px] font-bold",
                            isSameDay(day, today) ? "bg-accent text-white" : "bg-raised text-ink",
                          )}
                        >
                          {fmtNumber(day.getDate(), ctx.locale)}
                        </span>
                        <span className="text-[12px] font-semibold text-ink">
                          {day.toLocaleDateString(ctx.locale === "ar" ? "ar-u-nu-latn" : "en-US", { weekday: "long" })}
                        </span>
                      </div>
                      <button
                        disabled={!ctx.can("tasks.create")}
                        onClick={() => void createTaskForDay(day)}
                        className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold text-accent hover:bg-accent/10 disabled:hidden"
                      >
                        <IconPlus size={12} />
                        <span>{ctx.t("إضافة", "Add")}</span>
                      </button>
                    </div>
                    {dayTasks.length > 0 ? (
                      <div className="space-y-1.5">
                        {dayTasks.map((task) => (
                          <TaskCalendarCard key={task.id} task={task} ctx={ctx} day={day} compact />
                        ))}
                      </div>
                    ) : (
                      <div className="text-[11px] text-ink-faint">{ctx.t("لا توجد مهام", "No tasks")}</div>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="hidden overflow-x-auto overscroll-x-contain sm:block">
              <div className="grid min-w-[980px] grid-cols-7">
                {days.map((day) => {
                  const dayTasks = tasksByDay.get(calendarDayKey(day)) ?? [];
                  return (
                    <CalendarDayDropZone
                      key={calendarDayKey(day)}
                      day={day}
                      className={cn(
                        "min-h-[430px] border-e border-b border-line p-2.5 last:border-e-0",
                        isSameDay(day, today) && "bg-accent/5",
                      )}
                    >
                      <div className="mb-3 flex items-center justify-between">
                        <div>
                          <div className="text-[10px] font-bold uppercase text-ink-faint">
                            {day.toLocaleDateString(ctx.locale === "ar" ? "ar-u-nu-latn" : "en-US", {
                              weekday: "short",
                            })}
                          </div>
                          <div
                            className={cn(
                              "mt-0.5 text-[16px] font-bold text-ink",
                              isSameDay(day, today) && "text-accent",
                            )}
                          >
                            {fmtNumber(day.getDate(), ctx.locale)}
                          </div>
                        </div>
                        <button
                          disabled={!ctx.can("tasks.create")}
                          onClick={() => void createTaskForDay(day)}
                          className="grid h-6 w-6 place-items-center rounded-md text-ink-soft hover:bg-raised hover:text-accent focus-visible:opacity-100 disabled:hidden transition"
                        >
                          <IconPlus size={12} />
                        </button>
                      </div>
                      <div className="space-y-1.5">
                        {dayTasks.map((task) => (
                          <TaskCalendarCard key={task.id} task={task} ctx={ctx} day={day} compact />
                        ))}
                      </div>
                    </CalendarDayDropZone>
                  );
                })}
              </div>
            </div>
          </>
        )}

        {mode === "month" && (
          <>
            <div className="p-2 sm:hidden">
              <div className="grid grid-cols-7 gap-1">
                {days.map((day) => {
                  const dayTasks = tasksByDay.get(calendarDayKey(day)) ?? [];
                  const inMonth = day.getMonth() === anchor.getMonth();
                  return (
                    <button
                      key={calendarDayKey(day)}
                      type="button"
                      onClick={() => {
                        setAnchor(day);
                        setMode("day");
                      }}
                      className={cn(
                        "flex flex-col items-center rounded-xl p-1.5 text-center transition",
                        !inMonth && "opacity-30",
                        isSameDay(day, today) ? "bg-accent text-white" : "hover:bg-raised text-ink",
                      )}
                    >
                      <span className="text-[11px] font-bold">{fmtNumber(day.getDate(), ctx.locale)}</span>
                      {dayTasks.length > 0 && (
                        <span
                          className={cn(
                            "mt-1 h-1.5 w-1.5 rounded-full",
                            isSameDay(day, today) ? "bg-white" : "bg-accent",
                          )}
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="hidden overflow-x-auto overscroll-x-contain sm:block">
              <div className="min-w-[640px]">
                <div className="grid grid-cols-7 border-b border-line">
                  {days.slice(0, 7).map((day) => (
                    <div
                      key={calendarDayKey(day)}
                      className="border-e border-line px-3 py-2.5 text-center text-[10.5px] font-semibold uppercase tracking-wider text-ink-faint last:border-e-0"
                    >
                      {day.toLocaleDateString(ctx.locale === "ar" ? "ar-u-nu-latn" : "en-US", { weekday: "short" })}
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-7">
                  {days.map((day) => {
                    const dayTasks = tasksByDay.get(calendarDayKey(day)) ?? [];
                    const inMonth = day.getMonth() === anchor.getMonth();
                    return (
                      <CalendarDayDropZone
                        key={calendarDayKey(day)}
                        day={day}
                        className={cn(
                          "group min-h-28 border-e border-b border-line p-2 last:border-e-0",
                          !inMonth && "bg-raised/30 text-ink-faint",
                          isSameDay(day, today) && "bg-accent/5",
                        )}
                      >
                        <div className="mb-1.5 flex items-center justify-between">
                          <span
                            className={cn(
                              "grid h-6 w-6 place-items-center rounded-lg text-[11px] font-semibold",
                              inMonth ? "text-ink" : "text-ink-faint",
                              isSameDay(day, today) && "bg-accent text-white",
                            )}
                          >
                            {fmtNumber(day.getDate(), ctx.locale)}
                          </span>
                          <button
                            disabled={!ctx.can("tasks.create")}
                            onClick={() => void createTaskForDay(day)}
                            className="grid h-5 w-5 place-items-center rounded text-ink-soft opacity-0 hover:bg-raised hover:text-accent focus-visible:opacity-100 disabled:hidden group-hover:opacity-100 transition"
                          >
                            <IconPlus size={11} />
                          </button>
                        </div>
                        <div className="space-y-1">
                          {dayTasks.slice(0, 3).map((task) => (
                            <TaskCalendarCard key={task.id} task={task} ctx={ctx} day={day} compact />
                          ))}
                          {dayTasks.length > 3 && (
                            <button
                              onClick={() => {
                                setAnchor(day);
                                setMode("day");
                              }}
                              className="px-1 text-[10px] font-semibold text-accent hover:underline"
                            >
                              +{fmtNumber(dayTasks.length - 3, ctx.locale)} {ctx.t("أخرى", "more")}
                            </button>
                          )}
                        </div>
                      </CalendarDayDropZone>
                    );
                  })}
                </div>
              </div>
            </div>
          </>
        )}
      </Card>
      <DragOverlay>
        {activeDrag ? (
          <div className="max-w-72 rounded-lg border border-accent/30 bg-surface px-3 py-2 text-[12px] font-bold text-ink shadow-xl">
            {activeDrag.type === "move" ? ctx.t("نقل", "Move") : ctx.t("تغيير المدة", "Resize")} ·{" "}
            {activeDrag.task.serial} · {activeDrag.task.title}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
