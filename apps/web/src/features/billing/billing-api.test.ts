import assert from "node:assert/strict";
import { afterEach, it } from "node:test";
import { createCheckoutSession, createCustomerPortalSession } from "./api";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  Reflect.deleteProperty(globalThis, "window");
});

it("sends promotion codes and portal requests through protected idempotent billing endpoints", async () => {
  Object.defineProperty(globalThis, "window", { value: {}, configurable: true });
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), init });
    if (String(url).endsWith("/auth/csrf")) return Response.json({ token: "csrf-billing-test" });
    return Response.json({ url: "https://billing.stripe.test/session", mode: "stripe_live" });
  }) as typeof fetch;

  await createCheckoutSession({
    organizationId: "organization-1",
    planId: "business",
    billingInterval: "monthly",
    seats: 8,
    returnUrl: "https://app.calmboard.test/?billing=success",
    promotionCode: "TEAM20",
  });
  await createCustomerPortalSession({
    organizationId: "organization-1",
    returnUrl: "https://app.calmboard.test/?billing=portal",
  });

  assert.match(requests[1]?.url ?? "", /\/billing\/checkout$/);
  assert.deepEqual(JSON.parse(String(requests[1]?.init?.body)), {
    organizationId: "organization-1",
    planId: "business",
    billingInterval: "monthly",
    seats: 8,
    returnUrl: "https://app.calmboard.test/?billing=success",
    promotionCode: "TEAM20",
  });
  assert.match(new Headers(requests[1]?.init?.headers).get("idempotency-key") ?? "", /^[0-9a-f-]{36}$/i);
  assert.equal(new Headers(requests[1]?.init?.headers).get("x-csrf-token"), "csrf-billing-test");
  assert.match(requests[2]?.url ?? "", /\/billing\/portal$/);
  assert.match(new Headers(requests[2]?.init?.headers).get("idempotency-key") ?? "", /^[0-9a-f-]{36}$/i);
});
