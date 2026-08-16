"use client";

import { useState } from "react";
import type { Timesheet, ViewCtx } from "@/lib/types";
import { fmtDate, fmtMinutes, fmtNumber } from "@/lib/types";
import { Avatar, Badge, Btn, Card, ScreenHeader, ScreenState, SegmentedTabs } from "@/components/ui";
import { IconClock, IconPlay, IconStop } from "@/components/icons";
import { promptAction } from "@/components/feedback";

function statusLabel(ctx: ViewCtx, status: Timesheet["status"]) {
  if (status === "submitted") return ctx.t("بانتظار المراجعة", "Pending review");
  if (status === "approved") return ctx.t("معتمد ومقفل", "Approved & locked");
  if (status === "rejected") return ctx.t("مرفوض للتعديل", "Returned for changes");
  return ctx.t("مسودة", "Draft");
}

function Status({ ctx, status }: { ctx: ViewCtx; status: Timesheet["status"] }) {
  const classes =
    status === "approved"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
      : status === "rejected"
        ? "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300"
        : status === "submitted"
          ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
          : "border-line bg-raised text-ink-soft";
  return (
    <span className={`rounded-lg border px-2.5 py-1 text-[11px] font-bold ${classes}`}>{statusLabel(ctx, status)}</span>
  );
}

