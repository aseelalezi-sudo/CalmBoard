"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge, Btn, inputCls, selectCls } from "@/components/ui";
import type { ViewCtx } from "@/lib/types";
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

export function ScheduledReportsPanel({ ctx }: { ctx: ViewCtx }) {
  const [schedules, setSchedules] = useState<ReportSchedule[]>([]);
  const [loading, setLoading] = useState(true);
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
    void listReportSchedules(scope)
      .then((items) => {
        if (current) setSchedules(items);
      })
      .catch((error: unknown) => {
        if (current) ctx.notify(error instanceof Error ? error.message : "Could not load report schedules", "error");
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [scope, ctx]);

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
      ctx.notify(error instanceof Error ? error.message : "Could not create report schedule", "error");
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
      ctx.notify(error instanceof Error ? error.message : "Could not update report schedule", "error");
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
      ctx.notify(error instanceof Error ? error.message : "Could not delete report schedule", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="mt-7 border-t border-slate-200 pt-6 dark:border-white/10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-bold text-slate-900 dark:text-white">
            {ctx.t("التقارير المجدولة", "Scheduled reports")}
          </h3>
          <p className="mt-1 text-[12px] text-slate-500 dark:text-zinc-400">
            {ctx.t(
              "أنشئ تقرير PDF أو Excel دوريًا وأرسله إلى بريد أعضاء مساحة العمل.",
              "Generate recurring PDF or Excel reports and email them to workspace members.",
            )}
          </p>
        </div>
        <Badge tone="indigo">Worker + Email Outbox</Badge>
      </div>

      <div className="mt-5 grid gap-3 rounded-2xl border border-indigo-200 bg-indigo-50/60 p-4 dark:border-indigo-500/20 dark:bg-indigo-500/[0.06] md:grid-cols-2">
        <label className="block md:col-span-2">
          <span className="mb-1 block text-[11px] font-bold text-indigo-700 dark:text-indigo-300">
            {ctx.t("اسم التقرير", "Report name")}
          </span>
          <input
            name="auto-field-m8hylrx"
            value={name}
            onChange={(event) => setName(event.target.value)}
            className={inputCls}
            maxLength={120}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-bold text-indigo-700 dark:text-indigo-300">
            {ctx.t("الصيغة", "Format")}
          </span>
          <select
            name="auto-field-gpgpaxt"
            value={format}
            onChange={(event) => setFormat(event.target.value as "pdf" | "xlsx")}
            className={selectCls}
          >
            <option value="pdf">PDF</option>
            <option value="xlsx">Excel (XLSX)</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-bold text-indigo-700 dark:text-indigo-300">
            {ctx.t("التكرار", "Cadence")}
          </span>
          <select
            name="auto-field-0bh7r9s"
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
          <span className="mb-1 block text-[11px] font-bold text-indigo-700 dark:text-indigo-300">
            {ctx.t("الوقت", "Time")}
          </span>
          <input
            name="auto-field-ki1h7jh"
            type="time"
            value={time}
            onChange={(event) => setTime(event.target.value)}
            className={inputCls}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-bold text-indigo-700 dark:text-indigo-300">
            {ctx.t("المنطقة الزمنية", "Time zone")}
          </span>
          <input
            name="auto-field-ynimfbq"
            value={timezone}
            onChange={(event) => setTimezone(event.target.value)}
            className={inputCls}
            maxLength={100}
          />
        </label>
        {cadence === "weekly" && (
          <label className="block">
            <span className="mb-1 block text-[11px] font-bold text-indigo-700 dark:text-indigo-300">
              {ctx.t("يوم الأسبوع", "Weekday")}
            </span>
            <select
              name="auto-field-agzb9yc"
              value={dayOfWeek}
              onChange={(event) => setDayOfWeek(Number(event.target.value))}
              className={selectCls}
            >
              {["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((label, index) => (
                <option key={label} value={index}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        )}
        {cadence === "monthly" && (
          <label className="block">
            <span className="mb-1 block text-[11px] font-bold text-indigo-700 dark:text-indigo-300">
              {ctx.t("يوم الشهر", "Day of month")}
            </span>
            <input
              name="auto-field-wyoa2qk"
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
          <span className="mb-1 block text-[11px] font-bold text-indigo-700 dark:text-indigo-300">
            {ctx.t("المستلمون", "Recipients")}
          </span>
          <select
            name="auto-field-yy1xekw"
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
            disabled={saving || !name.trim() || !recipientIds.length || !ctx.can("data.export")}
            onClick={() => void create()}
          >
            {saving ? ctx.t("جارٍ الحفظ…", "Saving…") : ctx.t("إنشاء الجدول", "Create schedule")}
          </Btn>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        {loading && <p className="text-[12px] text-slate-500">{ctx.t("جارٍ تحميل الجداول…", "Loading schedules…")}</p>}
        {!loading && !schedules.length && (
          <p className="rounded-xl border border-dashed border-slate-300 p-5 text-center text-[12px] text-slate-500 dark:border-white/15">
            {ctx.t("لا توجد تقارير مجدولة بعد.", "No scheduled reports yet.")}
          </p>
        )}
        {schedules.map((schedule) => (
          <div
            key={schedule.id}
            className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-white/[0.025]"
          >
            <div className="min-w-[220px] flex-1">
              <div className="flex items-center gap-2">
                <strong className="text-[13px] text-slate-900 dark:text-white">{schedule.name}</strong>
                <Badge tone={schedule.isEnabled ? "emerald" : "neutral"}>
                  {schedule.isEnabled ? ctx.t("نشط", "Active") : ctx.t("متوقف", "Paused")}
                </Badge>
              </div>
              <p className="mt-1 text-[11px] text-slate-500 dark:text-zinc-400">
                {schedule.format.toUpperCase()} · {schedule.cadence} · {reportScheduleTime(schedule)}{" "}
                {schedule.timezone} · {schedule.recipientIds.length} {ctx.t("مستلم", "recipients")}
              </p>
              <p className="mt-1 text-[10.5px] text-slate-400">
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
        ))}
      </div>
    </section>
  );
}
