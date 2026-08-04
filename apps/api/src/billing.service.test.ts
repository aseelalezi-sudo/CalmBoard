import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  normalizeBillingReturnUrl,
  parsePromotionCode,
  readStripeGracePeriodDays,
  stripeEventOrganizationId,
  stripeEventSubscriptionId,
} from "./billing.service.js";

describe("Stripe subscription lifecycle input", () => {
  it("reads current invoice parent metadata and subscription identity", () => {
    const event = {
      type: "invoice.payment_failed",
      data: {
        object: {
          customer: "cus_123",
          parent: {
            type: "subscription_details",
            subscription_details: {
              subscription: "sub_123",
              metadata: { organizationId: "11111111-1111-4111-8111-111111111111" },
            },
          },
        },
      },
    };
    assert.equal(stripeEventOrganizationId(event), "11111111-1111-4111-8111-111111111111");
    assert.equal(stripeEventSubscriptionId(event), "sub_123");
  });

  it("keeps compatibility with pre-Basil invoice metadata", () => {
    const event = {
      type: "invoice.payment_succeeded",
      data: {
        object: {
          subscription: "sub_legacy",
          subscription_details: { metadata: { organizationId: "22222222-2222-4222-8222-222222222222" } },
        },
      },
    };
    assert.equal(stripeEventOrganizationId(event), "22222222-2222-4222-8222-222222222222");
    assert.equal(stripeEventSubscriptionId(event), "sub_legacy");
  });

  it("uses the subscription object identity for cancellation events", () => {
    const event = {
      type: "customer.subscription.deleted",
      data: { object: { id: "sub_deleted", metadata: { organizationId: "organization-1" } } },
    };
    assert.equal(stripeEventOrganizationId(event), "organization-1");
    assert.equal(stripeEventSubscriptionId(event), "sub_deleted");
  });

  it("bounds the configured grace period", () => {
    assert.equal(readStripeGracePeriodDays({}), 7);
    assert.equal(readStripeGracePeriodDays({ STRIPE_GRACE_PERIOD_DAYS: "14" }), 14);
    assert.throws(() => readStripeGracePeriodDays({ STRIPE_GRACE_PERIOD_DAYS: "0" }), /between 1 and 30/);
    assert.throws(() => readStripeGracePeriodDays({ STRIPE_GRACE_PERIOD_DAYS: "31" }), /between 1 and 30/);
  });

  it("normalizes billing return URLs to the configured application origin", () => {
    assert.equal(
      normalizeBillingReturnUrl("/settings?tab=billing", "https://app.calmboard.test"),
      "https://app.calmboard.test/settings?tab=billing",
    );
    assert.equal(
      normalizeBillingReturnUrl("https://app.calmboard.test/billing", "https://app.calmboard.test"),
      "https://app.calmboard.test/billing",
    );
    assert.throws(
      () => normalizeBillingReturnUrl("https://attacker.test/redirect", "https://app.calmboard.test"),
      /configured application origin/,
    );
  });

  it("accepts bounded promotion codes and rejects malformed input", () => {
    assert.equal(parsePromotionCode(" TEAM_20 "), "TEAM_20");
    assert.equal(parsePromotionCode(""), undefined);
    assert.throws(() => parsePromotionCode("TEAM 20"), /promotionCode/);
    assert.throws(() => parsePromotionCode("A".repeat(65)), /promotionCode/);
  });
});
