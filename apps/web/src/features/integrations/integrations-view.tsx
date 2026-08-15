"use client";

import type { ViewCtx } from "@/lib/types";
import { Badge, Btn, Card, ScreenHeader, ScreenState, Toggle } from "@/components/ui";
import { IconRotateCw, IconShield } from "@/components/icons";
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

export function IntegrationsView({ ctx }: { ctx: ViewCtx }) {
  const canManage = ctx.can("integrations.manage");
  const {
    availability,
    credentialByProvider,
    loading: credentialsLoading,
    loadError,
    pendingProvider,
    toggle: toggleIntegration,
    refresh: refreshCredentials,
  } = useIntegrationCredentials(ctx);
  const { testSync } = useIntegrationSync(ctx, refreshCredentials);

  if (!canManage) {
    return (
      <div className="screen-container-standard">
        <ScreenState
          tone="permission"
          title={ctx.t("غير مصرح بالوصول إلى التكاملات", "Permission required to view integrations")}
          description={ctx.t(
            "تحتاج إلى صلاحية إدارة التكاملات (integrations.manage) للاطلاع على تكاملات مساحة العمل وإدارتها.",
            "You need integration management permissions to view and manage workspace integrations.",
          )}
        />
      </div>
    );
  }

  if (credentialsLoading) {
    return (
      <div className="screen-container-standard">
        <ScreenState
          tone="loading"
          title={ctx.t("جاري تحميل التكاملات…", "Loading integrations…")}
          description={ctx.t(
            "يرجى الانتظار بينما نتأكد من حالة اتصال الأدوات الخارجية.",
            "Checking connection status with third-party tools.",
          )}
        />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="screen-container-standard">
        <ScreenState
          tone="error"
          title={ctx.t("تعذر تحميل التكاملات", "Failed to load integrations")}
          description={loadError}
          action={
            <Btn variant="outline" onClick={() => void refreshCredentials()}>
              <IconRotateCw size={14} />
              {ctx.t("إعادة المحاولة", "Retry")}
            </Btn>
          }
        />
      </div>
    );
  }

  return (
    <div className="screen-container-standard space-y-6">
      <ScreenHeader
        title={ctx.t("التكاملات الخارجية", "Integrations Framework")}
        description={ctx.t(
          "اربط CalmBoard بأدوات عملك المفضلة وسرّع وتيرة التعاون.",
          "Connect CalmBoard with your favorite productivity tools and streamline workflows.",
        )}
      />

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
                className={`bg-surface p-5 transition ${connected ? "border-indigo-500/30 shadow-sm" : "opacity-80"}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3.5">
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-line bg-raised text-[20px]">
                      {item.icon}
                    </span>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-[14.5px] font-bold text-ink">{item.name}</span>
                        <Badge tone={connected ? "emerald" : "neutral"}>
                          {connected
                            ? ctx.t("متصل", "Connected")
                            : configured
                              ? ctx.t("غير متصل", "Disconnected")
                              : ctx.t("غير مهيأ", "Not configured")}
                        </Badge>
                      </div>
                      <p className="mt-1 text-[11.5px] leading-relaxed text-ink-soft">
                        {ctx.t(item.desc_ar, item.desc_en)}
                      </p>
                    </div>
                  </div>
                  <Toggle
                    checked={connected}
                    ariaLabel={ctx.t(`تبديل تكامل ${item.name}`, `Toggle ${item.name} integration`)}
                    disabled={pendingProvider !== null || (!configured && !connected)}
                    onChange={() => void toggleIntegration(item.id as IntegrationOAuthProvider)}
                  />
                </div>
                <div className="mt-4 flex items-center justify-between border-t border-line pt-3 text-[11px] text-ink-faint">
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
                    type="button"
                    disabled={!connected || pendingProvider !== null}
                    onClick={() => testSync(item.id, item.name)}
                    className="font-semibold text-accent hover:underline disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {ctx.t("اختبار المزامنة ←", "Test sync →")}
                  </button>
                </div>
              </Card>
            );
          })}
      </div>

      <Card className="bg-surface p-5">
        <div className="flex items-center gap-2 text-accent">
          <IconShield size={15} />
          <span className="text-[13px] font-semibold">
            {ctx.t("أمان التكاملات (OAuth Token & Webhooks)", "Security & Webhook Reliability")}
          </span>
        </div>
        <p className="mt-2 text-[11.5px] leading-relaxed text-ink-soft">
          {ctx.t(
            "جميع التوكنات مشفرة في قاعدة البيانات (Encryption at rest)، والـ Webhooks مزودة بتوقيع أمني (HMAC SHA-256 Verification)، مع سياسة إعادة محاولة (Exponential Backoff) وقائمة طوارئ Dead-Letter Queue لمنع فقدان البيانات.",
            "All tokens are encrypted at rest. Webhooks include HMAC SHA-256 verification signatures, automatic exponential backoff retry policies, and a Dead-Letter Queue.",
          )}
        </p>
      </Card>
    </div>
  );
}
