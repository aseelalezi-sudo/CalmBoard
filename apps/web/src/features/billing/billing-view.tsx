"use client";
import { useState } from "react";
import type { ViewCtx } from "@/lib/types";
import { Badge, Bar, Card, Empty, SectionTitle } from "@/components/ui";
import { IconCheck, IconDoc, IconShield } from "@/components/icons";
import { useBillingCheckout } from "@/features/billing/use-billing-checkout";

/* ================= Billing View ================= */
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
  const [promotionCode, setPromotionCode] = useState("");
  const {
    checkout,
    loadingPlanId: checkoutLoading,
    openPortal,
    portalLoading,
  } = useBillingCheckout(ctx, usedSeats, promotionCode);
  return (
    <div className="max-w-[960px] mx-auto">
      <div className="mb-5">
        <h2 className="text-[19px] font-bold text-slate-900 dark:text-white">
          {ctx.t("الاشتراك والفوترة", "Subscription & Billing")}
        </h2>
        <p className="mt-0.5 text-[12px] text-slate-500 dark:text-zinc-500">{ctx.activeOrg?.name}</p>
      </div>

      <Card className="mb-6 p-5 bg-white dark:bg-white/[0.025]" glow>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-500 text-white shadow-sm dark:shadow-[0_0_20px_rgba(99,102,241,0.4)]">
              <IconShield size={20} />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[16px] font-bold text-slate-900 dark:text-white">
                  {ctx.t("خطة الأعمال", "Business plan")}
                </span>
                <Badge tone="cyan">{current}</Badge>
              </div>
              <div className="mt-0.5 text-[12px] text-slate-500 dark:text-zinc-500">
                {ctx.t("تجديد شهري · دفع عبر Stripe Adapter", "Monthly renewal · via Stripe Adapter")}
              </div>
            </div>
          </div>
          <div className="text-end">
            <div className="mono text-[24px] font-bold text-slate-900 dark:text-white tabular">
              ${plans.find((p) => p.id === current)?.price ?? 16}
              <span className="text-[12px] text-slate-500 dark:text-zinc-500">/{ctx.t("عضو/شهر", "seat/mo")}</span>
            </div>
            <div className="text-[11px] text-slate-500 dark:text-zinc-500">
              {usedSeats} / {ctx.activeOrg?.seats ?? 25} {ctx.t("مقعد مستخدم", "seats used")}
            </div>
          </div>
        </div>
        <Bar value={(usedSeats / (ctx.activeOrg?.seats ?? 25)) * 100} className="mt-4" />
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            disabled={!canManageBilling || portalLoading}
            onClick={openPortal}
            className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2 text-[12px] font-bold text-indigo-700 transition hover:bg-indigo-100 disabled:opacity-50 dark:border-indigo-400/20 dark:bg-indigo-400/10 dark:text-indigo-300 dark:hover:bg-indigo-400/15"
          >
            {portalLoading ? ctx.t("جارٍ الفتح...", "Opening...") : ctx.t("إدارة الدفع والفواتير", "Manage billing")}
          </button>
        </div>
      </Card>

      <Card className="mb-4 bg-white p-4 dark:bg-white/[0.025]">
        <label
          className="block text-[12px] font-bold text-slate-700 dark:text-zinc-300"
          htmlFor="billing-promotion-code"
        >
          {ctx.t("رمز الخصم (اختياري)", "Promotion code (optional)")}
        </label>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <input
            id="billing-promotion-code"
            value={promotionCode}
            onChange={(event) => setPromotionCode(event.target.value.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64))}
            placeholder={ctx.t("مثال: TEAM20", "Example: TEAM20")}
            autoComplete="off"
            className="min-w-56 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[12px] text-slate-900 outline-none focus:border-indigo-400 dark:border-white/10 dark:bg-white/[0.04] dark:text-white"
          />
          <span className="text-[11px] text-slate-500 dark:text-zinc-500">
            {ctx.t(
              "تتحقق Stripe من صلاحية الرمز عند الدفع أو تغيير الخطة، وتُحتسب الفروقات تلقائياً.",
              "Stripe validates the code and calculates prorations when the plan changes.",
            )}
          </span>
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        {plans.map((p) => (
          <Card
            key={p.id}
            className={`p-5 bg-white dark:bg-white/[0.025] ${p.id === current ? "border-cyan-500/50 shadow-md dark:border-cyan-400/40 dark:shadow-[0_0_30px_rgba(34,211,238,0.12)]" : ""}`}
          >
            <div className="flex items-center justify-between">
              <span className="text-[14px] font-bold text-slate-900 dark:text-white">{ctx.t(p.ar, p.en)}</span>
              {p.id === current && <Badge tone="cyan">{ctx.t("الحالية", "Current")}</Badge>}
            </div>
            <div className="mono mt-2 text-[26px] font-bold text-slate-900 dark:text-white tabular">
              ${p.price}
              <span className="text-[11px] font-normal text-slate-500 dark:text-zinc-500">
                /{ctx.t("عضو/شهر", "seat/mo")}
              </span>
            </div>
            <ul className="mt-3 space-y-1.5">
              {(ctx.locale === "ar" ? p.feats_ar : p.feats_en).map((f) => (
                <li key={f} className="flex items-center gap-2 text-[11.5px] text-slate-600 dark:text-zinc-400">
                  <IconCheck size={12} className="text-emerald-500 dark:text-emerald-400" />
                  {f}
                </li>
              ))}
            </ul>
            <button
              disabled={p.id === current || checkoutLoading !== null || !canManageBilling}
              onClick={() => checkout(p.id)}
              className={`mt-5 w-full rounded-xl px-3 py-2 text-[12px] font-bold transition ${p.id === current ? "cursor-default border border-slate-200 bg-slate-100 text-slate-400 dark:border-white/10 dark:bg-white/[0.04] dark:text-zinc-500" : "bg-gradient-to-r from-indigo-500 to-violet-500 text-white shadow-sm hover:brightness-105 disabled:opacity-50"}`}
            >
              {checkoutLoading === p.id
                ? "⌛ جاري المعالجة..."
                : p.id === current
                  ? ctx.t("الخطة الحالية", "Current plan")
                  : ctx.t("اختيار الخطة والدفع", "Choose & checkout")}
            </button>
          </Card>
        ))}
      </div>

      <div className="mt-6">
        <SectionTitle count={ctx.invoices.length}>{ctx.t("الفواتير", "Invoices")}</SectionTitle>
        <Card className="overflow-hidden bg-white dark:bg-white/[0.025]">
          <div className="divide-y divide-slate-100 dark:divide-white/[0.04]">
            {ctx.invoices.map((inv) => (
              <div key={inv.id} className="flex items-center justify-between px-5 py-3.5 text-[12.5px]">
                <div className="flex items-center gap-3">
                  <span className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-slate-50 text-slate-500 dark:border-white/10 dark:bg-white/[0.04] dark:text-zinc-400">
                    <IconDoc size={13} />
                  </span>
                  <span className="mono font-semibold text-slate-800 dark:text-zinc-300">{inv.number}</span>
                </div>
                <span className="mono font-bold text-slate-900 dark:text-white tabular">
                  ${inv.amount} {inv.currency}
                </span>
                <Badge tone={inv.status === "paid" ? "emerald" : "amber"}>
                  {inv.status === "paid" ? ctx.t("مدفوعة", "Paid") : inv.status}
                </Badge>
                <span className="mono text-[10.5px] text-slate-500 dark:text-zinc-600">
                  {new Date(inv.createdAt).toLocaleDateString(ctx.locale === "ar" ? "ar-EG" : "en-US")}
                </span>
              </div>
            ))}
            {ctx.invoices.length === 0 && (
              <Empty icon={<IconDoc size={22} />} title={ctx.t("لا فواتير بعد", "No invoices yet")} />
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
