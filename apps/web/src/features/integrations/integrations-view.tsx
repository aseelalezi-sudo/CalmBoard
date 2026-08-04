"use client";
import type { ViewCtx } from "@/lib/types";
import { Badge, Btn, Card, Toggle } from "@/components/ui";
import { IconPlus, IconShield } from "@/components/icons";
import { useIntegrationSync } from "@/features/integrations/use-integration-sync";
import {
  useIntegrationCredentials,
  type IntegrationOAuthProvider,
} from "@/features/integrations/use-integration-credentials";

const integrationCatalog = [
  {
    id: "slack",
    name: "Slack",
    desc_ar: "إرسال إشعارات فورية عند تأخر المهام أو الإشارة إليك",
    desc_en: "Instant notifications for overdue tasks & mentions",
    icon: "💬",
  },
  {
    id: "github",
    name: "GitHub",
    desc_ar: "ربط فروع الكود و PRs بالمهام تلقائياً عبر الرقم TASK-xxx",
    desc_en: "Link branches & PRs automatically using TASK-xxx",
    icon: "🐙",
  },
  {
    id: "gcal",
    name: "Google Calendar",
    desc_ar: "مزامنة تواريخ استحقاق المهام مع تقويم فريقك",
    desc_en: "Sync task due dates with your team calendar",
    icon: "📅",
  },
  {
    id: "microsoft",
    name: "Microsoft 365",
    desc_ar: "مزامنة مواعيد المهام مع تقويم Microsoft 365",
    desc_en: "Sync task due dates with Microsoft 365 Calendar",
    icon: "M",
  },
  {
    id: "webhook",
    name: "Custom Webhook",
    desc_ar: "إرسال أحداث النظام فوراً مع Webhook Signature & Retry",
    desc_en: "Real-time system events with signature & retry policy",
    icon: "⚡",
  },
] as const;

/* ================= Integrations View ================= */
export function IntegrationsView({ ctx }: { ctx: ViewCtx }) {
  const {
    availability,
    credentialByProvider,
    loading: credentialsLoading,
    toggle: toggleIntegration,
    refresh: refreshCredentials,
  } = useIntegrationCredentials(ctx);
  const { testSync } = useIntegrationSync(ctx, refreshCredentials);

  return (
    <div className="max-w-[900px] mx-auto">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h2 className="text-[19px] font-bold text-slate-900 dark:text-white">
            {ctx.t("التكاملات الخارجية", "Integrations Framework")}
          </h2>
          <p className="mt-0.5 text-[12px] text-slate-500 dark:text-zinc-500">
            {ctx.t(
              "اربط CalmBoard بأدوات عملك المفضلة (قسم 28)",
              "Connect CalmBoard with your favorite work tools (Section 28)",
            )}
          </p>
        </div>
        <Btn variant="glow" disabled={!ctx.can("integrations.manage")}>
          <IconPlus size={15} />
          {ctx.t("إضافة تكامل", "Add integration")}
        </Btn>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {integrationCatalog
          .filter((item) => item.id !== "webhook")
          .map((item) => {
            const credential = credentialByProvider.get(item.id);
            const connected = Boolean(credential);
            const configured = availability[item.id as IntegrationOAuthProvider];
            return (
              <Card
                key={item.id}
                className={`p-5 bg-white dark:bg-white/[0.025] ${connected ? "border-indigo-500/30 shadow-sm dark:border-indigo-500/20" : "opacity-70"}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3.5">
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-slate-200 bg-slate-100 text-[20px] dark:border-white/10 dark:bg-white/[0.05]">
                      {item.icon}
                    </span>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-[14.5px] font-bold text-slate-900 dark:text-white">{item.name}</span>
                        <Badge tone={connected ? "emerald" : "neutral"}>
                          {connected
                            ? ctx.t("متصل", "Connected")
                            : configured
                              ? ctx.t("غير متصل", "Disconnected")
                              : ctx.t("غير مهيأ", "Not configured")}
                        </Badge>
                      </div>
                      <p className="mt-1 text-[11.5px] leading-relaxed text-slate-500 dark:text-zinc-400">
                        {ctx.t(item.desc_ar, item.desc_en)}
                      </p>
                    </div>
                  </div>
                  <Toggle
                    checked={connected}
                    disabled={!ctx.can("integrations.manage") || (!configured && !connected)}
                    onChange={() => void toggleIntegration(item.id as IntegrationOAuthProvider)}
                  />
                </div>
                <div className="mt-4 flex items-center justify-between border-t border-slate-100 dark:border-white/[0.05] pt-3 text-[11px] text-slate-500 dark:text-zinc-500">
                  <span className="mono">
                    {credential?.lastUsedAt
                      ? `${ctx.t("آخر استخدام", "Last used")}: ${new Intl.DateTimeFormat(
                          ctx.locale === "ar" ? "ar-SA" : "en",
                          {
                            dateStyle: "medium",
                            timeStyle: "short",
                          },
                        ).format(new Date(credential.lastUsedAt))}`
                      : ctx.t("لا يوجد نشاط مزامنة مسجل", "No recorded sync activity")}
                  </span>
                  <button
                    disabled={!connected || credentialsLoading || !ctx.can("integrations.manage")}
                    onClick={() => testSync(item.id, item.name)}
                    className="text-indigo-600 dark:text-violet-300 font-semibold hover:underline disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {ctx.t("اختبار المزامنة ←", "Test sync →")}
                  </button>
                </div>
              </Card>
            );
          })}
      </div>

      <Card className="mt-6 p-5 bg-white dark:bg-white/[0.025]">
        <div className="flex items-center gap-2 text-indigo-600 dark:text-violet-300">
          <IconShield size={15} />
          <span className="text-[13px] font-semibold">
            {ctx.t("أمان التكاملات (OAuth Token & Webhooks)", "Security & Webhook Reliability")}
          </span>
        </div>
        <p className="mt-2 text-[11.5px] leading-relaxed text-slate-600 dark:text-zinc-400">
          {ctx.t(
            "جميع التوكنات مشفرة في قاعدة البيانات (Encryption at rest)، والـ Webhooks مزودة بتوقيع أمني (HMAC SHA-256 Verification)، مع سياسة إعادة محاولة (Exponential Backoff) وقائمة طوارئ Dead-Letter Queue لمنع فقدان البيانات.",
            "All tokens are encrypted at rest. Webhooks include HMAC SHA-256 verification signatures, automatic exponential backoff retry policies, and a Dead-Letter Queue.",
          )}
        </p>
      </Card>
    </div>
  );
}
