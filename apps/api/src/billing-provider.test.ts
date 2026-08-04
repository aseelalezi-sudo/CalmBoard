import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { BillingProviderInputError, StripeBillingProvider } from "./billing-provider.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function baseCheckout() {
  return {
    organizationId: "11111111-1111-4111-8111-111111111111",
    plan: "business" as const,
    planName: "Business",
    billingInterval: "monthly" as const,
    seats: 8,
    unitPriceCents: 1_600,
    currency: "USD",
    returnUrl: "https://app.calmboard.test/?billing=success",
    idempotencyKey: "billing-test-key",
  };
}

describe("Stripe billing provider", () => {
  it("creates Checkout with Stripe-managed promotion-code entry", async () => {
    let submitted: URLSearchParams | undefined;
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      submitted = init?.body as URLSearchParams;
      return Response.json({ id: "cs_test", url: "https://checkout.stripe.test/session" });
    }) as typeof fetch;

    const result = await new StripeBillingProvider("sk_test_secret").createCheckoutSession(baseCheckout());

    assert.equal(result.mode, "stripe_live");
    assert.equal(submitted?.get("allow_promotion_codes"), "true");
    assert.equal(submitted?.get("line_items[0][quantity]"), "8");
  });

  it("resolves an entered coupon and sends its promotion-code ID to Checkout", async () => {
    const requests: Array<{ url: string; body?: URLSearchParams }> = [];
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), body: init?.body as URLSearchParams | undefined });
      if (String(url).includes("promotion_codes?")) return Response.json({ data: [{ id: "promo_team20" }] });
      return Response.json({ id: "cs_test", url: "https://checkout.stripe.test/session" });
    }) as typeof fetch;

    await new StripeBillingProvider("sk_test_secret").createCheckoutSession({
      ...baseCheckout(),
      promotionCode: "TEAM20",
    });

    assert.match(requests[0]?.url ?? "", /promotion_codes\?/);
    assert.equal(requests[1]?.body?.get("discounts[0][promotion_code]"), "promo_team20");
    assert.equal(requests[1]?.body?.has("allow_promotion_codes"), false);
  });

  it("updates the existing subscription item with proration and pending payment semantics", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), init });
      if (init?.method === "GET" && String(url).includes("/subscriptions/")) {
        return Response.json({ items: { data: [{ id: "si_existing", price: { product: "prod_calmboard" } }] } });
      }
      if (String(url).includes("promotion_codes?")) return Response.json({ data: [{ id: "promo_upgrade" }] });
      return Response.json({ id: "sub_existing", pending_update: { expires_at: 1_800_000_000 } });
    }) as typeof fetch;

    const result = await new StripeBillingProvider("sk_test_secret").changeSubscription({
      ...baseCheckout(),
      customerId: "cus_existing",
      subscriptionId: "sub_existing",
      promotionCode: "UPGRADE",
    });

    const update = requests.at(-1)?.init;
    const body = update?.body as URLSearchParams;
    assert.equal(body.get("items[0][id]"), "si_existing");
    assert.equal(body.get("items[0][price_data][product]"), "prod_calmboard");
    assert.equal(body.get("items[0][quantity]"), "8");
    assert.equal(body.get("proration_behavior"), "always_invoice");
    assert.equal(body.get("payment_behavior"), "pending_if_incomplete");
    assert.equal(body.get("items[0][discounts][0][promotion_code]"), "promo_upgrade");
    assert.equal(new Headers(update?.headers).get("idempotency-key"), "billing-test-key");
    assert.equal(result.mode, "stripe_update");
    assert.equal(result.pendingUpdate, true);
  });

  it("creates a customer portal session for the existing Stripe customer", async () => {
    let submitted: URLSearchParams | undefined;
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      submitted = init?.body as URLSearchParams;
      return Response.json({ id: "bps_test", url: "https://billing.stripe.test/session" });
    }) as typeof fetch;

    const result = await new StripeBillingProvider("sk_test_secret").createPortalSession({
      customerId: "cus_existing",
      returnUrl: "https://app.calmboard.test/?billing=portal",
      idempotencyKey: "portal-test-key",
    });

    assert.equal(submitted?.get("customer"), "cus_existing");
    assert.equal(submitted?.get("return_url"), "https://app.calmboard.test/?billing=portal");
    assert.equal(result.mode, "stripe_live");
  });

  it("classifies Stripe validation failures as safe client input errors", async () => {
    globalThis.fetch = (async () =>
      Response.json({ error: { message: "provider detail" } }, { status: 400 })) as typeof fetch;

    await assert.rejects(
      () => new StripeBillingProvider("sk_test_secret").createCheckoutSession(baseCheckout()),
      (error: unknown) =>
        error instanceof BillingProviderInputError &&
        error.message === "Stripe rejected the billing details or promotion code.",
    );
  });
});