export function TimeView({ ctx }: { ctx: ViewCtx }) {
  const [activeTab, setActiveTab] = useState<"timer" | "approvals">("timer");
  const [savingTimer, setSavingTimer] = useState(false);
  const [pendingTimesheetId, setPendingTimesheetId] = useState<string | null>(null);
  const [pendingTimesheetAction, setPendingTimesheetAction] = useState<string | null>(null);

  const canManageTime = ctx.can("time_logs.manage");
  const canReviewTimesheets = ctx.can("timesheets.review");
  const activeSection = canManageTime ? activeTab : canReviewTimesheets ? "approvals" : "none";

  if (!canManageTime && !canReviewTimesheets) {
    return (
      <div className="screen-container-standard">
        <ScreenState
          tone="permission"
          title={ctx.t("غير مصرح", "Permission denied")}
          description={ctx.t(
            "لا تملك صلاحية الوصول لتتبع الوقت أو مراجعة الجداول.",
            "You do not have permission to access time tracking or review timesheets.",
          )}
        />
      </div>
    );
  }

  const s = ctx.timerSeconds;
  const pad = (value: number) => fmtNumber(value, ctx.locale, { minimumIntegerDigits: 2, useGrouping: false });
  const pendingCount = ctx.timesheetReviewQueue.filter((item) => item.status === "submitted").length;

  const tabItems = [
    ...(canManageTime ? [{ value: "timer", label: ctx.t("المؤقت والسجلات", "Timer & logs") }] : []),
    ...(canReviewTimesheets
      ? [
          {
            value: "approvals",
            label:
              pendingCount > 0
                ? `${ctx.t("الموافقات", "Approvals")} (${fmtNumber(pendingCount, ctx.locale)})`
                : ctx.t("الموافقات", "Approvals"),
          },
        ]
      : []),
  ];

  return (
    <div className="screen-container-standard space-y-5">
      <ScreenHeader
        title={ctx.t("تتبع الوقت وجداول الساعات", "Time Tracking & Timesheets")}
        description={ctx.t(
          "تسجيل موثوق، اعتماد القادة، وقفل الفترات",
          "Trusted entries, manager approval, and period locking",
        )}
        actions={
          tabItems.length > 1 ? (
            <SegmentedTabs
              label={ctx.t("أقسام تتبع الوقت", "Time tracking sections")}
              items={tabItems}
              value={activeSection}
              onChange={(value) => setActiveTab(value as "timer" | "approvals")}
            />
          ) : undefined
        }
      />

      {activeSection === "timer" ? (
        <>
          <Card className="relative overflow-hidden bg-surface p-8 text-center" glow>
            <div className="absolute inset-x-0 top-0 h-0.5 bg-linear-to-r from-transparent via-indigo-500 to-transparent dark:via-cyan-400" />
            <div className="mono text-[52px] font-bold leading-none tracking-tight text-ink tabular">
              {pad(Math.floor(s / 3600))}:{pad(Math.floor((s % 3600) / 60))}:{pad(s % 60)}
            </div>
            {ctx.timerRunning && (
              <p className="mt-2 text-[12px] font-medium text-amber-600 dark:text-amber-400">
                {ctx.t("ما زال المؤقت يعمل", "Timer is currently running")}
              </p>
            )}
            <select
              name="auto-field-350iea9"
              value={ctx.timerTask || ""}
              disabled={ctx.timerRunning || savingTimer}
              onChange={(event) => ctx.setTimerTask(event.target.value || null)}
              className="mx-auto mt-5 block h-10 w-full max-w-[360px] cursor-pointer rounded-xl border border-line bg-surface px-3 text-[13px] text-ink shadow-xs outline-none transition focus:border-accent disabled:cursor-not-allowed disabled:opacity-60"
            >
              <option value="">{ctx.t("اختر مهمة لتتبع الوقت", "Select a task to track")}</option>
              {ctx.tasks.map((task) => (
                <option key={task.id} value={task.id}>
                  {task.serial} — {task.title.slice(0, 42)}
                </option>
              ))}
            </select>
            <div className="mt-5 flex justify-center">
              {ctx.timerRunning ? (
                <Btn
                  variant="danger"
                  size="lg"
                  aria-busy={savingTimer}
                  disabled={savingTimer}
                  onClick={() => {
                    const minutes = Math.max(1, Math.round(s / 60));
                    setSavingTimer(true);
                    Promise.resolve(ctx.logTime(ctx.timerTask!, minutes, ctx.t("جلسة مؤقت", "Timer session")))
                      .then(() => ctx.setTimerRunning(false))
                      .finally(() => setSavingTimer(false));
                  }}
                >
                  <IconStop size={15} />
                  {ctx.t("إيقاف وحفظ", "Stop & save")}
                </Btn>
              ) : (
                <Btn
                  variant="glow"
                  size="lg"
                  disabled={!ctx.timerTask || !canManageTime}
                  onClick={() => ctx.setTimerRunning(true)}
                >
                  <IconPlay size={15} />
                  {ctx.t("بدء المؤقت", "Start timer")}
                </Btn>
              )}
            </div>
          </Card>

          <div className="grid grid-cols-3 gap-4">
            {[
              { label: ctx.t("الإجمالي", "Total"), value: fmtMinutes(ctx.timeTotals.totalMinutes, ctx.locale) },
              {
                label: ctx.t("قابل للفوترة", "Billable"),
                value: fmtMinutes(ctx.timeTotals.billableMinutes, ctx.locale),
              },
              { label: ctx.t("السجلات", "Entries"), value: fmtNumber(ctx.timeLogs.length, ctx.locale) },
            ].map((item) => (
              <Card key={item.label} className="bg-surface p-4 text-center">
                <div className="text-[10.5px] font-semibold uppercase tracking-wider text-ink-faint">{item.label}</div>
                <div className="mono mt-1.5 text-[18px] font-bold text-ink tabular">{item.value}</div>
              </Card>
            ))}
          </div>

          <Card className="overflow-hidden bg-surface">
            <div className="border-b border-line px-5 py-3.5">
              <div className="text-[13.5px] font-semibold text-ink">{ctx.t("فترات العمل", "Timesheet periods")}</div>
              <div className="text-[11px] text-ink-faint">
                {ctx.t("أرسل المسودة للمراجعة عند اكتمال الأسبوع", "Submit a draft when the week is complete")}
              </div>
            </div>
            <div className="divide-y divide-line">
              {ctx.timesheets.map((timesheet) => (
                <div key={timesheet.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                  <div>
                    <div className="text-[13px] font-bold text-ink">
                      {fmtDate(timesheet.periodStart, ctx.locale)} – {fmtDate(timesheet.periodEnd, ctx.locale)}
                    </div>
                    <div className="mt-1 text-[11px] text-ink-faint">
                      {fmtMinutes(timesheet.totalMinutes, ctx.locale)} • {fmtNumber(timesheet.entriesCount, ctx.locale)}{" "}
                      {ctx.t("سجل", "entries")} • {fmtNumber(timesheet.tasksCount, ctx.locale)} {ctx.t("مهام", "tasks")}
                    </div>
                    {timesheet.rejectionReason && (
                      <div className="mt-1 text-[11px] text-rose-600 dark:text-rose-300">
                        {timesheet.rejectionReason}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Status ctx={ctx} status={timesheet.status} />
                    {(timesheet.status === "draft" || timesheet.status === "rejected") &&
                      timesheet.entriesCount > 0 && (
                        <Btn
                          size="sm"
                          variant="glow"
                          disabled={pendingTimesheetId === timesheet.id}
                          onClick={async () => {
                            setPendingTimesheetId(timesheet.id);
                            try {
                              await ctx.submitTimesheet(timesheet);
                            } finally {
                              setPendingTimesheetId(null);
                            }
                          }}
                        >
                          {ctx.t("إرسال للمراجعة", "Submit")}
                        </Btn>
                      )}
                  </div>
                </div>
              ))}
              {ctx.timesheets.length === 0 && (
                <div className="p-8 text-center">
                  <ScreenState
                    framed={false}
                    tone="empty"
                    title={ctx.t("لا توجد فترات عمل بعد", "No timesheet periods yet")}
                    description={ctx.t(
                      "سيُنشأ الأسبوع تلقائيًا عند تسجيل أول وقت",
                      "A week is created with the first time entry",
                    )}
                  />
                </div>
              )}
            </div>
          </Card>

          <Card className="overflow-hidden bg-surface">
            <div className="border-b border-line px-5 py-3.5 text-[13.5px] font-semibold text-ink">
              {ctx.t("آخر السجلات", "Recent logs")}
            </div>
            <div className="divide-y divide-line">
              {ctx.timeLogs.map((log) => (
                <div key={log.id} className="flex items-center justify-between gap-3 px-5 py-3.5">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-600 dark:border-violet-500/20 dark:bg-violet-500/10 dark:text-violet-300">
                      <IconClock size={14} />
                    </span>
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-medium text-ink">{log.task?.title || "—"}</div>
                      <div className="text-[11px] text-ink-faint">
                        <span className="mono">{log.task?.serial}</span> • {fmtDate(log.startedAt, ctx.locale)}
                        {log.billable && (
                          <Badge tone="emerald" className="ms-1">
                            {ctx.t("فوترة", "Billable")}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                  <span className="mono shrink-0 text-[13.5px] font-bold text-indigo-600 tabular dark:text-violet-300">
                    {fmtMinutes(log.durationMinutes, ctx.locale)}
                  </span>
                </div>
              ))}
              {ctx.timeLogs.length === 0 && (
                <div className="p-8 text-center">
                  <ScreenState
                    framed={false}
                    tone="empty"
                    title={ctx.t("لا توجد سجلات وقت", "No time logs")}
                    description={ctx.t("ابدأ بتشغيل المؤقت لتسجيل ساعات العمل", "Start the timer to log working hours")}
                  />
                </div>
              )}
            </div>
          </Card>
        </>
      ) : (
        <Card className="overflow-hidden bg-surface">
          <div className="border-b border-line px-5 py-4">
            <h3 className="text-[14.5px] font-bold text-ink">{ctx.t("مراجعة جداول الوقت", "Timesheet review")}</h3>
            <p className="text-[11.5px] text-ink-faint">
              {ctx.t("الاعتماد يقفل الفترة نهائيًا أمام السجلات الجديدة", "Approval permanently locks the period")}
            </p>
          </div>
          <div className="divide-y divide-line">
            {ctx.timesheetReviewQueue.map((timesheet) => (
              <div key={timesheet.id} className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
                <div className="flex items-center gap-3">
                  <Avatar name={timesheet.user?.name || timesheet.user?.email || "—"} size={36} />
                  <div>
                    <div className="text-[13.5px] font-bold text-ink">
                      {timesheet.user?.name || timesheet.user?.email || "—"}
                    </div>
                    <div className="text-[11.5px] text-ink-faint">
                      {fmtDate(timesheet.periodStart, ctx.locale)} – {fmtDate(timesheet.periodEnd, ctx.locale)} •{" "}
                      {fmtNumber(timesheet.tasksCount, ctx.locale)} {ctx.t("مهام", "tasks")}
                    </div>
                    {timesheet.rejectionReason && (
                      <div className="mt-1 text-[11px] text-rose-600 dark:text-rose-300">
                        {timesheet.rejectionReason}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-end">
                    <div className="mono text-[14px] font-bold text-ink tabular">
                      {fmtMinutes(timesheet.totalMinutes, ctx.locale)}
                    </div>
                    <div className="text-[11px] text-emerald-600 dark:text-emerald-400">
                      {fmtMinutes(timesheet.billableMinutes, ctx.locale)} {ctx.t("للفوترة", "billable")}
                    </div>
                  </div>
                  {timesheet.status === "submitted" ? (
                    <div className="flex gap-2">
                      <Btn
                        size="sm"
                        variant="outline"
                        disabled={pendingTimesheetId === timesheet.id}
                        onClick={async () => {
                          const reason = await promptAction({
                            title: ctx.t("رفض جدول الوقت", "Reject Timesheet"),
                            label: ctx.t("سبب الرفض مطلوب", "Rejection reason is required"),
                            required: true,
                          });
                          if (!reason?.trim()) return;
                          setPendingTimesheetId(timesheet.id);
                          setPendingTimesheetAction("reject");
                          try {
                            await ctx.reviewTimesheet(timesheet, "rejected", reason.trim());
                          } finally {
                            setPendingTimesheetId(null);
                            setPendingTimesheetAction(null);
                          }
                        }}
                      >
                        {ctx.t("رفض", "Reject")}
                      </Btn>
                      <Btn
                        size="sm"
                        variant="glow"
                        disabled={pendingTimesheetId === timesheet.id}
                        onClick={async () => {
                          setPendingTimesheetId(timesheet.id);
                          setPendingTimesheetAction("approve");
                          try {
                            await ctx.reviewTimesheet(timesheet, "approved");
                          } finally {
                            setPendingTimesheetId(null);
                            setPendingTimesheetAction(null);
                          }
                        }}
                      >
                        {ctx.t("اعتماد وقفل", "Approve & lock")}
                      </Btn>
                    </div>
                  ) : (
                    <Status ctx={ctx} status={timesheet.status} />
                  )}
                </div>
              </div>
            ))}
            {ctx.timesheetReviewQueue.length === 0 && (
              <div className="p-8 text-center">
                <ScreenState
                  framed={false}
                  tone="empty"
                  title={ctx.t("لا توجد جداول للمراجعة", "No timesheets to review")}
                  description={ctx.t(
                    "ستظهر هنا الجداول التي يرسلها أعضاء الفريق",
                    "Submitted team timesheets appear here",
                  )}
                />
              </div>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
