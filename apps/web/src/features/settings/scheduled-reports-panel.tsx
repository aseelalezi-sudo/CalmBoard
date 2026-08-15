"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge, Btn, Card, inputCls, ScreenState, selectCls } from "@/components/ui";
import { IconRotateCw } from "@/components/icons";
import type { ViewCtx } from "@/lib/types";
import { fmtNumber } from "@/lib/types";
import {
  createReportSchedule,
  deleteReportSchedule,
  listReportSchedules,
  reportScheduleTime,
  updateReportSchedule,
  type ReportSchedule,
  type ReportScheduleInput,
} from "@/features/workspace/report-schedules-api";

function scheduleInput(schedule: ReportSchedule): ReportScheduleInput {
  return {
    name: schedule.name,
    format: schedule.format,
    cadence: schedule.cadence,
    timezone: schedule.timezone,
    time: reportScheduleTime(schedule),
    dayOfWeek: schedule.dayOfWeek,
    dayOfMonth: schedule.dayOfMonth,
    recipientIds: schedule.recipientIds,
    isEnabled: schedule.isEnabled,
  };
}

function cadenceLabel(ctx: ViewCtx, cadence: ReportSchedule["cadence"]) {
  switch (cadence) {
    case "daily":
      return ctx.t("يومي", "Daily");
    case "weekly":
      return ctx.t("أسبوعي", "Weekly");
    case "monthly":
      return ctx.t("شهري", "Monthly");
    default:
      return cadence;
  }
}

const weekdays: [string, string][] = [
  ["الأحد", "Sunday"],
  ["الإثنين", "Monday"],
  ["الثلاثاء", "Tuesday"],
  ["الأربعاء", "Wednesday"],
  ["الخميس", "Thursday"],
  ["الجمعة", "Friday"],
  ["السبت", "Saturday"],
];

