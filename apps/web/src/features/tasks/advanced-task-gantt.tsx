"use client";

import { useEffect, useMemo, useState } from "react";
import { Avatar, Badge, Card, Empty } from "@/components/ui";
import { IconCalendar, IconLink, IconTimeline } from "@/components/icons";
import type { Task, ViewCtx } from "@/lib/types";
import type { ProjectBaseline } from "@/lib/types";
import { PRIORITY_CONFIG, STATUS_CONFIG } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  buildTaskGanttModel,
  buildTaskGanttSegments,
  type TaskGanttBar,
  type TaskGanttLink,
  type TaskGanttZoom,
} from "./task-gantt-model";
import { calendarDayDifference } from "./task-calendar-range";
import { calculateCriticalPath } from "./task-critical-path";
import { createProjectBaselineRecord, getProjectBaselines } from "./api";
import { compareProjectBaseline, detectScheduleConflicts } from "./task-schedule-analysis";

const LABEL_WIDTH = 270;
const ROW_HEIGHT = 52;
const minimumDayWidth: Record<TaskGanttZoom, number> = {
  days: 38,
  weeks: 14,
  months: 5,
};

const zoomLabels: Record<TaskGanttZoom, { ar: string; en: string }> = {
  days: { ar: "أيام", en: "Days" },
  weeks: { ar: "أسابيع", en: "Weeks" },
  months: { ar: "أشهر", en: "Months" },
};

const dependencyLabels: Record<TaskGanttLink["type"], string> = {
  finish_to_start: "FS",
  start_to_start: "SS",
  finish_to_finish: "FF",
  start_to_finish: "SF",
};

function formatDate(date: Date, locale: ViewCtx["locale"], options?: Intl.DateTimeFormatOptions) {
  return date.toLocaleDateString(locale === "ar" ? "ar-SA" : "en-US", options);
}

function segmentLabel(
  segment: ReturnType<typeof buildTaskGanttSegments>[number],
  zoom: TaskGanttZoom,
  locale: ViewCtx["locale"],
) {
  if (zoom === "days") {
    return formatDate(segment.startDate, locale, { weekday: "short", day: "numeric", month: "short" });
  }
  if (zoom === "weeks") {
    return formatDate(segment.periodStart, locale, { day: "numeric", month: "short", year: "numeric" });
  }
  return formatDate(segment.periodStart, locale, { month: "long", year: "numeric" });
}

function dependencyPath(
  link: TaskGanttLink,
  from: TaskGanttBar,
  to: TaskGanttBar,
  fromRow: number,
  toRow: number,
  dayWidth: number,
) {
  const startsAtFinish = link.type === "finish_to_start" || link.type === "finish_to_finish";
  const endsAtFinish = link.type === "finish_to_finish" || link.type === "start_to_finish";
  const startX = (from.startOffset + (startsAtFinish ? from.durationDays : 0)) * dayWidth;
  const endX = (to.startOffset + (endsAtFinish ? to.durationDays : 0)) * dayWidth;
  const startY = fromRow * ROW_HEIGHT + ROW_HEIGHT / 2;
  const endY = toRow * ROW_HEIGHT + ROW_HEIGHT / 2;
  const elbowX = endX >= startX ? startX + Math.max(12, (endX - startX) / 2) : Math.max(startX, endX) + 18;
  return `M ${startX} ${startY} H ${elbowX} V ${endY} H ${endX}`;
}

function formatMinutes(minutes: number, locale: ViewCtx["locale"]) {
  const formatter = new Intl.NumberFormat(locale === "ar" ? "ar-SA" : "en-US", {
    maximumFractionDigits: 1,
  });
  const days = minutes / (24 * 60);
  if (Math.abs(days) >= 1) return `${formatter.format(days)} ${locale === "ar" ? "يوم" : "d"}`;
  return `${formatter.format(minutes / 60)} ${locale === "ar" ? "ساعة" : "h"}`;
}

function dependencyKey(link: TaskGanttLink) {
  return `${link.blockingTaskId}:${link.dependentTaskId}:${link.type}:${link.lagMinutes}`;
}

