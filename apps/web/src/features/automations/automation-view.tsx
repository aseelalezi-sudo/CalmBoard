"use client";

import { useState } from "react";
import type { AutomationRun, ViewCtx } from "@/lib/types";
import { fmtNumber } from "@/lib/types";
import { Badge, Btn, Card, ScreenHeader, ScreenState, SectionTitle, Toggle } from "@/components/ui";
import { IconBolt, IconClock, IconPlus } from "@/components/icons";

const dateLocale = (locale: string) => (locale === "ar" ? "ar-EG" : "en-US");

function runStatus(status: string, t: ViewCtx["t"]) {
  switch (status) {
    case "success":
      return t("ناجح", "Success");
    case "failed":
      return t("فشل", "Failed");
    case "skipped":
      return t("تم التخطي", "Skipped");
    default:
      return status;
  }
}

function runMessage(run: AutomationRun, t: ViewCtx["t"]) {
  if (run.status === "failed") {
    return t("تعذر تنفيذ بعض أو كل إجراءات الأتمتة", "Failed to execute some or all automation actions");
  }
  if (run.message?.includes("Conditions did not match")) {
    return t("الشروط لم تتطابق مع الحدث", "Conditions did not match the event");
  }
  if (run.message?.includes("Rule is disabled or no longer matches the event")) {
    return t("القاعدة معطلة أو لم تعد مطابقة للحدث", "Rule is disabled or no longer matches the event");
  }
  const match = run.message?.match(/^Executed (\d+) actions$/);
  if (match) {
    return t(`تم تنفيذ ${match[1]} إجراءات بنجاح`, `Executed ${match[1]} actions successfully`);
  }
  return run.status === "success"
    ? t("تم تنفيذ الأتمتة بنجاح", "Automation executed successfully")
    : t("تم تخطي الأتمتة", "Automation skipped");
}

