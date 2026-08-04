import { ServiceUnavailableException } from "@nestjs/common";
import type { BillingInterval, BillingPlan } from "@calmboard/database";

export type BillingProviderCheckout = {
  organizationId: string;
  plan: BillingPlan;
  planName: string;
  billingInterval: BillingInterval;
  seats: number;
  unitPriceCents: number;
  currency: string;
  returnUrl: string;
  idempotencyKey: string;
  promotionCode?: string;
};

export type BillingProviderCheckoutResult = {
  url: string;
  sessionId: string;
  mode: "stripe_live" | "stripe_update" | "simulation";
  pendingUpdate?: boolean;
};

export type BillingProviderPortal = {
  customerId: string;
  returnUrl: string;
  idempotencyKey: string;
};

export type BillingProviderSubscriptionChange = BillingProviderCheckout & {
  customerId: string;
  subscriptionId: string;
};

export class BillingProviderInputError extends Error {}

export interface BillingProviderAdapter {
  readonly provider: "stripe" | "internal";
  createCheckoutSession(input: BillingProviderCheckout): Promise<BillingProviderCheckoutResult>;
  createPortalSession(input: BillingProviderPortal): Promise<BillingProviderCheckoutResult>;
  changeSubscription(input: BillingProviderSubscriptionChange): Promise<BillingProviderCheckoutResult>;
}

export class StripeBillingProvider implements BillingProviderAdapter {
  readonly provider = "stripe" as const;

  constructor(private readonly secret: string) {}

