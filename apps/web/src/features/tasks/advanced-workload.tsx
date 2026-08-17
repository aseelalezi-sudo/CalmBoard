"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Task, User, ViewCtx, WorkloadSettings, WorkloadTimeOff } from "@/lib/types";
import { fmtMinutes, fmtNumber } from "@/lib/types";
import { Avatar, Badge, Btn, Card, ScreenState, SectionTitle } from "@/components/ui";
import { promptAction } from "@/components/feedback";
import { cn } from "@/lib/utils";
import {
  createWorkloadTimeOff,
  deleteWorkloadTimeOff,
  getWorkloadSettings,
  updateWorkloadCapacity,
} from "./workload-api";
import {
  addUtcDays,
  calculateWeeklyWorkload,
  DEFAULT_WORKDAY_MASK,
  isoDate,
  startOfIsoWeek,
} from "./workload-analysis";
import { getTaskAssigneeIds, isTaskAssignedTo, rebalanceTaskAssignees } from "./assignment-domain";

const EMPTY_SETTINGS: WorkloadSettings = { capacities: [], timeOff: [] };

function minutesLabel(minutes: number, locale: ViewCtx["locale"]) {
  return fmtMinutes(minutes, locale);
}

function uniqueScopedUsers(members: ViewCtx["members"], directoryUsers: User[]) {
  const users = members.flatMap((member) => (member.user ? [member.user] : []));
  const source = users.length ? users : directoryUsers;
  return [...new Map(source.map((user) => [user.id, user])).values()];
}

const kindLabels: Record<WorkloadTimeOff["kind"], { ar: string; en: string }> = {
  vacation: { ar: "إجازة", en: "Vacation" },
  sick: { ar: "مرضية", en: "Sick leave" },
  personal: { ar: "شخصية", en: "Personal leave" },
  public_holiday: { ar: "عطلة عامة", en: "Public holiday" },
};

