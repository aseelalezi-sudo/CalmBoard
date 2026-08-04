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
import { useMemo, useState } from "react";
import { Badge, Card, Empty } from "@/components/ui";
import { IconCalendar, IconPlus } from "@/components/icons";
import type { Task, ViewCtx } from "@/lib/types";
import { PRIORITY_CONFIG, STATUS_CONFIG } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  calendarDayFromKey,
  calendarDayKey,
  calendarDaysForView,
  resizeTaskCalendarEnd,
  shiftCalendarAnchor,
  shiftTaskCalendarDates,
  taskOccursOnCalendarDay,
  type TaskCalendarMode,
} from "./task-calendar-range";

const modeLabels: Record<TaskCalendarMode, { ar: string; en: string }> = {
  day: { ar: "يومي", en: "Day" },
  week: { ar: "أسبوعي", en: "Week" },
  month: { ar: "شهري", en: "Month" },
};

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
        isOver && "bg-indigo-100/80 shadow-[inset_0_0_0_2px_rgb(79_70_229)] dark:bg-indigo-500/15",
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
        "flex w-full items-center overflow-hidden rounded-lg border text-start transition hover:brightness-105 dark:hover:brightness-125",
        compact ? "text-[10.5px]" : "text-[12px]",
        STATUS_CONFIG[task.status]?.tone === "emerald"
          ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-200"
          : STATUS_CONFIG[task.status]?.tone === "amber"
            ? "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-200"
            : "border-indigo-200 bg-indigo-50 text-indigo-800 dark:border-indigo-500/25 dark:bg-indigo-500/10 dark:text-indigo-200",
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