export function AdvancedTaskGantt({ ctx }: { ctx: ViewCtx }) {
  const [zoom, setZoom] = useState<TaskGanttZoom>("weeks");
  const [showCritical, setShowCritical] = useState(false);
  const [baselines, setBaselines] = useState<ProjectBaseline[]>([]);
  const [selectedBaselineId, setSelectedBaselineId] = useState("");
  const model = useMemo(() => buildTaskGanttModel(ctx.tasks), [ctx.tasks]);
  const selectedBaseline = baselines.find((baseline) => baseline.id === selectedBaselineId) ?? null;
  const baselineTaskById = useMemo(
    () => new Map((selectedBaseline?.tasks ?? []).map((task) => [task.sourceTaskId, task])),
    [selectedBaseline],
  );
  const baselineVariances = useMemo(
    () => compareProjectBaseline(ctx.tasks, selectedBaseline),
    [ctx.tasks, selectedBaseline],
  );
  const scheduleConflicts = useMemo(() => detectScheduleConflicts(model), [model]);
  const criticalPath = useMemo(() => calculateCriticalPath(model), [model]);
  const criticalVisible = showCritical && criticalPath.status === "computed";
  const criticalTaskIds = useMemo(
    () => new Set(criticalPath.status === "computed" ? criticalPath.criticalTaskIds : []),
    [criticalPath],
  );
  const criticalLinkKeys = useMemo(
    () => new Set(criticalPath.status === "computed" ? criticalPath.criticalLinks.map(dependencyKey) : []),
    [criticalPath],
  );
  const metricByTask = useMemo(
    () =>
      new Map(
        criticalPath.status === "computed"
          ? criticalPath.metrics.map((metric) => [metric.taskId, metric] as const)
          : [],
      ),
    [criticalPath],
  );
  const weekStartsOn = ctx.locale === "ar" ? 6 : 0;
  const dayWidth = model.totalDays ? Math.max(minimumDayWidth[zoom], 720 / model.totalDays) : minimumDayWidth[zoom];
  const chartWidth = Math.max(720, model.totalDays * dayWidth);
  const segments = useMemo(
    () => (model.rangeStart ? buildTaskGanttSegments(model.rangeStart, model.totalDays, zoom, weekStartsOn) : []),
    [model.rangeStart, model.totalDays, weekStartsOn, zoom],
  );
  const today = new Date();
  const todayOffset = model.rangeStart ? calendarDayDifference(today, model.rangeStart) : -1;
  const todayVisible = todayOffset >= 0 && todayOffset < model.totalDays;

  useEffect(() => {
    let active = true;
    if (!ctx.activeProject) {
      setBaselines([]);
      setSelectedBaselineId("");
      return;
    }
    getProjectBaselines(ctx.activeProject, ctx.currentUser?.id)
      .then((items) => {
        if (active) setBaselines(items);
      })
      .catch(() => {
        if (active) setBaselines([]);
      });
    return () => {
      active = false;
    };
  }, [ctx.activeProject, ctx.currentUser?.id]);

  const createBaseline = async () => {
    if (!ctx.activeProject || !ctx.can("projects.update")) return;
    const name = prompt(ctx.t("اسم خط الأساس:", "Baseline name:"), ctx.t("خط أساس جديد", "New baseline"));
    if (!name?.trim()) return;
    try {
      const baseline = await createProjectBaselineRecord(ctx.activeProject, name.trim(), ctx.currentUser?.id);
      setBaselines((items) => [baseline, ...items]);
      setSelectedBaselineId(baseline.id);
      ctx.notify(ctx.t("تم حفظ خط الأساس", "Baseline saved"), "success");
    } catch (error) {
      ctx.notify(error instanceof Error ? error.message : ctx.t("فشل حفظ خط الأساس", "Baseline save failed"), "error");
    }
  };

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/60 px-5 py-3.5 dark:border-white/[0.06] dark:bg-transparent">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="flex items-center gap-2 text-[14px] font-bold text-slate-900 dark:text-white">
            <IconTimeline size={17} />
            {ctx.t("مخطط جانت", "Gantt chart")}
          </span>
          <Badge tone="indigo">
            {model.bars.length} {ctx.t("مهمة مجدولة", "scheduled")}
          </Badge>
          <Badge tone="violet">
            <IconLink size={11} />
            {model.links.length} {ctx.t("تبعية مرئية", "visible links")}
          </Badge>
          {model.unscheduledTaskIds.length > 0 && (
            <Badge tone="neutral">
              {model.unscheduledTaskIds.length} {ctx.t("دون تاريخ", "unscheduled")}
            </Badge>
          )}
          {model.invalidTaskIds.length > 0 && (
            <Badge tone="rose">
              {model.invalidTaskIds.length} {ctx.t("نطاق غير صالح", "invalid ranges")}
            </Badge>
          )}
          {(model.missingDependencySerials.length > 0 || model.unrenderedDependencyCount > 0) && (
            <span
              title={[
                ...model.missingDependencySerials.map((serial) =>
                  ctx.t(`تبعية مفقودة: ${serial}`, `Missing dependency: ${serial}`),
                ),
                model.unrenderedDependencyCount
                  ? ctx.t(
                      `${model.unrenderedDependencyCount} تبعية لمهمة غير مجدولة`,
                      `${model.unrenderedDependencyCount} dependencies point to unscheduled tasks`,
                    )
                  : "",
              ]
                .filter(Boolean)
                .join("\n")}
            >
              <Badge tone="amber" className="cursor-help">
                {model.missingDependencySerials.length + model.unrenderedDependencyCount}{" "}
                {ctx.t("تبعية غير مرسومة", "unrendered links")}
              </Badge>
            </span>
          )}
          {criticalPath.status === "computed" && (
            <Badge tone="rose">
              {criticalPath.criticalTaskIds.length} {ctx.t("مهمة حرجة", "critical tasks")} ·{" "}
              {formatMinutes(criticalPath.projectDurationMinutes, ctx.locale)}
            </Badge>
          )}
          {criticalPath.status === "cyclic_dependencies" && (
            <Badge tone="rose">{ctx.t("تعذر الحساب: دورة تبعيات", "CPM blocked: dependency cycle")}</Badge>
          )}
          {criticalPath.status === "incomplete_dependencies" && (
            <Badge tone="amber">{ctx.t("الحساب ينتظر اكتمال التبعيات", "CPM awaits complete dependencies")}</Badge>
          )}
          {scheduleConflicts.length > 0 && (
            <Badge tone="rose">
              {scheduleConflicts.length} {ctx.t("تعارض زمني", "schedule conflicts")}
            </Badge>
          )}
          {selectedBaseline && (
            <Badge tone="amber">
              {baselineVariances.length} {ctx.t("انحرافاً عن الأساس", "baseline variances")}
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-2">
          {model.rangeStart && model.rangeEnd && (
            <span className="hidden text-[10.5px] font-semibold text-slate-500 dark:text-zinc-500 md:inline">
              {formatDate(model.rangeStart, ctx.locale)} – {formatDate(model.rangeEnd, ctx.locale)}
            </span>
          )}
          <button
            disabled={criticalPath.status !== "computed"}
            aria-pressed={criticalVisible}
            onClick={() => setShowCritical((visible) => !visible)}
            title={
              criticalPath.status === "computed"
                ? ctx.t("إظهار أو إخفاء المسار الحرج المحسوب", "Show or hide the calculated critical path")
                : ctx.t("أكمل بيانات التواريخ والتبعيات أولاً", "Complete dates and dependencies first")
            }
            className={cn(
              "h-8 rounded-xl border px-3 text-[11px] font-bold transition disabled:cursor-not-allowed disabled:opacity-40",
              criticalVisible
                ? "border-rose-500 bg-rose-500 text-white shadow-sm"
                : "border-slate-200 bg-white text-slate-700 hover:border-rose-300 hover:text-rose-600 dark:border-white/10 dark:bg-white/[0.04] dark:text-zinc-300",
            )}
          >
            {criticalVisible
              ? ctx.t("إخفاء المسار الحرج", "Hide critical path")
              : ctx.t("المسار الحرج", "Critical path")}
          </button>
          <select
            name="auto-field-mdp18mm"
            value={selectedBaselineId}
            onChange={(event) => setSelectedBaselineId(event.target.value)}
            aria-label={ctx.t("اختيار خط الأساس", "Select baseline")}
            className="h-8 max-w-40 rounded-xl border border-slate-200 bg-white px-2 text-[10.5px] font-semibold text-slate-700 dark:border-white/10 dark:bg-white/[0.04] dark:text-zinc-300"
          >
            <option value="">{ctx.t("بدون خط أساس", "No baseline")}</option>
            {baselines.map((baseline) => (
              <option key={baseline.id} value={baseline.id}>
                {baseline.name}
              </option>
            ))}
          </select>
          <button
            disabled={!ctx.can("projects.update") || !ctx.activeProject}
            onClick={createBaseline}
            className="h-8 rounded-xl border border-amber-300 bg-amber-50 px-3 text-[10.5px] font-bold text-amber-800 hover:bg-amber-100 disabled:opacity-40 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300"
          >
            {ctx.t("حفظ Baseline", "Save baseline")}
          </button>
          <div className="flex rounded-xl border border-slate-200 bg-slate-100 p-1 dark:border-white/10 dark:bg-white/[0.04]">
            {(Object.keys(zoomLabels) as TaskGanttZoom[]).map((key) => (
              <button
                key={key}
                onClick={() => setZoom(key)}
                className={cn(
                  "rounded-lg px-2.5 py-1 text-[11px] font-bold transition",
                  zoom === key
                    ? "bg-white text-indigo-700 shadow-sm dark:bg-zinc-800 dark:text-indigo-300"
                    : "text-slate-500 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-white",
                )}
              >
                {ctx.t(zoomLabels[key].ar, zoomLabels[key].en)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {model.bars.length === 0 || !model.rangeStart ? (
        <Empty
          icon={<IconCalendar size={24} />}
          title={ctx.t("لا توجد مهام ذات تواريخ صالحة", "No tasks have valid dates")}
          hint={ctx.t(
            "أضف تاريخ بداية أو استحقاق إلى مهمة كي تظهر في مخطط جانت.",
            "Add a start or due date to a task for it to appear in the Gantt chart.",
          )}
        />
      ) : (
        <div className="max-h-[680px] overflow-auto" dir="ltr">
          <div style={{ width: LABEL_WIDTH + chartWidth }}>
            <div className="sticky top-0 z-40 flex h-12 border-b border-slate-200 bg-white dark:border-white/[0.08] dark:bg-[#101018]">
              <div
                className="sticky left-0 z-50 flex shrink-0 items-center border-e border-slate-200 bg-white px-4 text-[11px] font-bold text-slate-500 dark:border-white/[0.08] dark:bg-[#101018] dark:text-zinc-500"
                style={{ width: LABEL_WIDTH }}
                dir={ctx.locale === "ar" ? "rtl" : "ltr"}
              >
                {ctx.t("المهمة والمسؤول", "Task & assignee")}
              </div>
              <div className="relative flex shrink-0" style={{ width: chartWidth }}>
                {segments.map((segment) => (
                  <div
                    key={segment.key}
                    className="flex shrink-0 items-center justify-center overflow-hidden border-e border-slate-200 px-1 text-center text-[10px] font-bold text-slate-500 dark:border-white/[0.08] dark:text-zinc-500"
                    style={{ width: segment.dayCount * dayWidth }}
                    title={`${formatDate(segment.startDate, ctx.locale)} – ${formatDate(segment.endDate, ctx.locale)}`}
                  >
                    <span className="truncate">{segmentLabel(segment, zoom, ctx.locale)}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="relative">
              <svg
                aria-hidden="true"
                className="pointer-events-none absolute z-20 overflow-visible text-violet-500/80 dark:text-violet-300/70"
                style={{ left: LABEL_WIDTH, top: 0 }}
                width={chartWidth}
                height={model.bars.length * ROW_HEIGHT}
              >
                <defs>
                  <marker
                    id="gantt-dependency-arrow"
                    markerWidth="7"
                    markerHeight="7"
                    refX="6"
                    refY="3.5"
                    orient="auto"
                  >
                    <path d="M 0 0 L 7 3.5 L 0 7 z" fill="currentColor" />
                  </marker>
                  <marker id="gantt-critical-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
                    <path d="M 0 0 L 7 3.5 L 0 7 z" className="fill-rose-500" />
                  </marker>
                </defs>
                {model.links.map((link) => {
                  const from = model.bars[link.blockingRow]!;
                  const to = model.bars[link.dependentRow]!;
                  const isCritical = criticalVisible && criticalLinkKeys.has(dependencyKey(link));
                  return (
                    <path
                      key={dependencyKey(link)}
                      d={dependencyPath(link, from, to, link.blockingRow, link.dependentRow, dayWidth)}
                      fill="none"
                      className={isCritical ? "stroke-rose-500" : "stroke-current"}
                      strokeWidth={isCritical ? 2.5 : 1.5}
                      markerEnd={isCritical ? "url(#gantt-critical-arrow)" : "url(#gantt-dependency-arrow)"}
                    >
                      <title>
                        {from.task.serial} → {to.task.serial} · {dependencyLabels[link.type]} ·{" "}
                        {formatMinutes(link.lagMinutes, ctx.locale)}
                      </title>
                    </path>
                  );
                })}
              </svg>

              {todayVisible && (
                <div
                  aria-label={ctx.t("اليوم", "Today")}
                  className="pointer-events-none absolute bottom-0 top-0 z-10 w-px bg-rose-500/70"
                  style={{ left: LABEL_WIDTH + (todayOffset + 0.5) * dayWidth }}
                >
                  <span className="absolute left-1 top-1 rounded bg-rose-500 px-1 py-0.5 text-[8px] font-bold text-white">
                    {ctx.t("اليوم", "Today")}
                  </span>
                </div>
              )}

              {model.bars.map((bar) => {
                const task = bar.task;
                const priority = PRIORITY_CONFIG[task.priority];
                const statusTone = STATUS_CONFIG[task.status]?.tone;
                const metric = metricByTask.get(task.id);
                const isCritical = criticalVisible && criticalTaskIds.has(task.id);
                const baselineTask = baselineTaskById.get(task.id);
                const baselineStartValue = baselineTask?.startDate ?? baselineTask?.dueDate;
                const baselineEndValue = baselineTask?.dueDate ?? baselineTask?.startDate;
                const baselineStart = baselineStartValue ? new Date(baselineStartValue) : null;
                const baselineEnd = baselineEndValue ? new Date(baselineEndValue) : null;
                const baselineStartOffset = baselineStart ? calendarDayDifference(baselineStart, model.rangeStart!) : 0;
                const baselineEndOffset = baselineEnd ? calendarDayDifference(baselineEnd, model.rangeStart!) + 1 : 0;
                const visibleBaselineStart = Math.max(0, baselineStartOffset);
                const visibleBaselineEnd = Math.min(model.totalDays, baselineEndOffset);
                return (
                  <div
                    key={task.id}
                    className="flex border-b border-slate-100 dark:border-white/[0.05]"
                    style={{ height: ROW_HEIGHT }}
                  >
                    <button
                      onClick={() => ctx.openTask(task)}
                      className={cn(
                        "sticky left-0 z-30 flex shrink-0 items-center gap-2 border-e border-slate-200 bg-white px-4 text-start hover:bg-slate-50 dark:border-white/[0.08] dark:bg-[#101018] dark:hover:bg-white/[0.04]",
                        isCritical && "bg-rose-50 dark:bg-rose-500/10",
                      )}
                      style={{ width: LABEL_WIDTH }}
                      dir={ctx.locale === "ar" ? "rtl" : "ltr"}
                    >
                      <span className={cn("h-2 w-2 shrink-0 rounded-full", priority?.bar ?? "bg-indigo-500")} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[11.5px] font-bold text-slate-800 dark:text-zinc-200">
                          {task.parentId ? "↳ " : ""}
                          {task.title}
                        </span>
                        <span className="mono block truncate text-[9px] text-slate-400 dark:text-zinc-600">
                          {task.serial} · {formatDate(bar.start, ctx.locale)} – {formatDate(bar.end, ctx.locale)}
                          {metric
                            ? ` · ${ctx.t("السماح", "Float")}: ${formatMinutes(metric.totalFloatMinutes, ctx.locale)}`
                            : ""}
                        </span>
                      </span>
                      <Avatar src={task.assignee?.avatarUrl} name={task.assignee?.name} size={20} />
                    </button>

                    <div
                      className="relative shrink-0"
                      style={{
                        width: chartWidth,
                        backgroundImage: `repeating-linear-gradient(to right, transparent 0, transparent ${Math.max(
                          0,
                          dayWidth - 1,
                        )}px, rgba(148,163,184,0.16) ${Math.max(0, dayWidth - 1)}px, rgba(148,163,184,0.16) ${dayWidth}px)`,
                      }}
                    >
                      {baselineTask && baselineStart && baselineEnd && visibleBaselineEnd > visibleBaselineStart && (
                        <span
                          aria-label={ctx.t("موضع خط الأساس", "Baseline position")}
                          className="absolute bottom-1 z-20 h-1.5 rounded-full bg-amber-400/90"
                          style={{
                            left: visibleBaselineStart * dayWidth,
                            width: (visibleBaselineEnd - visibleBaselineStart) * dayWidth,
                          }}
                        />
                      )}
                      <button
                        onClick={() => ctx.openTask(task)}
                        title={`${task.serial} · ${task.title}\n${formatDate(bar.start, ctx.locale)} – ${formatDate(
                          bar.end,
                          ctx.locale,
                        )}\n${task.progress}%${
                          metric
                            ? `\n${ctx.t("السماح الكلي", "Total float")}: ${formatMinutes(
                                metric.totalFloatMinutes,
                                ctx.locale,
                              )}`
                            : ""
                        }`}
                        className={cn(
                          "absolute top-2.5 z-30 flex h-8 min-w-1 items-center overflow-hidden rounded-lg border px-2 text-[10.5px] font-bold text-white shadow-sm transition hover:brightness-110 focus:z-40",
                          task.isMilestone && "h-5 w-5 rotate-45 rounded-sm px-0",
                          isCritical && "ring-2 ring-rose-400 ring-offset-1 dark:ring-offset-zinc-950",
                          statusTone === "emerald"
                            ? "border-emerald-600/30 bg-emerald-600"
                            : task.priority === "urgent"
                              ? "border-rose-600/30 bg-rose-600"
                              : "border-indigo-600/30 bg-indigo-600",
                        )}
                        style={{
                          left: task.isMilestone
                            ? bar.startOffset * dayWidth + dayWidth / 2 - 10
                            : bar.startOffset * dayWidth,
                          width: task.isMilestone ? 20 : bar.durationDays * dayWidth,
                        }}
                      >
                        <span
                          aria-hidden="true"
                          className="absolute inset-y-0 left-0 bg-white/20"
                          style={{ width: `${Math.max(0, Math.min(100, task.progress))}%` }}
                        />
                        {!task.isMilestone && (
                          <span className="relative z-10 truncate">
                            {task.serial} · {task.title}
                          </span>
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 bg-slate-50/50 px-5 py-3 text-[10.5px] text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.02] dark:text-zinc-500">
        <span>
          {ctx.t(
            "المسار الحرج يستخدم CPM والحسابين الأمامي والخلفي وأنواع FS/SS/FF/SF وفترات التأخير.",
            "Critical path uses CPM forward/backward passes with FS/SS/FF/SF dependencies and lag.",
          )}
        </span>
        <span className="mono font-semibold text-indigo-600 dark:text-indigo-300">
          {model.totalDays} {ctx.t("يوماً", "days")} · {model.dependencyReferences}{" "}
          {ctx.t("مرجع تبعية", "dependency references")}
        </span>
      </div>
    </Card>
  );
}
