"use client";

import { useState } from "react";
import type { Timesheet, ViewCtx } from "@/lib/types";
import { fmtDate, fmtMinutes } from "@/lib/types";
import { Avatar, Badge, Btn, Card, Empty } from "@/components/ui";
import { IconClock, IconPlay, IconStop } from "@/components/icons";

function statusLabel(ctx: ViewCtx, status: Timesheet["status"]) {
  if (status === "submitted") return ctx.t("بانتظار المراجعة", "Pending review");
  if (status === "approved") return ctx.t("معتمد ومقفل", "Approved & locked");
  if (status === "rejected") return ctx.t("مرفوض للتعديل", "Returned for changes");
  return ctx.t("مسودة", "Draft");
}

function Status({ ctx, status }: { ctx: ViewCtx; status: Timesheet["status"] }) {
  const classes =
    status === "approved"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300"
      : status === "rejected"
        ? "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300"
        : status === "submitted"
          ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300"
          : "border-slate-200 bg-slate-50 text-slate-600 dark:border-white/10 dark:bg-white/[0.04] dark:text-zinc-300";
  return (
    <span className={`rounded-lg border px-2.5 py-1 text-[11px] font-bold ${classes}`}>{statusLabel(ctx, status)}</span>
  );
}

export function TimeView({ ctx }: { ctx: ViewCtx }) {
  const [activeTab, setActiveTab] = useState<"timer" | "approvals">("timer");
  const s = ctx.timerSeconds;
  const pad = (value: number) => String(value).padStart(2, "0");
  const pendingCount = ctx.timesheetReviewQueue.filter((item) => item.status === "submitted").length;

  return (
    <div className="mx-auto max-w-[920px] space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[19px] font-bold text-slate-900 dark:text-white">
            {ctx.t("تتبع الوقت وجداول الساعات", "Time Tracking & Timesheets")}
          </h2>
          <p className="mt-0.5 text-[12px] text-slate-500 dark:text-zinc-500">
            {ctx.t("تسجيل موثوق، اعتماد القادة، وقفل الفترات", "Trusted entries, manager approval, and period locking")}
          </p>
        </div>
        <div className="flex rounded-xl border border-slate-200 bg-white/80 p-1 dark:border-white/10 dark:bg-white/[0.04]">
          <button
            onClick={() => setActiveTab("timer")}
            className={`rounded-lg px-3 py-1.5 text-[12px] font-semibold transition ${activeTab === "timer" ? "bg-gradient-to-r from-indigo-500 to-violet-500 text-white shadow-sm" : "text-slate-600 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-white"}`}
          >
            {ctx.t("المؤقت والسجلات", "Timer & logs")}
          </button>
          {ctx.can("timesheets.review") && (
            <button
              onClick={() => setActiveTab("approvals")}
              className={`rounded-lg px-3 py-1.5 text-[12px] font-semibold transition ${activeTab === "approvals" ? "bg-gradient-to-r from-indigo-500 to-violet-500 text-white shadow-sm" : "text-slate-600 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-white"}`}
            >
              {ctx.t("الموافقات", "Approvals")}
              {pendingCount > 0 && (
                <span className="ms-1 rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-700 dark:text-amber-300">
                  {pendingCount}
                </span>
              )}
            </button>
          )}
        </div>
      </div>

      {activeTab === "timer" ? (
        <>
          <Card className="relative overflow-hidden bg-white p-8 text-center dark:bg-white/[0.025]" glow>
            <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-indigo-500 to-transparent dark:via-cyan-400" />
            <div className="mono text-[52px] font-bold leading-none tracking-tight text-slate-900 tabular dark:text-white">
              {pad(Math.floor(s / 3600))}:{pad(Math.floor((s % 3600) / 60))}:{pad(s % 60)}
            </div>
            <select
              name="auto-field-350iea9"
              value={ctx.timerTask || ""}
              onChange={(event) => ctx.setTimerTask(event.target.value || null)}
              className="mx-auto mt-5 block w-full max-w-[360px] rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-[13px] text-slate-900 outline-none focus:border-indigo-500 dark:border-white/10 dark:bg-zinc-900 dark:text-white"
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
                  onClick={() => {
                    const minutes = Math.max(1, Math.round(s / 60));
                    ctx.setTimerRunning(false);
                    if (ctx.timerTask) ctx.logTime(ctx.timerTask, minutes, ctx.t("جلسة مؤقت", "Timer session"));
                  }}
                >
                  <IconStop size={15} />
                  {ctx.t("إيقاف وحفظ", "Stop & save")}
                </Btn>
              ) : (
                <Btn
                  variant="glow"
                  size="lg"
                  disabled={!ctx.timerTask || !ctx.can("time_logs.manage")}
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
              { label: ctx.t("الإجمالي", "Total"), value: fmtMinutes(ctx.timeTotals.totalMinutes) },
              { label: ctx.t("قابل للفوترة", "Billable"), value: fmtMinutes(ctx.timeTotals.billableMinutes) },
              { label: ctx.t("السجلات", "Entries"), value: String(ctx.timeLogs.length) },
            ].map((item) => (
              <Card key={item.label} className="bg-white p-4 text-center dark:bg-white/[0.025]">
                <div className="text-[10.5px] font-semibold uppercase tracking-wider text-slate-500 dark:text-zinc-500">
                  {item.label}
                </div>
                <div className="mono mt-1.5 text-[18px] font-bold text-slate-900 tabular dark:text-white">
                  {item.value}
                </div>
              </Card>
            ))}
          </div>

          <Card className="overflow-hidden bg-white dark:bg-white/[0.025]">
            <div className="border-b border-slate-100 px-5 py-3.5 dark:border-white/[0.06]">
              <div className="text-[13.5px] font-semibold text-slate-900 dark:text-white">
                {ctx.t("فترات العمل", "Timesheet periods")}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-zinc-500">
                {ctx.t("أرسل المسودة للمراجعة عند اكتمال الأسبوع", "Submit a draft when the week is complete")}
              </div>
            </div>
            <div className="divide-y divide-slate-100 dark:divide-white/[0.04]">
              {ctx.timesheets.map((timesheet) => (
                <div key={timesheet.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                  <div>
                    <div className="text-[13px] font-bold text-slate-900 dark:text-white">
                      {fmtDate(timesheet.periodStart, ctx.locale)} – {fmtDate(timesheet.periodEnd, ctx.locale)}
                    </div>
                    <div className="mt-1 text-[11px] text-slate-500 dark:text-zinc-500">
                      {fmtMinutes(timesheet.totalMinutes)} • {timesheet.entriesCount} {ctx.t("سجل", "entries")} •{" "}
                      {timesheet.tasksCount} {ctx.t("مهام", "tasks")}
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
                        <Btn size="sm" variant="glow" onClick={() => ctx.submitTimesheet(timesheet)}>
                          {ctx.t("إرسال للمراجعة", "Submit")}
                        </Btn>
                      )}
                  </div>
                </div>
              ))}
              {ctx.timesheets.length === 0 && (
                <Empty
                  icon={<IconClock size={22} />}
                  title={ctx.t("لا توجد فترة بعد", "No timesheet period yet")}
                  hint={ctx.t(
                    "سيُنشأ الأسبوع تلقائيًا عند تسجيل أول وقت",
                    "A week is created with the first time entry",
                  )}
                />
              )}
            </div>
          </Card>

          <Card className="overflow-hidden bg-white dark:bg-white/[0.025]">
            <div className="border-b border-slate-100 px-5 py-3.5 text-[13.5px] font-semibold text-slate-900 dark:border-white/[0.06] dark:text-white">
              {ctx.t("آخر السجلات", "Recent logs")}
            </div>
            <div className="divide-y divide-slate-100 dark:divide-white/[0.04]">
              {ctx.timeLogs.map((log) => (
                <div key={log.id} className="flex items-center justify-between gap-3 px-5 py-3.5">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-600 dark:border-violet-500/20 dark:bg-violet-500/10 dark:text-violet-300">
                      <IconClock size={14} />
                    </span>
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-medium text-slate-800 dark:text-zinc-200">
                        {log.task?.title || "—"}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-zinc-500">
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
                    {fmtMinutes(log.durationMinutes)}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        </>
      ) : (
        <Card className="overflow-hidden bg-white dark:bg-white/[0.025]">
          <div className="border-b border-slate-100 px-5 py-4 dark:border-white/[0.06]">
            <h3 className="text-[14.5px] font-bold text-slate-900 dark:text-white">
              {ctx.t("مراجعة جداول الوقت", "Timesheet review")}
            </h3>
            <p className="text-[11.5px] text-slate-500 dark:text-zinc-500">
              {ctx.t("الاعتماد يقفل الفترة نهائيًا أمام السجلات الجديدة", "Approval permanently locks the period")}
            </p>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-white/[0.04]">
            {ctx.timesheetReviewQueue.map((timesheet) => (
              <div key={timesheet.id} className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
                <div className="flex items-center gap-3">
                  <Avatar name={timesheet.user?.name || timesheet.user?.email || "—"} size={36} />
                  <div>
                    <div className="text-[13.5px] font-bold text-slate-900 dark:text-white">
                      {timesheet.user?.name || timesheet.user?.email || "—"}
                    </div>
                    <div className="text-[11.5px] text-slate-500 dark:text-zinc-500">
                      {fmtDate(timesheet.periodStart, ctx.locale)} – {fmtDate(timesheet.periodEnd, ctx.locale)} •{" "}
                      {timesheet.tasksCount} {ctx.t("مهام", "tasks")}
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
                    <div className="mono text-[14px] font-bold text-slate-900 tabular dark:text-white">
                      {fmtMinutes(timesheet.totalMinutes)}
                    </div>
                    <div className="text-[11px] text-emerald-600 dark:text-emerald-400">
                      {fmtMinutes(timesheet.billableMinutes)} {ctx.t("للفوترة", "billable")}
                    </div>
                  </div>
                  {timesheet.status === "submitted" ? (
                    <div className="flex gap-2">
                      <Btn
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          const reason = prompt(ctx.t("سبب الرفض مطلوب", "Rejection reason is required"));
                          if (reason?.trim()) ctx.reviewTimesheet(timesheet, "rejected", reason.trim());
                        }}
                      >
                        {ctx.t("رفض", "Reject")}
                      </Btn>
                      <Btn size="sm" variant="glow" onClick={() => ctx.reviewTimesheet(timesheet, "approved")}>
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
              <Empty
                icon={<IconClock size={22} />}
                title={ctx.t("لا توجد جداول للمراجعة", "No timesheets to review")}
                hint={ctx.t("ستظهر هنا الجداول التي يرسلها أعضاء الفريق", "Submitted team timesheets appear here")}
              />
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
