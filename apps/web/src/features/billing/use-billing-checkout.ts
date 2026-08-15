import { useRef, useState } from "react";
import type { ViewCtx } from "@/lib/types";
import { createCheckoutSession, createCustomerPortalSession } from "@/features/billing/api";

export function useBillingCheckout(ctx: ViewCtx, usedSeats: number, promotionCode: string) {
  const [loadingPlanId, setLoadingPlanId] = useState<string | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);
  const busyRef = useRef(false);

  const checkout = async (planId: string) => {
    if (busyRef.current || !ctx.activeOrg || !ctx.can("billing.manage")) return;
    busyRef.current = true;
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
      if (!result.url) throw new Error("Missing billing destination");
      ctx.notify(
        result.mode === "stripe_live"
          ? ctx.t("جاري فتح بوابة Stripe الآمنة...", "Opening secure Stripe Checkout...")
          : result.mode === "stripe_update"
            ? ctx.t(
                "أرسل تغيير الخطة إلى Stripe مع احتساب الفروقات؛ ستتحدث الحالة بعد تأكيد الدفع",
                "Plan change sent to Stripe with proration; status updates after payment confirmation",
              )
            : ctx.t(
                "تم تحديث اشتراك بيئة التطوير المحلية دون خصم فعلي",
                "Local development subscription updated without a real charge",
              ),
      );
      if (result.mode === "stripe_live") window.location.assign(result.url);
      else setTimeout(() => window.location.reload(), 900);
    } catch {
      ctx.notify(ctx.t("تعذر إنشاء جلسة الدفع", "Unable to create checkout session"), "error");
    } finally {
      busyRef.current = false;
      setLoadingPlanId(null);
    }
  };

  const openPortal = async () => {
    if (busyRef.current || !ctx.activeOrg || !ctx.can("billing.manage")) return;
    busyRef.current = true;
    setPortalLoading(true);
    try {
      const result = await createCustomerPortalSession({
        organizationId: ctx.activeOrg.id,
        returnUrl: window.location.origin + "/?billing=portal",
      });
      if (!result.url) throw new Error("Missing billing destination");
      ctx.notify(ctx.t("جاري فتح بوابة إدارة الفوترة...", "Opening the billing management portal..."));
      window.location.assign(result.url);
    } catch {
      ctx.notify(
        ctx.t("بوابة Stripe غير متاحة لهذا الاشتراك", "Stripe portal is unavailable for this subscription"),
        "error",
      );
    } finally {
      busyRef.current = false;
      setPortalLoading(false);
    }
  };

  return { checkout, loadingPlanId, openPortal, portalLoading };
}
