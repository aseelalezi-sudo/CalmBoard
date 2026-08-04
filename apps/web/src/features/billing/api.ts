import { apiServiceUrl, createIdempotencyKey, jsonRequest, requestJson } from "@/lib/client-api";

export type CheckoutResult = {
  url?: string;
  mode?: "stripe_live" | "stripe_update" | "simulation";
  pendingUpdate?: boolean;
};

export function createCheckoutSession(input: {
  organizationId: string;
  planId: string;
  billingInterval?: "monthly" | "yearly";
  seats: number;
  returnUrl: string;
  promotionCode?: string;
}) {
  return requestJson<CheckoutResult>(
    apiServiceUrl("/billing/checkout"),
    jsonRequest("POST", input, { "Idempotency-Key": createIdempotencyKey() }),
  );
}

export function createCustomerPortalSession(input: { organizationId: string; returnUrl: string }) {
  return requestJson<CheckoutResult>(
    apiServiceUrl("/billing/portal"),
    jsonRequest("POST", input, { "Idempotency-Key": createIdempotencyKey() }),
  );
}
