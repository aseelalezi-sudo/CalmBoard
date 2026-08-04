import { useState } from "react";
import type { ViewCtx } from "@/lib/types";
import { createCheckoutSession, createCustomerPortalSession } from "@/features/billing/api";

export function useBillingCheckout(ctx: ViewCtx, usedSeats: number, promotionCode: string) {
  const [loadingPlanId, setLoadingPlanId] = useState<string | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);

  const checkout = async (planId: string) => {
    if (!ctx.activeOrg || !ctx.can("billing.manage")) return;
    setLoadingPlanId(planId);
    try {
      const result = await createCheckoutSession({
        organizationId: ctx.activeOrg.id,
        planId,
        billingInterval: "monthly",
        seats: Math.max(usedSeats, 1),
        returnUrl: window.location.origin + "/?billing=success",
        promotionCode: promotionCode.trim() || undefined,
      });
      if (!result.url) return;
      ctx.notify(
        result.mode === "stripe_live"
          ? ctx.t("جاري فتح بوابة Stripe الآمنة...", "Opening secure Stripe Checkout...")
          : result.mode === "stripe_update"
            ? ctx.t(
                "أرسل تغيير الخطة إلى Stripe مع احتساب الفروقات؛ ستتحدث الحالة بعد تأكيد الدفع",
                "Plan change sent to Stripe with proration; status updates after payment confirmation",
              )
            : ctx.t(
                "تم تحديث الاشتراك في وضع المحاكاة (جاهز للربط بـ Stripe)",
                "Subscription updated in simulation mode (Stripe-ready)",
              ),
      );
      if (result.mode === "stripe_live") window.location.assign(result.url);
      else setTimeout(() => window.location.reload(), 900);
    } catch {
      ctx.notify(ctx.t("تعذر إنشاء جلسة الدفع", "Unable to create checkout session"), "error");
    } finally {
      setLoadingPlanId(null);
    }
  };

  const openPortal = async () => {
    if (!ctx.activeOrg || !ctx.can("billing.manage")) return;
    setPortalLoading(true);
    try {
      const result = await createCustomerPortalSession({
        organizationId: ctx.activeOrg.id,
        returnUrl: window.location.origin + "/?billing=portal",
      });
      if (!result.url) throw new Error("Missing portal URL");
      ctx.notify(ctx.t("جاري فتح بوابة إدارة الفوترة...", "Opening the billing management portal..."));
      window.location.assign(result.url);
    } catch {
      ctx.notify(
        ctx.t("بوابة Stripe غير متاحة لهذا الاشتراك", "Stripe portal is unavailable for this subscription"),
        "error",
      );
    } finally {
      setPortalLoading(false);
    }
  };

  return { checkout, loadingPlanId, openPortal, portalLoading };
}
