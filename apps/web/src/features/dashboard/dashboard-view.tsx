"use client";

import { useMemo, useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { DashboardWidget, DashboardWidgetId, DashboardWidgetWidth, Task, ViewCtx } from "@/lib/types";
import { PRIORITY_CONFIG, STATUS_CONFIG, STATUS_ORDER, fmtMinutes } from "@/lib/types";
import { isTaskAssignedTo } from "@/features/tasks/assignment-domain";
import {
  Avatar,
  Badge,
  Bar,
  Btn,
  Card,
  Ring,
  ScreenHeader,
  ScreenState,
  ScreenToolbar,
  SectionTitle,
  SegmentedTabs,
  selectSmCls,
} from "@/components/ui";
import { IconCheck, IconFlag, IconPlay, IconRotateCw, IconSearch } from "@/components/icons";
import { confirmAction } from "@/components/feedback";
import {
  defaultDashboardWidgets,
  nextDashboardWidgetWidth,
  reorderDashboardWidgets,
} from "@/features/dashboard/layout";
import { useDashboardLayout } from "@/features/dashboard/use-dashboard-layout";
import { downloadPreparedWorkspaceExport, prepareWorkspaceExport } from "@/features/workspace/export-api";

const widgetLabels: Record<DashboardWidgetId, { ar: string; en: string }> = {
  total_tasks: { ar: "إجمالي المهام", en: "Total tasks" },
  completed_tasks: { ar: "المهام المكتملة", en: "Completed tasks" },
  in_progress_tasks: { ar: "قيد التنفيذ", en: "In progress" },
  overdue_tasks: { ar: "المهام المتأخرة", en: "Overdue tasks" },
  status_chart: { ar: "المهام حسب الحالة", en: "Tasks by status" },
  project_completion: { ar: "إنجاز المشروع", en: "Project completion" },
  custom_chart: { ar: "الرسم المخصص", en: "Custom chart" },
  goals: { ar: "الأهداف", en: "Goals" },
  team_distribution: { ar: "توزيع الفريق", en: "Team distribution" },
  time_logged: { ar: "الوقت المسجل", en: "Time logged" },
  activity: { ar: "نشاط مساحة العمل", en: "Workspace activity" },
};
const widthClasses: Record<DashboardWidgetWidth, string> = {
  small: "col-span-12 sm:col-span-6 xl:col-span-3",
  medium: "col-span-12 md:col-span-6 xl:col-span-4",
  wide: "col-span-12 xl:col-span-8",
  full: "col-span-12",
};

export function DashboardView({ ctx }: { ctx: ViewCtx }) {
  const [range, setRange] = useState<"all" | "7d" | "30d">("all");
  const [editing, setEditing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [now] = useState(() => new Date());
  const { widgets, loading, loadError, saving, save, reset, retry } = useDashboardLayout({
    activeOrg: ctx.activeOrg,
    activeWorkspace: ctx.activeWorkspace,
    t: ctx.t,
    notify: ctx.notify,
  });
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const tasks = useMemo(() => {
    if (range === "all") return ctx.tasks;
    const cutoff = new Date(now.getTime() - (range === "7d" ? 7 : 30) * 86_400_000);
    return ctx.tasks.filter((task) => {
      const created = new Date(task.createdAt);
      const due = task.dueDate ? new Date(task.dueDate) : null;
      return created >= cutoff || Boolean(due && due >= cutoff);
    });
  }, [ctx.tasks, now, range]);

  const hiddenWidgets = defaultDashboardWidgets.filter(
    (candidate) => !widgets.some((widget) => widget.id === candidate.id),
  );
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const reordered = reorderDashboardWidgets(widgets, active.id as DashboardWidgetId, over.id as DashboardWidgetId);
    if (reordered !== widgets) save(reordered);
  };
  const updateWidget = (id: DashboardWidgetId, patch: Partial<DashboardWidget>) =>
    save(widgets.map((widget) => (widget.id === id ? { ...widget, ...patch } : widget)));
  const removeWidget = (id: DashboardWidgetId) => {
    if (widgets.length > 1) save(widgets.filter((widget) => widget.id !== id));
  };
  const exportWorkspace = async () => {
    if (!ctx.activeOrg || !ctx.activeWorkspace || exporting) return;
    setExporting(true);
    try {
      const download = await prepareWorkspaceExport(
        {
          organizationId: ctx.activeOrg.id,
          workspaceId: ctx.activeWorkspace.id,
        },
        { format: "pdf" },
      );
      downloadPreparedWorkspaceExport(download);
      ctx.notify(ctx.t("أصبح تقرير PDF جاهزاً للتنزيل", "PDF report is ready to download"));
    } catch (error) {
      ctx.notify(
        error instanceof Error ? error.message : ctx.t("تعذر إنشاء تقرير PDF", "Could not create PDF report"),
        "error",
      );
    } finally {
      setExporting(false);
    }
  };

  if (loadError) {
    return (
      <div className="space-y-5">
        <ScreenState
          tone="error"
          title={ctx.t("تعذر تحميل لوحة التحكم", "Failed to load dashboard")}
          description={loadError}
          action={
            <Btn variant="outline" onClick={() => void retry()}>
              <IconRotateCw size={14} />
              {ctx.t("إعادة المحاولة", "Retry")}
            </Btn>
          }
        />
      </div>
    );
  }

  return (
    <div className="screen-container-wide space-y-5">
      <ScreenHeader
        title={ctx.t("لوحة المعلومات والتحليلات", "Dashboard & Analytics")}
        description={ctx.t(
          "نظرة شاملة ومؤشرات أداء قابلة للتخصيص لمساحة العمل والمشاريع.",
          "Comprehensive overview and customizable KPIs for workspace and projects.",
        )}
        actions={
          <div className="flex items-center gap-2">
            {saving && <span className="text-[11px] text-ink-faint">{ctx.t("جارٍ الحفظ…", "Saving…")}</span>}
            {ctx.can("data.export") && (
              <Btn
                variant="outline"
                size="sm"
                disabled={exporting || !ctx.activeWorkspace}
                onClick={() => void exportWorkspace()}
              >
                {exporting ? ctx.t("جارٍ تجهيز PDF…", "Preparing PDF…") : ctx.t("تصدير تقرير PDF", "Export PDF report")}
              </Btn>
            )}
            <Btn
              variant={editing ? "glow" : "outline"}
              size="sm"
              disabled={loading || Boolean(loadError) || saving}
              onClick={() => setEditing((value) => !value)}
            >
              {editing ? ctx.t("إنهاء التخصيص", "Finish customizing") : ctx.t("تخصيص اللوحة", "Customize dashboard")}
            </Btn>
          </div>
        }
      />

      <ScreenToolbar className="border border-line bg-surface p-3.5 shadow-sm">
        <div className="flex items-center gap-2">
          <SegmentedTabs
            value={range}
            label={ctx.t("نطاق التقرير", "Report range")}
            onChange={(val) => setRange(val as "all" | "7d" | "30d")}
            items={[
              { id: "7d", label: ctx.t("7 أيام", "7 days") },
              { id: "30d", label: ctx.t("30 يوماً", "30 days") },
              { id: "all", label: ctx.t("كل الأوقات", "All time") },
            ]}
          />
        </div>
      </ScreenToolbar>

      {editing && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-accent/30 bg-accent/5 p-3">
          <span className="text-[11.5px] font-semibold text-ink">
            {ctx.t(
              "اسحب البطاقات من المقبض. غيّر الحجم أو أخفِ البطاقة.",
              "Drag cards by the handle, resize, or hide them.",
            )}
          </span>
          <div className="ms-auto flex flex-wrap gap-2">
            {hiddenWidgets.map((widget) => (
              <button
                key={widget.id}
                type="button"
                disabled={saving}
                onClick={() => save([...widgets, widget])}
                className="rounded-lg border border-line bg-surface px-2.5 py-1 text-[11px] font-semibold text-accent transition hover:bg-raised disabled:opacity-50"
              >
                + {ctx.t(widgetLabels[widget.id].ar, widgetLabels[widget.id].en)}
              </button>
            ))}
            <button
              type="button"
              disabled={saving}
              onClick={async () => {
                const confirmed = await confirmAction({
                  title: ctx.t("استعادة التخطيط الافتراضي", "Reset to default layout"),
                  message: ctx.t(
                    "هل أنت متأكد من رغبتك في استعادة ترتيب وودجات لوحة التحكم الافتراضية؟",
                    "Are you sure you want to reset the dashboard widgets to default?",
                  ),
                  tone: "warning",
                });
                if (confirmed) reset();
              }}
              className="rounded-lg px-2.5 py-1 text-[11px] font-semibold text-ink-soft transition hover:bg-raised disabled:opacity-50"
            >
              {ctx.t("استعادة الافتراضي", "Reset default")}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-12 gap-4">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="skeleton col-span-12 h-40 rounded-2xl sm:col-span-6 xl:col-span-4" />
          ))}
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={widgets.map((widget) => widget.id)} strategy={rectSortingStrategy}>
            <div className="grid grid-cols-12 gap-4">
              {widgets.map((widget) => (
                <SortableWidget
                  key={widget.id}
                  widget={widget}
                  editing={editing}
                  saving={saving}
                  title={ctx.t(widgetLabels[widget.id].ar, widgetLabels[widget.id].en)}
                  onRemove={() => removeWidget(widget.id)}
                  onResize={() => updateWidget(widget.id, { width: nextDashboardWidgetWidth(widget.width) })}
                >
                  <WidgetContent
                    widget={widget}
                    ctx={ctx}
                    tasks={tasks}
                    now={now}
                    onChange={(patch) => updateWidget(widget.id, patch)}
                  />
                </SortableWidget>
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}

function SortableWidget({
  widget,
  editing,
  saving,
  title,
  onRemove,
  onResize,
  children,
}: {
  widget: DashboardWidget;
  editing: boolean;
  saving?: boolean;
  title: string;
  onRemove: () => void;
  onResize: () => void;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: widget.id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`${widthClasses[widget.width]} ${isDragging ? "z-20 opacity-70" : ""}`}
    >
      {editing && (
        <div className="mb-1.5 flex items-center rounded-xl border border-line bg-surface px-2 py-1">
          <button
            type="button"
            {...attributes}
            {...listeners}
            className="cursor-grab px-2 text-[15px] text-ink-faint active:cursor-grabbing"
            aria-label={`Drag ${title}`}
          >
            ⠿
          </button>
          <span className="truncate text-[10.5px] font-semibold text-ink-soft">{title}</span>
          <button
            type="button"
            disabled={saving}
            onClick={onResize}
            className="ms-auto px-2 text-[10.5px] font-semibold text-accent disabled:opacity-50"
          >
            {widget.width}
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={onRemove}
            className="px-2 text-[12px] font-bold text-rose-500 disabled:opacity-50"
            aria-label={`Hide ${title}`}
          >
            ×
          </button>
        </div>
      )}
      {children}
    </div>
  );
}

function WidgetContent({
  widget,
  ctx,
  tasks,
  now,
  onChange,
}: {
  widget: DashboardWidget;
  ctx: ViewCtx;
  tasks: Task[];
  now: Date;
  onChange: (patch: Partial<DashboardWidget>) => void;
}) {
  const total = tasks.length;
  const done = tasks.filter((task) => task.status === "done").length;
  const inProgress = tasks.filter((task) => task.status === "in_progress").length;
  const overdue = tasks.filter((task) => task.dueDate && new Date(task.dueDate) < now && task.status !== "done").length;
  const progress = total ? Math.round((done / total) * 100) : 0;
  if (widget.id === "total_tasks")
    return (
      <Kpi title={ctx.t("إجمالي المهام", "Total tasks")} value={total} icon={<IconSearch size={16} />} tone="indigo" />
    );
  if (widget.id === "completed_tasks")
    return <Kpi title={ctx.t("مكتملة", "Completed")} value={done} icon={<IconCheck size={16} />} tone="emerald" />;
  if (widget.id === "in_progress_tasks")
    return (
      <Kpi title={ctx.t("قيد التنفيذ", "In progress")} value={inProgress} icon={<IconPlay size={16} />} tone="amber" />
    );
  if (widget.id === "overdue_tasks")
    return <Kpi title={ctx.t("متأخرة", "Overdue")} value={overdue} icon={<IconFlag size={16} />} tone="rose" />;
  if (widget.id === "status_chart") return <StatusWidget ctx={ctx} tasks={tasks} />;
  if (widget.id === "project_completion")
    return (
      <Card className="flex min-h-[280px] flex-col items-center justify-center p-6" glow>
        <SectionTitle>{ctx.t("إنجاز المشروع", "Project completion")}</SectionTitle>
        <Ring value={progress} size={145} stroke={11} />
        <div className="mt-3 text-[12px] text-slate-500">
          {done}/{total} {ctx.t("مهمة مكتملة", "tasks done")}
        </div>
      </Card>
    );
  if (widget.id === "custom_chart")
    return <CustomChartWidget ctx={ctx} tasks={tasks} widget={widget} onChange={onChange} />;
  if (widget.id === "goals") return <GoalsWidget ctx={ctx} />;
  if (widget.id === "team_distribution") return <TeamWidget ctx={ctx} tasks={tasks} />;
  if (widget.id === "time_logged") return <TimeWidget ctx={ctx} />;
  return <ActivityWidget ctx={ctx} />;
}

function Kpi({ title, value, icon, tone }: { title: string; value: number; icon: React.ReactNode; tone: string }) {
  const toneClass =
    {
      indigo: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-300",
      emerald: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
      amber: "bg-amber-500/10 text-amber-600 dark:text-amber-300",
      rose: "bg-rose-500/10 text-rose-600 dark:text-rose-300",
    }[tone] ?? "bg-slate-500/10 text-slate-600 dark:text-slate-300";
  return (
    <Card className="relative min-h-[130px] overflow-hidden p-5">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{title}</div>
          <div className="mono mt-3 text-[30px] font-bold leading-none text-slate-900 dark:text-white">{value}</div>
        </div>
        <span className={`grid h-9 w-9 place-items-center rounded-xl ${toneClass}`}>{icon}</span>
      </div>
    </Card>
  );
}

function StatusWidget({ ctx, tasks }: { ctx: ViewCtx; tasks: Task[] }) {
  const counts = STATUS_ORDER.map((status) => ({
    status,
    count: tasks.filter((task) => task.status === status).length,
  }));
  const max = Math.max(...counts.map((item) => item.count), 1);
  return (
    <Card className="min-h-[280px] p-6">
      <SectionTitle>{ctx.t("المهام حسب الحالة", "Tasks by status")}</SectionTitle>
      <div className="flex h-[210px] items-end gap-3">
        {counts.map(({ status, count }) => (
          <div key={status} className="flex flex-1 flex-col items-center gap-2">
            <span className="mono text-[12px] font-bold dark:text-white">{count}</span>
            <div className="flex h-[150px] w-full items-end overflow-hidden rounded-xl bg-slate-100 dark:bg-white/4">
              <div
                className={`w-full rounded-xl ${STATUS_CONFIG[status].dot}`}
                style={{ height: `${Math.max(5, (count / max) * 100)}%` }}
              />
            </div>
            <span className="text-[10px] text-slate-500">{STATUS_CONFIG[status][ctx.locale]}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function CustomChartWidget({
  ctx,
  tasks,
  widget,
  onChange,
}: {
  ctx: ViewCtx;
  tasks: Task[];
  widget: DashboardWidget;
  onChange: (patch: Partial<DashboardWidget>) => void;
}) {
  const settings = {
    chartType: widget.settings?.chartType ?? "bar",
    groupBy: widget.settings?.groupBy ?? "priority",
    metric: widget.settings?.metric ?? "count",
  };
  const data = useMemo(() => {
    const values = new Map<string, { label: string; value: number }>();
    for (const task of tasks) {
      const key =
        settings.groupBy === "assignee"
          ? task.assigneeId || "unassigned"
          : settings.groupBy === "tag"
            ? task.tags?.[0] || "general"
            : task[settings.groupBy];
      const label =
        settings.groupBy === "assignee"
          ? task.assignee?.name || ctx.t("غير مسند", "Unassigned")
          : settings.groupBy === "priority"
            ? PRIORITY_CONFIG[key]?.[ctx.locale] || key
            : settings.groupBy === "status"
              ? STATUS_CONFIG[key]?.[ctx.locale] || key
              : key;
      const current = values.get(key) ?? { label, value: 0 };
      current.value +=
        settings.metric === "count"
          ? 1
          : settings.metric === "points"
            ? task.storyPoints || 0
            : settings.metric === "estimate"
              ? task.estimatedHours || 0
              : task.loggedHours || 0;
      values.set(key, current);
    }
    return [...values.values()].sort((a, b) => b.value - a.value);
  }, [ctx, settings.groupBy, settings.metric, tasks]);
  const max = Math.max(...data.map((item) => item.value), 1);
  return (
    <Card className="min-h-[300px] p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionTitle>{ctx.t("الرسم المخصص", "Custom chart")}</SectionTitle>
        <div className="flex gap-2">
          {(["groupBy", "metric", "chartType"] as const).map((key) => (
            <select
              name="auto-field-k7n478v"
              key={key}
              value={settings[key]}
              onChange={(event) => onChange({ settings: { ...settings, [key]: event.target.value } })}
              className={`${selectSmCls} h-7.5 text-[11px]`}
            >
              {(key === "groupBy"
                ? ["priority", "status", "assignee", "tag"]
                : key === "metric"
                  ? ["count", "points", "estimate", "logged"]
                  : ["bar", "rank", "donut"]
              ).map((option) => (
                <option key={option}>{option}</option>
              ))}
            </select>
          ))}
        </div>
      </div>
      <ChartDataView data={data} max={max} chartType={settings.chartType} />
    </Card>
  );
}

function ChartDataView({
  data,
  max,
  chartType,
}: {
  data: Array<{ label: string; value: number }>;
  max: number;
  chartType: "bar" | "rank" | "donut";
}) {
  if (!data.length) {
    return <p className="py-12 text-center text-[12px] text-slate-500">No data</p>;
  }
  if (chartType === "donut") {
    const total = data.reduce((sum, item) => sum + item.value, 0) || 1;
    const colors = ["#6366f1", "#8b5cf6", "#06b6d4", "#10b981", "#f59e0b", "#f43f5e"];
    const gradient = data
      .map((item, index) => {
        const start = (data.slice(0, index).reduce((sum, preceding) => sum + preceding.value, 0) / total) * 100;
        const end = start + (item.value / total) * 100;
        return `${colors[index % colors.length]} ${start}% ${end}%`;
      })
      .join(", ");
    return (
      <div className="mt-5 flex flex-wrap items-center justify-center gap-8">
        <div
          className="grid h-40 w-40 place-items-center rounded-full"
          style={{ background: `conic-gradient(${gradient})` }}
        >
          <div className="grid h-24 w-24 place-items-center rounded-full bg-white text-lg font-bold dark:bg-zinc-950 dark:text-white">
            {total}
          </div>
        </div>
        <div className="min-w-44 space-y-2">
          {data.map((item, index) => (
            <div key={item.label} className="flex items-center gap-2 text-[12px]">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: colors[index % colors.length] }} />
              <span className="flex-1 truncate text-slate-600 dark:text-zinc-300">{item.label}</span>
              <strong className="dark:text-white">{item.value}</strong>
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (chartType === "rank") {
    return (
      <ol className="mt-5 space-y-2">
        {data.map((item, index) => (
          <li key={item.label} className="flex items-center gap-3 rounded-xl bg-slate-50 px-3 py-2.5 dark:bg-white/4">
            <span className="mono grid h-7 w-7 place-items-center rounded-lg bg-indigo-500/10 text-[11px] font-bold text-indigo-600 dark:text-indigo-300">
              {index + 1}
            </span>
            <span className="flex-1 truncate text-[12px] text-slate-600 dark:text-zinc-300">{item.label}</span>
            <strong className="mono text-[12px] dark:text-white">{item.value}</strong>
          </li>
        ))}
      </ol>
    );
  }
  return (
    <div className="mt-5 space-y-3">
      {data.map((item) => (
        <div key={item.label} className="flex items-center gap-3">
          <span className="w-28 truncate text-[12px] text-slate-600 dark:text-zinc-300">{item.label}</span>
          <div className="h-3 flex-1 rounded-full bg-slate-100 dark:bg-white/5">
            <div className="h-full rounded-full bg-indigo-500" style={{ width: `${(item.value / max) * 100}%` }} />
          </div>
          <span className="mono w-12 text-end text-[12px] font-bold dark:text-white">{item.value}</span>
        </div>
      ))}
    </div>
  );
}

function GoalsWidget({ ctx }: { ctx: ViewCtx }) {
  return (
    <Card className="min-h-[250px] p-5">
      <SectionTitle>{ctx.t("الأهداف", "Goals")}</SectionTitle>
      <div className="space-y-3">
        {ctx.goals.slice(0, 4).map((goal) => (
          <div key={goal.id} className="rounded-xl border border-slate-200 p-3 dark:border-white/10">
            <div className="flex justify-between gap-2 text-[12px] dark:text-white">
              <span className="truncate">{goal.title}</span>
              <span>{goal.progress}%</span>
            </div>
            <Bar value={goal.progress} className="mt-2" />
          </div>
        ))}
        {!ctx.goals.length && (
          <p className="py-8 text-center text-[12px] text-slate-500">{ctx.t("لا أهداف بعد", "No goals yet")}</p>
        )}
      </div>
    </Card>
  );
}

function TeamWidget({ ctx, tasks }: { ctx: ViewCtx; tasks: Task[] }) {
  const max = Math.max(...ctx.users.map((user) => tasks.filter((task) => isTaskAssignedTo(task, user.id)).length), 1);
  return (
    <Card className="min-h-[250px] p-5">
      <SectionTitle>{ctx.t("توزيع الفريق", "Team distribution")}</SectionTitle>
      <div className="space-y-4">
        {ctx.users.slice(0, 5).map((user) => {
          const count = tasks.filter((task) => isTaskAssignedTo(task, user.id)).length;
          return (
            <div key={user.id} className="flex items-center gap-3">
              <Avatar src={user.avatarUrl} name={user.name} size={28} />
              <div className="flex-1">
                <div className="mb-1 flex justify-between text-[11px] dark:text-zinc-300">
                  <span>{user.name}</span>
                  <span>{count}</span>
                </div>
                <Bar value={(count / max) * 100} />
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function TimeWidget({ ctx }: { ctx: ViewCtx }) {
  const periods = [...ctx.timesheets]
    .sort((a, b) => b.periodStart.localeCompare(a.periodStart))
    .slice(0, 6)
    .reverse();
  const max = Math.max(...periods.map((period) => period.totalMinutes), 1);
  return (
    <Card className="min-h-[250px] p-5">
      <SectionTitle>{ctx.t("الوقت المسجل", "Time logged")}</SectionTitle>
      <div className="flex h-32 items-end gap-2">
        {periods.map((period) => (
          <div key={period.id} className="flex flex-1 flex-col items-center gap-1">
            <span className="text-[9px] text-slate-500">{Math.round(period.totalMinutes / 60)}h</span>
            <div className="flex h-24 w-full items-end rounded-lg bg-slate-100 dark:bg-white/5">
              <div
                className="w-full rounded-lg bg-indigo-500"
                style={{ height: `${Math.max(4, (period.totalMinutes / max) * 100)}%` }}
              />
            </div>
          </div>
        ))}
        {!periods.length && (
          <p className="m-auto text-[12px] text-slate-500">{ctx.t("لا توجد فترات مسجلة", "No recorded periods")}</p>
        )}
      </div>
      <div className="mt-3 flex justify-between rounded-xl bg-indigo-50 p-3 text-[11px] text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300">
        <span>{ctx.t("الإجمالي", "Total")}</span>
        <strong>{fmtMinutes(ctx.timeTotals.totalMinutes)}</strong>
      </div>
    </Card>
  );
}

function ActivityWidget({ ctx }: { ctx: ViewCtx }) {
  return (
    <Card className="p-6">
      <div className="flex justify-between">
        <SectionTitle>{ctx.t("نشاط مساحة العمل", "Workspace activity")}</SectionTitle>
        <Badge tone="emerald">{ctx.activities.length}</Badge>
      </div>
      <div className="mt-3 divide-y divide-slate-100 dark:divide-white/5">
        {ctx.activities.slice(0, 8).map((activity) => (
          <div key={activity.id} className="flex items-center gap-3 py-3 text-[12px]">
            <Avatar src={activity.actor?.avatarUrl} name={activity.actor?.name} size={28} />
            <span className="font-semibold dark:text-white">{activity.actor?.name || ctx.t("مستخدم", "User")}</span>
            <span className="truncate text-slate-500">{activity.action}</span>
            <span className="ms-auto text-[10px] text-slate-400">
              {new Date(activity.createdAt).toLocaleString(ctx.locale === "ar" ? "ar-u-nu-latn" : "en-US")}
            </span>
          </div>
        ))}
        {!ctx.activities.length && (
          <p className="py-8 text-center text-[12px] text-slate-500">{ctx.t("لا يوجد نشاط بعد", "No activity yet")}</p>
        )}
      </div>
    </Card>
  );
}
