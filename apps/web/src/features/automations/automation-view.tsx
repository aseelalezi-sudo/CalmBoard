"use client";
import type { Automation, ViewCtx } from "@/lib/types";
import { Badge, Btn, Card, Empty, SectionTitle, Toggle } from "@/components/ui";
import { IconBolt } from "@/components/icons";
import { useAutomationTest } from "@/features/automations/use-automation-test";

const dateLocale = (locale: string) => (locale === "ar" ? "ar-EG" : "en-US");

/* ================= Automation View ================= */
export function AutomationView({ ctx }: { ctx: ViewCtx }) {
  const { testingId, testRun } = useAutomationTest(ctx);

  return (
    <div className="max-w-[880px] mx-auto space-y-6 animate-fade">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-[20px] font-bold text-slate-900 dark:text-white">
            {ctx.t("محرك الأتمتة (When → If → Then — القسم 14)", "Automation Engine")}
          </h2>
          <p className="mt-0.5 text-[12.5px] text-slate-500 dark:text-zinc-400">
            {ctx.t(
              "أتمتة سير العمل بذكاء مع سياسات إعادة المحاولة وإمكانية التشغيل التجريبي قبل التفعيل",
              "Automate workflows intelligently with retry policies & dry test runs before activation",
            )}
          </p>
        </div>
        <Btn variant="glow" disabled={!ctx.can("automations.manage")} onClick={() => ctx.setShowNewAutomation(true)}>
          <IconBolt size={15} />
          {ctx.t("قاعدة جديدة", "New rule")}
        </Btn>
      </div>
      <div className="stagger space-y-3.5">
        {ctx.automations.map((a) => (
          <Card
            key={a.id}
            className={`p-5 transition bg-white dark:bg-white/[0.025] ${a.enabled ? "border-slate-200 shadow-sm dark:border-white/[0.08] dark:shadow-none" : "opacity-65"}`}
          >
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex min-w-[240px] flex-1 items-center gap-3.5">
                <span
                  className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl border ${a.enabled ? "border-indigo-200 bg-indigo-50 text-indigo-600 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-300 shadow-sm dark:shadow-[0_0_16px_rgba(139,92,246,0.2)]" : "border-slate-200 bg-slate-100 text-slate-400 dark:border-white/10 dark:bg-white/[0.04] dark:text-zinc-500"}`}
                >
                  <IconBolt size={18} />
                </span>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[14.5px] font-bold text-slate-900 dark:text-white">{a.name}</span>
                    <Badge tone={a.enabled ? "emerald" : "neutral"}>
                      {a.enabled ? ctx.t("نشطة", "Active") : ctx.t("معطلة", "Disabled")}
                    </Badge>
                  </div>
                  <div className="mt-0.5 text-[11.5px] text-slate-500 dark:text-zinc-500">
                    <span className="mono font-bold tabular-nums">{a.runs}</span>{" "}
                    {ctx.t("تشغيل ناجح", "successful runs")} •{" "}
                    {a.lastRunAt
                      ? `آخر تشغيل: ${new Date(a.lastRunAt).toLocaleTimeString("ar-EG")}`
                      : ctx.t("لم تُشغل بعد", "Never run")}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3 shrink-0">
                <button
                  onClick={() => testRun(a)}
                  disabled={testingId === a.id || !ctx.can("automations.manage")}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50/80 px-3 py-1.5 text-[12px] font-bold text-indigo-700 hover:bg-indigo-100 transition shadow-sm dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-300 dark:hover:bg-indigo-500/20 disabled:opacity-50"
                  title={ctx.t(
                    "تشغيل تجريبي فوري ضد أحدث مهمة للتحقق من الشروط والإجراءات (القسم 14)",
                    "Manual test run against latest task to verify conditions & actions (Section 14)",
                  )}
                >
                  <span>{testingId === a.id ? "⌛" : "▶️"}</span>
                  <span>{ctx.t("تشغيل تجريبي", "Test Run Now")}</span>
                </button>
                <Toggle
                  checked={a.enabled}
                  disabled={!ctx.can("automations.manage")}
                  onChange={(v) => ctx.toggleAutomation(a.id, v)}
                />
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2 pt-3 border-t border-slate-100 dark:border-white/[0.05] text-[11.5px]">
              <Badge tone="indigo" className="px-2 py-0.5 font-mono">
                ⚡ {ctx.t("عندما (When)", "When")}: {a.trigger}
              </Badge>
              {Object.entries(a.conditions || {}).map(([k, v]) => (
                <Badge key={k} tone="amber" className="px-2 py-0.5 font-mono">
                  ❓ {ctx.t("إذا (If)", "If")}: {k}={String(v)}
                </Badge>
              ))}
              {Object.entries(a.actions || {}).map(([k, v]) => (
                <Badge key={k} tone="emerald" className="px-2 py-0.5 font-mono font-bold">
                  🎯 {ctx.t("ثم (Then)", "Then")}: {k}={String(v)}
                </Badge>
              ))}
            </div>
          </Card>
        ))}
      </div>
      <div className="mt-7">
        <SectionTitle count={ctx.automationRuns.length}>{ctx.t("سجل التشغيل", "Execution log")}</SectionTitle>
        <Card className="overflow-hidden">
          <div className="divide-y divide-white/[0.04]">
            {ctx.automationRuns.slice(0, 8).map((r) => (
              <div key={r.id} className="flex items-center gap-3 px-5 py-3 text-[12px]">
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${r.status === "success" ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.7)]" : "bg-rose-400"}`}
                />
                <span className="flex-1 truncate text-zinc-400">{r.message}</span>
                <span className="mono text-[10.5px] text-zinc-600 tabular">{r.durationMs}ms</span>
                <span className="text-[10.5px] text-zinc-600">
                  {new Date(r.createdAt).toLocaleTimeString(dateLocale(ctx.locale))}
                </span>
              </div>
            ))}
            {ctx.automationRuns.length === 0 && (
              <Empty
                icon={<IconBolt size={22} />}
                title={ctx.t("لا تشغيلات بعد", "No runs yet")}
                hint={ctx.t("غيّر حالة مهمة لتفعيل قاعدة", "Change a task status to trigger a rule")}
              />
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