  private async request(path: string, init: RequestInit, idempotencyKey?: string) {
    const response = await fetch(`https://api.stripe.com/v1/${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.secret}`,
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
        ...init.headers,
      },
    });
    if (!response.ok) {
      if (response.status >= 400 && response.status < 500) {
        throw new BillingProviderInputError("Stripe rejected the billing details or promotion code.");
      }
      throw new Error(`Stripe returned HTTP ${response.status}.`);
    }
    return (await response.json()) as Record<string, unknown>;
  }

  private async resolvePromotionCode(code: string, customerId?: string) {
    const query = new URLSearchParams({ code, active: "true", limit: "1" });
    if (customerId) query.set("customer", customerId);
    const result = await this.request(`promotion_codes?${query}`, { method: "GET" });
    const promotion = Array.isArray(result.data) ? (result.data[0] as { id?: unknown } | undefined) : undefined;
    if (typeof promotion?.id !== "string")
      throw new BillingProviderInputError("Promotion code is invalid or inactive.");
    return promotion.id;
  }

  async createCheckoutSession(input: BillingProviderCheckout) {
    const stripeInterval = input.billingInterval === "yearly" ? "year" : "month";
    const promotionCodeId = input.promotionCode ? await this.resolvePromotionCode(input.promotionCode) : undefined;
    const body = new URLSearchParams({
      mode: "subscription",
      success_url: `${input.returnUrl}?session_id={CHECKOUT_SESSION_ID}&plan=${input.plan}`,
      cancel_url: input.returnUrl,
      client_reference_id: input.organizationId,
      "line_items[0][price_data][currency]": input.currency.toLowerCase(),
      "line_items[0][price_data][product_data][name]": `CalmBoard ${input.planName} (${input.seats} seats)`,
      "line_items[0][price_data][unit_amount]": String(input.unitPriceCents),
      "line_items[0][price_data][recurring][interval]": stripeInterval,
      "line_items[0][quantity]": String(input.seats),
      "metadata[organizationId]": input.organizationId,
      "metadata[planId]": input.plan,
      "metadata[seats]": String(input.seats),
      "metadata[billingInterval]": input.billingInterval,
      "subscription_data[metadata][organizationId]": input.organizationId,
      "subscription_data[metadata][planId]": input.plan,
      "subscription_data[metadata][seats]": String(input.seats),
      "subscription_data[metadata][billingInterval]": input.billingInterval,
    });
    if (promotionCodeId) body.set("discounts[0][promotion_code]", promotionCodeId);
    else body.set("allow_promotion_codes", "true");
    const session = await this.request(
      "checkout/sessions",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      },
      input.idempotencyKey,
    );
    if (typeof session.url !== "string" || typeof session.id !== "string") {
      throw new Error("Stripe did not return a checkout URL and session ID.");
    }
    return { url: session.url, sessionId: session.id, mode: "stripe_live" as const };
  }

  async createPortalSession(input: BillingProviderPortal) {
    const session = await this.request(
      "billing_portal/sessions",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ customer: input.customerId, return_url: input.returnUrl }),
      },
      input.idempotencyKey,
    );
    if (typeof session.url !== "string" || typeof session.id !== "string") {
      throw new Error("Stripe did not return a customer portal URL and session ID.");
    }
    return { url: session.url, sessionId: session.id, mode: "stripe_live" as const };
  }

  async changeSubscription(input: BillingProviderSubscriptionChange) {
    const existing = await this.request(`subscriptions/${encodeURIComponent(input.subscriptionId)}`, {
      method: "GET",
    });
    const items = existing.items as { data?: Array<Record<string, unknown>> } | undefined;
    const item = items?.data?.[0];
    const price = item?.price as Record<string, unknown> | undefined;
    const product =
      typeof price?.product === "string" ? price.product : (price?.product as { id?: unknown } | undefined)?.id;
    if (typeof item?.id !== "string" || typeof product !== "string") {
      throw new Error("Stripe subscription has no replaceable subscription item.");
    }

    const promotionCodeId = input.promotionCode
      ? await this.resolvePromotionCode(input.promotionCode, input.customerId)
      : undefined;
    const stripeInterval = input.billingInterval === "yearly" ? "year" : "month";
    const body = new URLSearchParams({
      "items[0][id]": item.id,
      "items[0][price_data][currency]": input.currency.toLowerCase(),
      "items[0][price_data][product]": product,
      "items[0][price_data][recurring][interval]": stripeInterval,
      "items[0][price_data][unit_amount]": String(input.unitPriceCents),
      "items[0][quantity]": String(input.seats),
      proration_behavior: "always_invoice",
      payment_behavior: "pending_if_incomplete",
      "metadata[organizationId]": input.organizationId,
      "metadata[planId]": input.plan,
      "metadata[seats]": String(input.seats),
      "metadata[billingInterval]": input.billingInterval,
    });
    if (promotionCodeId) body.set("items[0][discounts][0][promotion_code]", promotionCodeId);
    const updated = await this.request(
      `subscriptions/${encodeURIComponent(input.subscriptionId)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      },
      input.idempotencyKey,
    );
    if (typeof updated.id !== "string") throw new Error("Stripe did not return the updated subscription.");
    return {
      url: input.returnUrl,
      sessionId: updated.id,
      mode: "stripe_update" as const,
      pendingUpdate: Boolean(updated.pending_update),
    };
  }
}

class SimulationBillingProvider implements BillingProviderAdapter {
  readonly provider = "internal" as const;

  async createCheckoutSession(input: BillingProviderCheckout) {
    const sessionId = `cs_sim_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    return {
      url: `${input.returnUrl}?session_id=${sessionId}&plan=${input.plan}&simulated=true`,
      sessionId,
      mode: "simulation" as const,
    };
  }

  async createPortalSession(input: BillingProviderPortal) {
    return {
      url: input.returnUrl,
      sessionId: `bps_sim_${Date.now()}`,
      mode: "simulation" as const,
    };
  }

  async changeSubscription(input: BillingProviderSubscriptionChange) {
    return {
      url: input.returnUrl,
      sessionId: input.subscriptionId,
      mode: "simulation" as const,
    };
  }
}

export function createBillingProvider(unitPriceCents: number): BillingProviderAdapter {
  const stripeSecret = process.env.STRIPE_SECRET_KEY;
  if (unitPriceCents > 0 && stripeSecret?.startsWith("sk_")) return new StripeBillingProvider(stripeSecret);
  if (process.env.NODE_ENV === "production" && unitPriceCents > 0) {
    throw new ServiceUnavailableException("Stripe checkout is not configured.");
  }
  return new SimulationBillingProvider();
}

export function createConfiguredStripeBillingProvider() {
  const stripeSecret = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecret?.startsWith("sk_")) throw new ServiceUnavailableException("Stripe billing is not configured.");
  return new StripeBillingProvider(stripeSecret);
}