export function AutomationView({ ctx }: { ctx: ViewCtx }) {
  const [pendingAutomationId, setPendingAutomationId] = useState<string | null>(null);
  const canManageAutomations = ctx.can("automations.manage");

  return (
    <div className="screen-container-standard space-y-6">
      <ScreenHeader
        title={ctx.t("محرك الأتمتة (When → If → Then — القسم 14)", "Automation Engine")}
        description={ctx.t(
          "أتمتة سير العمل بذكاء مع سياسات إعادة المحاولة وإدارة القواعد الفعالة.",
          "Automate workflows intelligently with robust triggers, conditions, and actions.",
        )}
        actions={
          canManageAutomations ? (
            <Btn variant="glow" onClick={() => ctx.setShowNewAutomation(true)}>
              <IconPlus size={15} />
              {ctx.t("قاعدة جديدة", "New rule")}
            </Btn>
          ) : undefined
        }
      />

      <div className="space-y-3.5">
        {ctx.automations.map((a) => (
          <Card key={a.id} className={`bg-surface p-5 transition ${a.enabled ? "" : "opacity-60"}`}>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex min-w-60 flex-1 items-center gap-3.5">
                <span
                  className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl border ${
                    a.enabled
                      ? "border-indigo-500/20 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 shadow-sm"
                      : "border-line bg-raised text-ink-faint"
                  }`}
                >
                  <IconBolt size={18} />
                </span>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[14.5px] font-bold text-ink">{a.name}</span>
                    <Badge tone={a.enabled ? "emerald" : "neutral"}>
                      {a.enabled ? ctx.t("نشطة", "Active") : ctx.t("معطلة", "Disabled")}
                    </Badge>
                  </div>
                  <div className="mt-0.5 text-[11.5px] text-ink-faint">
                    <span className="mono font-bold tabular">{fmtNumber(a.runs, ctx.locale)}</span>{" "}
                    {ctx.t("تشغيل ناجح", "successful runs")} •{" "}
                    {a.lastRunAt
                      ? `${ctx.t("آخر تشغيل:", "Last run:")} ${new Date(a.lastRunAt).toLocaleTimeString(dateLocale(ctx.locale))}`
                      : ctx.t("لم تُشغل بعد", "Never run")}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3 shrink-0">
                {canManageAutomations ? (
                  <Toggle
                    checked={a.enabled}
                    disabled={pendingAutomationId !== null}
                    ariaLabel={ctx.t(`تبديل قاعدة الأتمتة ${a.name}`, `Toggle automation rule ${a.name}`)}
                    onChange={async (v) => {
                      setPendingAutomationId(a.id);
                      try {
                        await ctx.toggleAutomation(a.id, v);
                      } finally {
                        setPendingAutomationId(null);
                      }
                    }}
                  />
                ) : (
                  <Badge tone={a.enabled ? "emerald" : "neutral"}>
                    {a.enabled ? ctx.t("مفعلة", "Enabled") : ctx.t("معطلة", "Disabled")}
                  </Badge>
                )}
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3 text-[11.5px]">
              <Badge tone="indigo" className="px-2 py-0.5 font-mono">
                {ctx.t("عندما (When):", "When:")} {a.trigger}
              </Badge>
              {Object.entries(a.conditions || {}).map(([k, v]) => (
                <Badge key={k} tone="amber" className="px-2 py-0.5 font-mono">
                  {ctx.t("إذا (If):", "If:")} {k}={String(v)}
                </Badge>
              ))}
              {Object.entries(a.actions || {}).map(([k, v]) => (
                <Badge key={k} tone="emerald" className="px-2 py-0.5 font-mono font-bold">
                  {ctx.t("ثم (Then):", "Then:")} {k}={String(v)}
                </Badge>
              ))}
            </div>
          </Card>
        ))}

        {ctx.automations.length === 0 && (
          <Card className="bg-surface">
            <ScreenState
              framed={false}
              tone="empty"
              title={ctx.t("لا توجد قواعد أتمتة", "No automation rules")}
              description={ctx.t(
                "أنشئ قواعد تلقائية لتحديث المهام وإرسال التنبيهات وتسهيل العمليات.",
                "Create rules to automatically update tasks, send alerts, and streamline workflow.",
              )}
              action={
                canManageAutomations ? (
                  <Btn variant="glow" onClick={() => ctx.setShowNewAutomation(true)}>
                    <IconPlus size={14} />
                    {ctx.t("إنشاء أول قاعدة", "Create first rule")}
                  </Btn>
                ) : undefined
              }
            />
          </Card>
        )}
      </div>

      <div className="mt-7">
        <SectionTitle count={ctx.automationRuns.length}>{ctx.t("سجل التشغيل", "Execution log")}</SectionTitle>
        <Card className="overflow-hidden bg-surface">
          <div className="divide-y divide-line">
            {ctx.automationRuns.slice(0, 12).map((run) => (
              <div key={run.id} className="flex items-center gap-3 px-5 py-3 text-[12px]">
                <span
                  role="status"
                  className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                    run.status === "success"
                      ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]"
                      : run.status === "failed"
                        ? "bg-rose-500"
                        : "bg-amber-500"
                  }`}
                  aria-label={runStatus(run.status, ctx.t)}
                />
                <span className="flex-1 truncate text-ink-soft">{runMessage(run, ctx.t)}</span>
                <span className="mono text-[10.5px] text-ink-faint tabular">
                  {fmtNumber(run.durationMs, ctx.locale)}ms
                </span>
                <time dateTime={run.createdAt} className="text-[10.5px] text-ink-faint">
                  {new Date(run.createdAt).toLocaleTimeString(dateLocale(ctx.locale))}
                </time>
              </div>
            ))}
            {ctx.automationRuns.length === 0 && (
              <div className="p-6">
                <ScreenState
                  framed={false}
                  tone="empty"
                  title={ctx.t("لا تشغيلات بعد", "No runs yet")}
                  description={ctx.t(
                    "غيّر حالة مهمة لتفعيل القواعد المرتبطة",
                    "Change task status to trigger configured rules",
                  )}
                />
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