function formatCalendarTitle(anchor: Date, mode: TaskCalendarMode, locale: ViewCtx["locale"]) {
  const dateLocale = locale === "ar" ? "ar-SA" : "en-US";
  if (mode === "day") {
    return anchor.toLocaleDateString(dateLocale, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  }
  if (mode === "week") {
    const days = calendarDaysForView(anchor, "week", locale === "ar" ? 6 : 0);
    const first = days[0]!;
    const last = days[6]!;
    return `${first.toLocaleDateString(dateLocale, { month: "short", day: "numeric" })} – ${last.toLocaleDateString(
      dateLocale,
      { year: "numeric", month: "short", day: "numeric" },
    )}`;
  }
  return anchor.toLocaleDateString(dateLocale, { year: "numeric", month: "long" });
}

export function AdvancedTaskCalendar({ ctx }: { ctx: ViewCtx }) {
  const [mode, setMode] = useState<TaskCalendarMode>("month");
  const [anchor, setAnchor] = useState(() => new Date());
  const [activeDrag, setActiveDrag] = useState<CalendarDragData | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor),
  );
  const today = new Date();
  const weekStartsOn = ctx.locale === "ar" ? 6 : 0;
  const days = useMemo(() => calendarDaysForView(anchor, mode, weekStartsOn), [anchor, mode, weekStartsOn]);
  const tasksByDay = useMemo(() => {
    const grouped = new Map<string, Task[]>();
    for (const day of days) {
      grouped.set(
        calendarDayKey(day),
        ctx.tasks
          .filter((task) => taskOccursOnCalendarDay(task, day))
          .sort((left, right) => {
            const leftDate = new Date(left.startDate ?? left.dueDate ?? 0).getTime();
            const rightDate = new Date(right.startDate ?? right.dueDate ?? 0).getTime();
            return leftDate - rightDate || left.order - right.order;
          }),
      );
    }
    return grouped;
  }, [ctx.tasks, days]);

  const createTaskForDay = (day: Date) => {
    if (!ctx.can("tasks.create")) return;
    const title = prompt(
      ctx.t(`مهمة جديدة في ${day.toLocaleDateString("ar-SA")}:`, `New task on ${day.toLocaleDateString("en-US")}:`),
      ctx.t("مهمة مجدولة", "Scheduled task"),
    );
    if (!title?.trim()) return;
    const dueDate = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 12);
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
    const saved = await ctx.updateTask(drag.task.id, {
      ...updates,
      ...(drag.type === "resize" && drag.task.isMilestone ? { isMilestone: false } : {}),
    });
    if (saved !== false) {
      ctx.notify(
        drag.type === "move"
          ? ctx.t("تم نقل المهمة وحفظ تواريخها", "Task moved and dates saved")
          : ctx.t("تم تغيير مدة المهمة وحفظها", "Task duration changed and saved"),
        "success",
      );
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
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 dark:border-white/[0.06]">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setAnchor(shiftCalendarAnchor(anchor, mode, -1))}
              aria-label={ctx.t("الفترة السابقة", "Previous period")}
              className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-white/10 dark:bg-white/[0.04] dark:text-zinc-300"
            >
              ‹
            </button>
            <button
              onClick={() => setAnchor(new Date())}
              className="h-8 rounded-lg border border-slate-200 bg-white px-3 text-[11.5px] font-bold text-slate-700 hover:bg-slate-50 dark:border-white/10 dark:bg-white/[0.04] dark:text-zinc-300"
            >
              {ctx.t("اليوم", "Today")}
            </button>
            <button
              onClick={() => setAnchor(shiftCalendarAnchor(anchor, mode, 1))}
              aria-label={ctx.t("الفترة التالية", "Next period")}
              className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-white/10 dark:bg-white/[0.04] dark:text-zinc-300"
            >
              ›
            </button>
            <h3 className="ms-2 text-[14px] font-bold text-slate-900 dark:text-white">
              {formatCalendarTitle(anchor, mode, ctx.locale)}
            </h3>
          </div>
          <div className="flex items-center gap-2">
            <Badge tone="indigo">
              {ctx.tasks.filter((task) => task.startDate || task.dueDate).length} {ctx.t("مجدولة", "scheduled")}
            </Badge>
            <div className="flex rounded-xl border border-slate-200 bg-slate-100 p-1 dark:border-white/10 dark:bg-white/[0.04]">
              {(Object.keys(modeLabels) as TaskCalendarMode[]).map((key) => (
                <button
                  key={key}
                  onClick={() => setMode(key)}
                  className={cn(
                    "rounded-lg px-3 py-1.5 text-[11px] font-bold transition",
                    mode === key
                      ? "bg-white text-indigo-700 shadow-sm dark:bg-zinc-800 dark:text-indigo-300"
                      : "text-slate-500 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-white",
                  )}
                >
                  {ctx.t(modeLabels[key].ar, modeLabels[key].en)}
                </button>
              ))}
            </div>
          </div>
        </div>

        {mode === "day" && (
          <div className="p-4">
            <CalendarDayDropZone
              day={days[0]!}
              className="mx-auto max-w-3xl rounded-xl border border-slate-200 dark:border-white/[0.07]"
            >
              <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-white/[0.06]">
                <div>
                  <div className="text-[13px] font-bold text-slate-900 dark:text-white">
                    {days[0]!.toLocaleDateString(ctx.locale === "ar" ? "ar-SA" : "en-US", {
                      weekday: "long",
                      month: "long",
                      day: "numeric",
                    })}
                  </div>
                  <div className="text-[10.5px] text-slate-500 dark:text-zinc-500">
                    {(tasksByDay.get(calendarDayKey(days[0]!)) ?? []).length} {ctx.t("مهمة", "tasks")}
                  </div>
                </div>
                <button
                  disabled={!ctx.can("tasks.create")}
                  onClick={() => createTaskForDay(days[0]!)}
                  className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-[11.5px] font-bold text-white disabled:hidden"
                >
                  <IconPlus size={12} />
                  {ctx.t("إضافة مهمة", "Add task")}
                </button>
              </div>
              <div className="space-y-2 p-4">
                {(tasksByDay.get(calendarDayKey(days[0]!)) ?? []).map((task) => (
                  <TaskCalendarCard key={task.id} task={task} ctx={ctx} day={days[0]!} />
                ))}
                {(tasksByDay.get(calendarDayKey(days[0]!)) ?? []).length === 0 && (
                  <Empty
                    icon={<IconCalendar size={22} />}
                    title={ctx.t("لا توجد مهام في هذا اليوم", "No tasks on this day")}
                    action={
                      ctx.can("tasks.create") ? (
                        <button
                          onClick={() => createTaskForDay(days[0]!)}
                          className="text-[12px] font-bold text-indigo-600 dark:text-indigo-300"
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
        )}

        {mode === "week" && (
          <div className="overflow-x-auto">
            <div className="grid min-w-[980px] grid-cols-7">
              {days.map((day) => {
                const dayTasks = tasksByDay.get(calendarDayKey(day)) ?? [];
                return (
                  <CalendarDayDropZone
                    key={calendarDayKey(day)}
                    day={day}
                    className={cn(
                      "min-h-[430px] border-e border-slate-100 p-2.5 last:border-e-0 dark:border-white/[0.05]",
                      isSameDay(day, today) && "bg-indigo-50/50 dark:bg-indigo-500/[0.04]",
                    )}
                  >
                    <div className="mb-3 flex items-center justify-between">
                      <div>
                        <div className="text-[10px] font-bold uppercase text-slate-400 dark:text-zinc-500">
                          {day.toLocaleDateString(ctx.locale === "ar" ? "ar-SA" : "en-US", { weekday: "short" })}
                        </div>
                        <div
                          className={cn(
                            "mt-0.5 text-[16px] font-bold text-slate-700 dark:text-zinc-300",
                            isSameDay(day, today) && "text-indigo-600 dark:text-indigo-300",
                          )}
                        >
                          {day.getDate()}
                        </div>
                      </div>
                      <button
                        disabled={!ctx.can("tasks.create")}
                        onClick={() => createTaskForDay(day)}
                        className="grid h-6 w-6 place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-indigo-600 disabled:hidden dark:hover:bg-white/[0.06]"
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
        )}

        {mode === "month" && (
          <>
            <div className="grid grid-cols-7 border-b border-slate-100 dark:border-white/[0.06]">
              {days.slice(0, 7).map((day) => (
                <div
                  key={calendarDayKey(day)}
                  className="border-e border-slate-100 px-3 py-2.5 text-center text-[10.5px] font-semibold uppercase tracking-wider text-slate-500 last:border-e-0 dark:border-white/[0.04] dark:text-zinc-500"
                >
                  {day.toLocaleDateString(ctx.locale === "ar" ? "ar-SA" : "en-US", { weekday: "short" })}
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
                      "group min-h-[112px] border-b border-e border-slate-100 p-2 last:border-e-0 dark:border-white/[0.04]",
                      !inMonth && "bg-slate-50/70 dark:bg-white/[0.01]",
                      isSameDay(day, today) && "bg-indigo-50/60 dark:bg-indigo-500/[0.05]",
                    )}
                  >
                    <div className="mb-1.5 flex items-center justify-between">
                      <span
                        className={cn(
                          "grid h-6 w-6 place-items-center rounded-lg text-[11px] font-semibold",
                          inMonth ? "text-slate-700 dark:text-zinc-400" : "text-slate-400 dark:text-zinc-700",
                          isSameDay(day, today) && "bg-indigo-600 text-white dark:text-white",
                        )}
                      >
                        {day.getDate()}
                      </span>
                      <button
                        disabled={!ctx.can("tasks.create")}
                        onClick={() => createTaskForDay(day)}
                        className="grid h-5 w-5 place-items-center rounded text-slate-400 opacity-0 hover:bg-slate-200/60 hover:text-indigo-600 disabled:hidden group-hover:opacity-100 dark:hover:bg-white/[0.06]"
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
                          className="px-1 text-[10px] font-semibold text-indigo-600 dark:text-indigo-300"
                        >
                          +{dayTasks.length - 3} {ctx.t("أخرى", "more")}
                        </button>
                      )}
                    </div>
                  </CalendarDayDropZone>
                );
              })}
            </div>
          </>
        )}
      </Card>
      <DragOverlay>
        {activeDrag ? (
          <div className="max-w-72 rounded-lg border border-indigo-300 bg-white px-3 py-2 text-[12px] font-bold text-indigo-800 shadow-xl dark:border-indigo-400/30 dark:bg-zinc-900 dark:text-indigo-200">
            {activeDrag.type === "move" ? ctx.t("نقل", "Move") : ctx.t("تغيير المدة", "Resize")} ·{" "}
            {activeDrag.task.serial} · {activeDrag.task.title}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