export function ScheduledReportsPanel({ ctx }: { ctx: ViewCtx }) {
  const [schedules, setSchedules] = useState<ReportSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [format, setFormat] = useState<"pdf" | "xlsx">("pdf");
  const [cadence, setCadence] = useState<"daily" | "weekly" | "monthly">("weekly");
  const [time, setTime] = useState("08:00");
  const [timezone, setTimezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  const [dayOfWeek, setDayOfWeek] = useState(1);
  const [dayOfMonth, setDayOfMonth] = useState(1);
  const [recipientIds, setRecipientIds] = useState<string[]>(() => (ctx.currentUser ? [ctx.currentUser.id] : []));

  const scope = useMemo(
    () =>
      ctx.activeWorkspace
        ? { organizationId: ctx.activeWorkspace.organizationId, workspaceId: ctx.activeWorkspace.id }
        : null,
    [ctx.activeWorkspace],
  );

  useEffect(() => {
    let current = true;
    if (!scope || !ctx.can("data.export")) {
      setSchedules([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    void listReportSchedules(scope)
      .then((items) => {
        if (current) setSchedules(items);
      })
      .catch((error: unknown) => {
        if (current) {
          const message =
            error instanceof Error
              ? error.message
              : ctx.t("تعذر تحميل التقارير المجدولة", "Could not load report schedules");
          setLoadError(message);
          ctx.notify(message, "error");
        }
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [scope, reloadKey, ctx]);

  if (!ctx.can("data.export")) {
    return (
      <section className="mt-7 border-t border-line pt-6">
        <ScreenState
          tone="permission"
          title={ctx.t("غير مصرح بالوصول إلى التقارير المجدولة", "Permission required")}
          description={ctx.t(
            "تحتاج إلى صلاحية تصدير البيانات (data.export) لإدارة وجدولة التقارير.",
            "You need data export permissions to manage scheduled reports.",
          )}
        />
      </section>
    );
  }

  const create = async () => {
    if (!scope || !name.trim() || !recipientIds.length || saving) return;
    setSaving(true);
    try {
      const created = await createReportSchedule(scope, {
        name: name.trim(),
        format,
        cadence,
        timezone,
        time,
        dayOfWeek: cadence === "weekly" ? dayOfWeek : null,
        dayOfMonth: cadence === "monthly" ? dayOfMonth : null,
        recipientIds,
        isEnabled: true,
      });
      setSchedules((current) => [...current, created].sort((left, right) => left.name.localeCompare(right.name)));
      setName("");
      ctx.notify(ctx.t("تم إنشاء التقرير المجدول", "Scheduled report created"));
    } catch (error) {
      ctx.notify(
        error instanceof Error ? error.message : ctx.t("تعذر إنشاء جدول التقرير", "Could not create report schedule"),
        "error",
      );
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (schedule: ReportSchedule) => {
    if (!scope || saving) return;
    setSaving(true);
    try {
      const updated = await updateReportSchedule(scope, schedule, {
        ...scheduleInput(schedule),
        isEnabled: !schedule.isEnabled,
      });
      setSchedules((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    } catch (error) {
      ctx.notify(
        error instanceof Error ? error.message : ctx.t("تعذر تحديث جدول التقرير", "Could not update report schedule"),
        "error",
      );
    } finally {
      setSaving(false);
    }
  };

  const remove = async (scheduleId: string) => {
    if (!scope || saving) return;
    setSaving(true);
    try {
      await deleteReportSchedule(scope, scheduleId);
      setSchedules((current) => current.filter((schedule) => schedule.id !== scheduleId));
      ctx.notify(ctx.t("تم حذف الجدول", "Schedule deleted"));
    } catch (error) {
      ctx.notify(
        error instanceof Error ? error.message : ctx.t("تعذر حذف جدول التقرير", "Could not delete report schedule"),
        "error",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="mt-7 border-t border-line pt-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-bold text-ink">{ctx.t("التقارير المجدولة", "Scheduled reports")}</h3>
          <p className="mt-1 text-[12px] text-ink-soft">
            {ctx.t(
              "أنشئ تقرير PDF أو Excel دوريًا وأرسله إلى بريد أعضاء مساحة العمل.",
              "Generate recurring PDF or Excel reports and email them to workspace members.",
            )}
          </p>
        </div>
        <Badge tone="indigo">Worker + Email Outbox</Badge>
      </div>

      <div className="mt-5 grid gap-3 rounded-2xl border border-accent/20 bg-accent/5 p-4 md:grid-cols-2">
        <label className="block md:col-span-2">
          <span className="mb-1 block text-[11px] font-bold text-accent">{ctx.t("اسم التقرير", "Report name")}</span>
          <input
            name="scheduled-report-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            className={inputCls}
            maxLength={120}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-bold text-accent">{ctx.t("الصيغة", "Format")}</span>
          <select
            name="scheduled-report-format"
            value={format}
            onChange={(event) => setFormat(event.target.value as "pdf" | "xlsx")}
            className={selectCls}
          >
            <option value="pdf">PDF</option>
            <option value="xlsx">Excel (XLSX)</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-bold text-accent">{ctx.t("التكرار", "Cadence")}</span>
          <select
            name="scheduled-report-cadence"
            value={cadence}
            onChange={(event) => setCadence(event.target.value as typeof cadence)}
            className={selectCls}
          >
            <option value="daily">{ctx.t("يومي", "Daily")}</option>
            <option value="weekly">{ctx.t("أسبوعي", "Weekly")}</option>
            <option value="monthly">{ctx.t("شهري", "Monthly")}</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-bold text-accent">{ctx.t("الوقت", "Time")}</span>
          <input
            name="scheduled-report-time"
            type="time"
            value={time}
            onChange={(event) => setTime(event.target.value)}
            className={inputCls}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-bold text-accent">{ctx.t("المنطقة الزمنية", "Time zone")}</span>
          <input
            name="scheduled-report-timezone"
            value={timezone}
            onChange={(event) => setTimezone(event.target.value)}
            className={inputCls}
            maxLength={100}
          />
        </label>
        {cadence === "weekly" && (
          <label className="block">
            <span className="mb-1 block text-[11px] font-bold text-accent">{ctx.t("يوم الأسبوع", "Weekday")}</span>
            <select
              name="scheduled-report-weekday"
              value={dayOfWeek}
              onChange={(event) => setDayOfWeek(Number(event.target.value))}
              className={selectCls}
            >
              {weekdays.map((label, index) => (
                <option key={label[1]} value={index}>
                  {ctx.t(...label)}
                </option>
              ))}
            </select>
          </label>
        )}
        {cadence === "monthly" && (
          <label className="block">
            <span className="mb-1 block text-[11px] font-bold text-accent">{ctx.t("يوم الشهر", "Day of month")}</span>
            <input
              name="scheduled-report-day-of-month"
              type="number"
              min={1}
              max={28}
              value={dayOfMonth}
              onChange={(event) => setDayOfMonth(Number(event.target.value))}
              className={inputCls}
            />
          </label>
        )}
        <label className="block md:col-span-2">
          <span className="mb-1 block text-[11px] font-bold text-accent">{ctx.t("المستلمون", "Recipients")}</span>
          <select
            name="scheduled-report-recipients"
            multiple
            value={recipientIds}
            onChange={(event) => setRecipientIds(Array.from(event.target.selectedOptions, (option) => option.value))}
            className={`${selectCls} min-h-28`}
          >
            {ctx.members
              .filter((member) => member.status === "active")
              .map((member) => (
                <option key={member.userId} value={member.userId}>
                  {member.user?.name || member.user?.email || member.userId}
                </option>
              ))}
          </select>
        </label>
        <div className="flex justify-end md:col-span-2">
          <Btn
            variant="glow"
            disabled={Boolean(loading || loadError || saving || !scope || !name.trim() || !recipientIds.length)}
            onClick={() => void create()}
          >
            {saving ? ctx.t("جارٍ الحفظ…", "Saving…") : ctx.t("إنشاء الجدول", "Create schedule")}
          </Btn>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        {loading ? (
          <ScreenState
            framed={false}
            tone="loading"
            title={ctx.t("جارٍ تحميل الجداول…", "Loading schedules…")}
            description={ctx.t("يرجى الانتظار بينما نجلب قائمة التقارير المجدولة.", "Fetching scheduled reports.")}
          />
        ) : loadError ? (
          <ScreenState
            framed={false}
            tone="error"
            title={ctx.t("تعذر تحميل التقارير المجدولة", "Failed to load scheduled reports")}
            description={loadError}
            action={
              <Btn variant="outline" size="sm" onClick={() => setReloadKey((value) => value + 1)}>
                <IconRotateCw size={14} />
                {ctx.t("إعادة المحاولة", "Retry")}
              </Btn>
            }
          />
        ) : !schedules.length ? (
          <ScreenState
            framed={false}
            tone="empty"
            title={ctx.t("لا توجد تقارير مجدولة بعد", "No scheduled reports yet")}
            description={ctx.t(
              "أنشئ جدولاً جديداً لإرسال تقارير دورية عبر البريد الإلكتروني.",
              "Create a schedule above to automatically receive reports.",
            )}
          />
        ) : (
          schedules.map((schedule) => (
            <div
              key={schedule.id}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface p-4"
            >
              <div className="min-w-[220px] flex-1">
                <div className="flex items-center gap-2">
                  <strong className="text-[13px] text-ink">{schedule.name}</strong>
                  <Badge tone={schedule.isEnabled ? "emerald" : "neutral"}>
                    {schedule.isEnabled ? ctx.t("نشط", "Active") : ctx.t("متوقف", "Paused")}
                  </Badge>
                </div>
                <p className="mt-1 text-[11px] text-ink-soft">
                  {schedule.format.toUpperCase()} · {cadenceLabel(ctx, schedule.cadence)} ·{" "}
                  {reportScheduleTime(schedule)} {schedule.timezone} ·{" "}
                  {fmtNumber(schedule.recipientIds.length, ctx.locale)} {ctx.t("مستلم", "recipients")}
                </p>
                <p className="mt-1 text-[10.5px] text-ink-faint">
                  {ctx.t("التشغيل التالي:", "Next run:")} {new Date(schedule.nextRunAt).toLocaleString(ctx.locale)}
                </p>
              </div>
              <Btn variant="outline" disabled={saving} onClick={() => void toggle(schedule)}>
                {schedule.isEnabled ? ctx.t("إيقاف", "Pause") : ctx.t("تشغيل", "Resume")}
              </Btn>
              <Btn variant="danger" disabled={saving} onClick={() => void remove(schedule.id)}>
                {ctx.t("حذف", "Delete")}
              </Btn>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
