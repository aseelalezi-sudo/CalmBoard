"use client";

import { useState } from "react";
import type { ViewCtx } from "@/lib/types";
import { fmtNumber } from "@/lib/types";
import { Badge, Bar, Btn, Card, ScreenHeader, ScreenState, SectionTitle } from "@/components/ui";
import { IconCheck, IconDoc, IconShield } from "@/components/icons";
import { useBillingCheckout } from "@/features/billing/use-billing-checkout";

export function formatBillingAmount(amount: number, locale: string = "ar", currency: string = "USD") {
  return new Intl.NumberFormat(locale === "ar" ? "ar-EG" : "en-US", {
    style: "currency",
    currency,
  }).format(amount);
}

function planLabel(plan: string, t: ViewCtx["t"]) {
  switch (plan) {
    case "free":
      return t("مجاني", "Free");
    case "team":
      return t("الفرق", "Team");
    case "business":
      return t("الأعمال", "Business");
    case "enterprise":
      return t("المؤسسات", "Enterprise");
    default:
      return plan;
  }
}

export function BillingView({ ctx }: { ctx: ViewCtx }) {
  const canManageBilling = ctx.can("billing.manage");

  const plans = [
    {
      id: "free",
      ar: "مجاني",
      en: "Free",
      price: 0,
      feats_ar: ["3 أعضاء", "مشروعان", "عرض أساسي"],
      feats_en: ["3 members", "2 projects", "Basic views"],
    },
    {
      id: "team",
      ar: "الفرق",
      en: "Team",
      price: 8,
      feats_ar: ["أعضاء غير محدودين", "مشاريع غير محدودة", "أتمتة ونماذج"],
      feats_en: ["Unlimited members", "Unlimited projects", "Automations & forms"],
    },
    {
      id: "business",
      ar: "الأعمال",
      en: "Business",
      price: 16,
      feats_ar: ["كل مزايا الفرق", "تقارير متقدمة", "ذكاء اصطناعي", "دعم أولوية"],
      feats_en: ["All Team features", "Advanced reports", "AI assistant", "Priority support"],
    },
    {
      id: "enterprise",
      ar: "المؤسسات",
      en: "Enterprise",
      price: 45,
      feats_ar: ["كل مزايا الأعمال", "SLA ودعم مخصص", "فروع و SSO", "حدود موسعة"],
      feats_en: ["All Business features", "SLA & dedicated support", "Branches & SSO", "Expanded limits"],
    },
  ];

  const current = ctx.activeOrg?.plan || "team";
  const usedSeats = ctx.members.length;
  const totalSeats = ctx.activeOrg?.seats ?? 25;
  const [promotionCode, setPromotionCode] = useState("");
  const {
    checkout,
    loadingPlanId: checkoutLoading,
    openPortal,
    portalLoading,
  } = useBillingCheckout(ctx, usedSeats, promotionCode);

  const billingBusy = checkoutLoading !== null || portalLoading;

  if (!canManageBilling) {
    return (
      <div className="screen-container-standard">
        <ScreenState
          tone="permission"
          title={ctx.t("غير مصرح بإدارة الفوترة", "Unauthorized billing management")}
          description={ctx.t(
            "ليس لديك صلاحية كافية لتعديل خطة الاشتراك أو إدارة الفواتير. تواصل مع مالك المؤسسة.",
            "You do not have sufficient permissions to modify subscriptions or manage billing. Contact the organization owner.",
          )}
        />
      </div>
    );
  }

  return (
    <div className="screen-container-standard space-y-6">
      <ScreenHeader
        title={ctx.t("الاشتراك والفوترة", "Subscription & Billing")}
        description={
          ctx.activeOrg?.name || ctx.t("إدارة خطة الاشتراك والفواتير", "Manage subscription plan and invoices")
        }
      />

      <Card className="bg-surface p-5" glow>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-linear-to-br from-indigo-500 to-violet-500 text-white shadow-sm">
              <IconShield size={20} />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[16px] font-bold text-ink">{planLabel(current, ctx.t)}</span>
                <Badge tone="cyan">{planLabel(current, ctx.t)}</Badge>
              </div>
              <div className="mt-0.5 text-[12px] text-ink-faint">
                {ctx.t("تجديد شهري · دفع عبر Stripe Adapter", "Monthly renewal · via Stripe Adapter")}
              </div>
            </div>
          </div>
          <div className="text-end">
            <div className="mono text-[24px] font-bold text-ink tabular">
              {formatBillingAmount(plans.find((p) => p.id === current)?.price ?? 16, ctx.locale, "USD")}
              <span className="text-[12px] text-ink-faint">/{ctx.t("عضو/شهر", "seat/mo")}</span>
            </div>
            <div className="text-[11px] text-ink-faint">
              {fmtNumber(usedSeats, ctx.locale)} / {fmtNumber(totalSeats, ctx.locale)}{" "}
              {ctx.t("مقعد مستخدم", "seats used")}
            </div>
          </div>
        </div>
        <Bar value={(usedSeats / totalSeats) * 100} className="mt-4" />
        <div className="mt-4 flex justify-end">
          <Btn variant="outline" disabled={billingBusy} aria-busy={portalLoading} onClick={openPortal}>
            {portalLoading
              ? ctx.t("جارٍ المعالجة...", "Processing...")
              : ctx.t("إدارة الدفع والفواتير", "Manage billing")}
          </Btn>
        </div>
      </Card>

      <Card className="bg-surface p-4">
        <label className="block text-[12px] font-bold text-ink" htmlFor="billing-promotion-code">
          {ctx.t("رمز الخصم (اختياري)", "Promotion code (optional)")}
        </label>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <input
            id="billing-promotion-code"
            value={promotionCode}
            disabled={billingBusy}
            onChange={(event) => setPromotionCode(event.target.value.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64))}
            placeholder={ctx.t("مثال: TEAM20", "Example: TEAM20")}
            autoComplete="off"
            className="min-w-56 flex-1 rounded-xl border border-line bg-surface px-3 py-2 text-[12px] text-ink outline-none focus:border-indigo-500 disabled:opacity-50"
          />
          <span className="text-[11px] text-ink-faint">
            {ctx.t(
              "تتحقق Stripe من صلاحية الرمز عند الدفع أو تغيير الخطة، وتُحتسب الفروقات تلقائياً.",
              "Stripe validates the code and calculates prorations when the plan changes.",
            )}
          </span>
        </div>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {plans.map((p) => (
          <Card
            key={p.id}
            className={`bg-surface p-5 ${p.id === current ? "border-cyan-500/50 shadow-md dark:border-cyan-400/40" : ""}`}
          >
            <div className="flex items-center justify-between">
              <span className="text-[14px] font-bold text-ink">{ctx.t(p.ar, p.en)}</span>
              {p.id === current && <Badge tone="cyan">{ctx.t("الحالية", "Current")}</Badge>}
            </div>
            <div className="mono mt-2 text-[24px] font-bold text-ink tabular">
              {formatBillingAmount(p.price, ctx.locale, "USD")}
              <span className="text-[11px] font-normal text-ink-faint">/{ctx.t("عضو/شهر", "seat/mo")}</span>
            </div>
            <ul className="mt-3 space-y-1.5">
              {(ctx.locale === "ar" ? p.feats_ar : p.feats_en).map((f) => (
                <li key={f} className="flex items-center gap-2 text-[11.5px] text-ink-soft">
                  <IconCheck size={12} className="text-emerald-500" />
                  {f}
                </li>
              ))}
            </ul>
            <Btn
              variant={p.id === current ? "outline" : "glow"}
              disabled={p.id === current || billingBusy}
              aria-busy={checkoutLoading === p.id}
              onClick={() => checkout(p.id)}
              className="mt-5 w-full"
            >
              {checkoutLoading === p.id
                ? ctx.t("جارٍ المعالجة...", "Processing...")
                : p.id === current
                  ? ctx.t("الخطة الحالية", "Current plan")
                  : ctx.t("اختيار الخطة والدفع", "Choose & checkout")}
            </Btn>
          </Card>
        ))}
      </div>

      <div className="mt-6">
        <SectionTitle count={ctx.invoices.length}>{ctx.t("الفواتير", "Invoices")}</SectionTitle>
        <Card className="overflow-hidden bg-surface">
          <div className="divide-y divide-line">
            {ctx.invoices.map((inv) => (
              <div key={inv.id} className="flex items-center justify-between px-5 py-3.5 text-[12.5px]">
                <div className="flex items-center gap-3">
                  <span className="grid h-8 w-8 place-items-center rounded-lg border border-line bg-raised text-ink-soft">
                    <IconDoc size={13} />
                  </span>
                  <bdi dir="ltr" className="mono font-semibold text-ink">
                    {inv.number}
                  </bdi>
                </div>
                <span className="mono font-bold text-ink tabular">
                  {formatBillingAmount(inv.amount, ctx.locale, inv.currency || "USD")}
                </span>
                <Badge tone={inv.status === "paid" ? "emerald" : "amber"}>
                  {inv.status === "paid" ? ctx.t("مدفوعة", "Paid") : inv.status}
                </Badge>
                <time dateTime={inv.createdAt} className="mono text-[10.5px] text-ink-faint">
                  {new Date(inv.createdAt).toLocaleDateString(ctx.locale === "ar" ? "ar-EG" : "en-US")}
                </time>
              </div>
            ))}
            {ctx.invoices.length === 0 && (
              <div className="p-6">
                <ScreenState
                  framed={false}
                  tone="empty"
                  title={ctx.t("لا فواتير بعد", "No invoices yet")}
                  description={ctx.t(
                    "ستظهر الفواتير هنا بعد إتمام عمليات الدفع",
                    "Invoices will appear here once payment is completed",
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