export function AdvancedWorkload({ ctx }: { ctx: ViewCtx }) {
  const { notify, t } = ctx;
  const [weekStart, setWeekStart] = useState(() => startOfIsoWeek(new Date()));
  const [settings, setSettings] = useState<WorkloadSettings>(EMPTY_SETTINGS);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const scopedUsers = useMemo(() => uniqueScopedUsers(ctx.members, ctx.users), [ctx.members, ctx.users]);
  const weekEnd = useMemo(() => addUtcDays(weekStart, 6), [weekStart]);
  const scope = useMemo(
    () =>
      ctx.activeProject
        ? {
            organizationId: ctx.activeProject.organizationId,
            workspaceId: ctx.activeProject.workspaceId,
            actorId: ctx.currentUser?.id,
          }
        : ctx.activeWorkspace
          ? {
              organizationId: ctx.activeWorkspace.organizationId,
              workspaceId: ctx.activeWorkspace.id,
              actorId: ctx.currentUser?.id,
            }
          : null,
    [ctx.activeProject, ctx.activeWorkspace, ctx.currentUser?.id],
  );

  const loadSettings = useCallback(async () => {
    if (!scope) {
      setSettings(EMPTY_SETTINGS);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      setSettings(await getWorkloadSettings(scope, isoDate(weekStart), isoDate(weekEnd)));
    } catch {
      setSettings(EMPTY_SETTINGS);
      const msg = t("تعذر تحميل السعة والإجازات", "Failed to load capacity and time off");
      setLoadError(msg);
      notify(msg, "error");
    } finally {
      setLoading(false);
    }
  }, [notify, scope, t, weekEnd, weekStart]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const workload = useMemo(
    () =>
      calculateWeeklyWorkload({
        tasks: ctx.tasks,
        users: scopedUsers,
        capacities: settings.capacities,
        timeOff: settings.timeOff,
        weekStart,
      }),
    [ctx.tasks, scopedUsers, settings, weekStart],
  );

  const editCapacity = async (user: User) => {
    if (!scope || !ctx.can("members.manage")) return;
    const current = settings.capacities.find((capacity) => capacity.userId === user.id);
    const value = await promptAction({
      title: ctx.t("تعديل السعة الأسبوعية", "Edit weekly capacity"),
      label: ctx.t(`السعة الأسبوعية لـ ${user.name} بالساعات:`, `Weekly capacity for ${user.name} in hours:`),
      defaultValue: String((current?.weeklyMinutes ?? 2400) / 60),
    });
    if (value === null) return;
    const hours = Number(value);
    if (!Number.isFinite(hours) || hours < 0 || hours > 168) {
      ctx.notify(ctx.t("يجب أن تكون السعة بين 0 و168 ساعة", "Capacity must be between 0 and 168 hours"), "error");
      return;
    }
    try {
      const updated = await updateWorkloadCapacity(scope, user.id, {
        weeklyMinutes: Math.round(hours * 60),
        workdayMask: current?.workdayMask ?? DEFAULT_WORKDAY_MASK,
      });
      setSettings((previous) => ({
        ...previous,
        capacities: [...previous.capacities.filter((capacity) => capacity.userId !== user.id), updated],
      }));
      ctx.notify(ctx.t("تم حفظ السعة الأسبوعية", "Weekly capacity saved"));
    } catch {
      ctx.notify(ctx.t("تعذر حفظ السعة", "Failed to save capacity"), "error");
    }
  };

  const addTimeOff = async (user?: User) => {
    if (!scope || !ctx.can("members.manage")) return;
    const defaultDate = isoDate(weekStart);
    const startsOn = await promptAction({
      title: ctx.t("إضافة إجازة", "Add time off"),
      label: ctx.t("تاريخ البداية YYYY-MM-DD:", "Start date YYYY-MM-DD:"),
      defaultValue: defaultDate,
    });
    if (!startsOn) return;
    const endsOn = await promptAction({
      title: ctx.t("إضافة إجازة", "Add time off"),
      label: ctx.t("تاريخ النهاية YYYY-MM-DD:", "End date YYYY-MM-DD:"),
      defaultValue: startsOn,
    });
    if (!endsOn) return;
    if (endsOn < startsOn) {
      ctx.notify(ctx.t("تاريخ النهاية يجب ألا يكون قبل البداية", "End date must not be before start date"), "error");
      return;
    }
    const rawKind = user
      ? await promptAction({
          title: ctx.t("نوع الإجازة", "Time-off type"),
          label: ctx.t("النوع: vacation أو sick أو personal", "Type: vacation, sick, or personal"),
          defaultValue: "vacation",
        })
      : "public_holiday";
    if (!rawKind) return;
    const kind = rawKind.trim() as WorkloadTimeOff["kind"];
    if (!(kind in kindLabels) || (!user && kind !== "public_holiday") || (user && kind === "public_holiday")) {
      ctx.notify(ctx.t("نوع الإجازة غير صالح", "Invalid time-off type"), "error");
      return;
    }
    const note =
      (await promptAction({
        title: ctx.t("ملاحظة", "Note"),
        label: ctx.t("ملاحظة اختيارية:", "Optional note:"),
        defaultValue: "",
      })) ?? undefined;
    try {
      await createWorkloadTimeOff(scope, { userId: user?.id ?? null, kind, startsOn, endsOn, note: note || undefined });
      await loadSettings();
      ctx.notify(ctx.t("تم حفظ الإجازة", "Time off saved"));
    } catch {
      ctx.notify(ctx.t("تعذر حفظ الإجازة؛ تحقق من التواريخ", "Failed to save time off; check the dates"), "error");
    }
  };

  const removeTimeOff = async (id: string) => {
    if (!scope || !ctx.can("members.manage")) return;
    try {
      await deleteWorkloadTimeOff(scope, id);
      setSettings((previous) => ({ ...previous, timeOff: previous.timeOff.filter((entry) => entry.id !== id) }));
      ctx.notify(ctx.t("حُذفت الإجازة", "Time off removed"));
    } catch {
      ctx.notify(ctx.t("تعذر حذف الإجازة", "Failed to remove time off"), "error");
    }
  };

  const rebalance = async (sourceUserId: string) => {
    const source = workload.rows.find((row) => row.user.id === sourceUserId);
    const candidateTasks = (source?.taskIds ?? [])
      .map((id) => ctx.tasks.find((candidate) => candidate.id === id && !candidate.deletedAt))
      .filter((t): t is Task => Boolean(t && isTaskAssignedTo(t, sourceUserId)));

    const candidatePairs = candidateTasks.flatMap((t) => {
      const currentAssigneeIds = getTaskAssigneeIds(t);
      const eligibleTargets = workload.rows
        .filter(
          (row) =>
            row.user.id !== sourceUserId &&
            !currentAssigneeIds.includes(row.user.id) &&
            row.effectiveCapacityMinutes > row.allocatedMinutes &&
            row.level !== "unavailable",
        )
        .sort(
          (left, right) =>
            left.allocatedMinutes / left.effectiveCapacityMinutes -
            right.allocatedMinutes / right.effectiveCapacityMinutes,
        );
      return eligibleTargets.length > 0 ? [{ task: t, target: eligibleTargets[0]! }] : [];
    });

    const pair = candidatePairs[0];
    if (!pair) {
      ctx.notify(ctx.t("لا يوجد عضو متاح لنقل المهمة إليه", "No available member can receive a task"), "error");
      return;
    }

    const { task, target } = pair;
    const rebalanced = rebalanceTaskAssignees(task, sourceUserId, target.user.id);
    if (!rebalanced) {
      ctx.notify(ctx.t("تعذر إعادة التوزيع", "Could not rebalance task"), "error");
      return;
    }

    const updated = await ctx.updateTask(task.id, {
      expectedVersion: task.version,
      assigneeId: rebalanced.assigneeId,
      assigneeIds: rebalanced.assigneeIds,
    });
    if (updated) {
      ctx.notify(
        ctx.t(
          `نُقلت ${task.serial} إلى ${target.user.name} بناءً على السعة الفعلية`,
          `${task.serial} moved to ${target.user.name} using effective capacity`,
        ),
      );
      await ctx.refreshProjectTasks();
    }
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_330px]">
      <Card className="border border-line bg-surface p-6">
        <SectionTitle
          count={workload.rows.length}
          action={
            <div className="flex items-center gap-1.5">
              <Btn size="sm" onClick={() => setWeekStart((date) => addUtcDays(date, -7))}>
                {ctx.locale === "ar" ? "→" : "←"}
              </Btn>
              <Btn size="sm" onClick={() => setWeekStart(startOfIsoWeek(new Date()))}>
                {ctx.t("هذا الأسبوع", "This week")}
              </Btn>
              <Btn size="sm" onClick={() => setWeekStart((date) => addUtcDays(date, 7))}>
                {ctx.locale === "ar" ? "←" : "→"}
              </Btn>
            </div>
          }
        >
          {ctx.t("عبء العمل الأسبوعي", "Weekly Workload")}
        </SectionTitle>
        <div className="mb-5 text-[12px] text-ink-faint">
          {new Date(`${workload.weekStart}T00:00:00Z`).toLocaleDateString(
            ctx.locale === "ar" ? "ar-u-nu-latn" : "en-US",
          )}{" "}
          –{" "}
          {new Date(`${workload.weekEnd}T00:00:00Z`).toLocaleDateString(ctx.locale === "ar" ? "ar-u-nu-latn" : "en-US")}
          {loading && <span className="ms-2">{ctx.t("جارٍ التحديث…", "Refreshing…")}</span>}
        </div>

        {loading ? (
          <ScreenState
            framed={false}
            tone="loading"
            title={ctx.t("جارٍ تحميل عبء العمل…", "Loading workload…")}
            description={ctx.t(
              "يرجى الانتظار بينما نحسب السعة وساعات العمل الموزعة.",
              "Calculating capacity and allocated hours.",
            )}
          />
        ) : loadError ? (
          <ScreenState
            framed={false}
            tone="error"
            title={ctx.t("تعذر تحميل عبء العمل", "Failed to load workload")}
            description={loadError}
            action={
              <Btn variant="outline" size="sm" onClick={() => void loadSettings()}>
                {ctx.t("إعادة المحاولة", "Retry")}
              </Btn>
            }
          />
        ) : workload.rows.length === 0 ? (
          <ScreenState
            framed={false}
            tone="empty"
            title={ctx.t("لا يوجد أعضاء نشطون في مساحة العمل", "No active workspace members")}
            description={ctx.t(
              "أضف أعضاء إلى مساحة العمل لحساب وتوزيع عبء العمل.",
              "Add members to calculate workload.",
            )}
          />
        ) : (
          <div className="space-y-4">
            {workload.rows.map((row) => {
              const width = Math.min(100, row.utilizationPercent);
              const tone =
                row.level === "overloaded"
                  ? "rose"
                  : row.level === "full"
                    ? "amber"
                    : row.level === "unavailable"
                      ? "neutral"
                      : "emerald";
              return (
                <div key={row.user.id} className="rounded-xl border border-line bg-raised/40 p-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <Avatar src={row.user.avatarUrl} name={row.user.name} size={38} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13.5px] font-bold text-ink">{row.user.name}</div>
                      <div className="text-[11px] text-ink-faint">
                        {fmtNumber(row.taskCount, ctx.locale)} {ctx.t("مهام مجدولة", "scheduled tasks")}
                        {row.timeOffDays > 0 &&
                          ` · ${fmtNumber(row.timeOffDays, ctx.locale)} ${ctx.t("أيام غياب", "days off")}`}
                      </div>
                    </div>
                    <Badge tone={tone}>
                      {row.level === "overloaded"
                        ? ctx.t("مثقل", "Overloaded")
                        : row.level === "full"
                          ? ctx.t("ممتلئ", "Full")
                          : row.level === "unavailable"
                            ? ctx.t("غير متاح", "Unavailable")
                            : ctx.t("متاح", "Available")}
                    </Badge>
                    {ctx.can("members.manage") && (
                      <Btn size="sm" onClick={() => void editCapacity(row.user)}>
                        {ctx.t("السعة", "Capacity")}
                      </Btn>
                    )}
                    {ctx.can("members.manage") && (
                      <Btn size="sm" onClick={() => void addTimeOff(row.user)}>
                        {ctx.t("إجازة", "Time off")}
                      </Btn>
                    )}
                  </div>
                  <div className="mt-3 flex items-center justify-between text-[11.5px] text-ink-soft">
                    <span>
                      {minutesLabel(row.allocatedMinutes, ctx.locale)} /{" "}
                      {minutesLabel(row.effectiveCapacityMinutes, ctx.locale)} {ctx.t("متاحة", "available")}
                    </span>
                    <span className="font-bold tabular-nums">{fmtNumber(row.utilizationPercent, ctx.locale)}%</span>
                  </div>
                  <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-line">
                    <div
                      className={cn(
                        "h-full rounded-full",
                        row.level === "overloaded"
                          ? "bg-rose-500"
                          : row.level === "full"
                            ? "bg-amber-500"
                            : row.level === "unavailable"
                              ? "bg-slate-400"
                              : "bg-emerald-500",
                      )}
                      style={{ width: `${width}%` }}
                    />
                  </div>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[10.5px] text-ink-faint">
                    <span>
                      {ctx.t("السعة الأصلية", "Configured")} {minutesLabel(row.configuredCapacityMinutes, ctx.locale)}
                      {row.timeOffMinutes > 0 &&
                        ` · −${minutesLabel(row.timeOffMinutes, ctx.locale)} ${ctx.t("إجازات", "time off")}`}
                    </span>
                    {row.level === "overloaded" && ctx.can("tasks.update") && (
                      <button
                        className="font-semibold text-rose-600 dark:text-rose-400 hover:underline"
                        onClick={() => void rebalance(row.user.id)}
                      >
                        {ctx.t("نقل مهمة إلى الأقل انشغالاً", "Move one task to least loaded")}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <div className="space-y-5">
        <Card className="border border-line bg-surface p-5">
          <SectionTitle>{ctx.t("ملخص الأسبوع", "Week summary")}</SectionTitle>
          <div className="space-y-2.5 text-[12px]">
            {[
              [ctx.t("العمل الموزع", "Allocated work"), minutesLabel(workload.totalAllocatedMinutes, ctx.locale)],
              [
                ctx.t("السعة بعد الإجازات", "Capacity after time off"),
                minutesLabel(workload.totalEffectiveCapacityMinutes, ctx.locale),
              ],
              [ctx.t("مهام بلا تاريخ", "Unscheduled tasks"), fmtNumber(workload.unscheduledTaskCount, ctx.locale)],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between rounded-lg bg-raised/40 px-3 py-2.5">
                <span className="text-ink-soft">{label}</span>
                <strong className="text-ink">{value}</strong>
              </div>
            ))}
          </div>
        </Card>
        <Card className="border border-line bg-surface p-5">
          <SectionTitle
            count={settings.timeOff.length}
            action={
              ctx.can("members.manage") ? (
                <Btn size="sm" onClick={() => void addTimeOff()}>
                  {ctx.t("عطلة عامة", "Public holiday")}
                </Btn>
              ) : undefined
            }
          >
            {ctx.t("الإجازات والعطل", "Time off & holidays")}
          </SectionTitle>
          {settings.timeOff.length === 0 ? (
            <p className="text-[12px] text-ink-faint">
              {ctx.t("لا توجد إجازات في هذا الأسبوع", "No time off this week")}
            </p>
          ) : (
            <div className="space-y-2">
              {settings.timeOff.map((entry) => {
                const user = scopedUsers.find((candidate) => candidate.id === entry.userId);
                return (
                  <div key={entry.id} className="rounded-lg border border-line bg-raised/30 p-2.5 text-[11px]">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <strong className="text-ink">
                          {user?.name ?? ctx.t("مساحة العمل", "Workspace")} ·{" "}
                          {ctx.t(kindLabels[entry.kind].ar, kindLabels[entry.kind].en)}
                        </strong>
                        <div className="mt-0.5 text-ink-faint">
                          {entry.startsOn} – {entry.endsOn}
                        </div>
                        {entry.note && <div className="mt-1 text-ink-soft">{entry.note}</div>}
                      </div>
                      {ctx.can("members.manage") && (
                        <button
                          className="text-rose-600 dark:text-rose-400 hover:underline"
                          onClick={() => void removeTimeOff(entry.id)}
                        >
                          {ctx.t("حذف", "Delete")}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
