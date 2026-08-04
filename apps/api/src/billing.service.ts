import {
  createActivitiesRepository,
  createBillingRepository,
  type BillingInterval,
  type BillingPlan,
} from "@calmboard/database";
import { BadRequestException, ServiceUnavailableException } from "@nestjs/common";
import {
  BillingProviderInputError,
  createBillingProvider,
  createConfiguredStripeBillingProvider,
} from "./billing-provider.js";
export { verifyStripeWebhookSignature } from "./webhook-verification.js";

const plans = new Set<BillingPlan>(["free", "starter", "team", "business", "enterprise"]);
const billingIntervals = new Set<BillingInterval>(["monthly", "yearly"]);

export function parseBillingPlan(value: unknown): BillingPlan {
  if (typeof value === "string" && plans.has(value as BillingPlan)) return value as BillingPlan;
  throw new BadRequestException("planId must identify a supported billing plan");
}

export function parseBillingInterval(value: unknown): BillingInterval {
  if (value === undefined) return "monthly";
  if (typeof value === "string" && billingIntervals.has(value as BillingInterval)) return value as BillingInterval;
  throw new BadRequestException("billingInterval must be monthly or yearly");
}

export function parsePromotionCode(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(value.trim())) {
    throw new BadRequestException("promotionCode must contain 1 to 64 letters, numbers, underscores, or dashes");
  }
  return value.trim();
}

export function normalizeBillingReturnUrl(value: string, appUrl = process.env.APP_URL ?? "http://localhost:3000") {
  try {
    const allowedOrigin = new URL(appUrl).origin;
    const result = new URL(value, allowedOrigin);
    if (result.origin !== allowedOrigin || !/^https?:$/.test(result.protocol)) throw new Error("origin mismatch");
    return result.toString();
  } catch {
    throw new BadRequestException("returnUrl must use the configured application origin");
  }
}

export async function createCheckoutSession(input: {
  organizationId: string;
  plan: BillingPlan;
  billingInterval: BillingInterval;
  seats: number;
  returnUrl: string;
  idempotencyKey: string;
  promotionCode?: string;
}) {
  const repository = createBillingRepository({ organizationId: input.organizationId });
  const plan = await repository.getPlan(input.plan);
  const current = await repository.getCurrentSubscription();
  if (input.seats < plan.minSeats || input.seats > plan.maxSeats) {
    throw new BadRequestException(`seats must be between ${plan.minSeats} and ${plan.maxSeats} for ${plan.key}`);
  }
  const unitPriceCents = input.billingInterval === "yearly" ? plan.yearlyPriceCents : plan.monthlyPriceCents;
  const provider = createBillingProvider(unitPriceCents);
  const returnUrl = normalizeBillingReturnUrl(input.returnUrl);

  let checkout;
  try {
    const providerInput = {
      organizationId: input.organizationId,
      plan: input.plan,
      planName: plan.name,
      billingInterval: input.billingInterval,
      seats: input.seats,
      unitPriceCents,
      currency: plan.currency,
      returnUrl,
      idempotencyKey: input.idempotencyKey,
      promotionCode: input.promotionCode,
    };
    checkout =
      provider.provider === "stripe" &&
      current?.subscription.provider === "stripe" &&
      current.subscription.providerCustomerId &&
      current.subscription.providerSubscriptionId
        ? await provider.changeSubscription({
            ...providerInput,
            customerId: current.subscription.providerCustomerId,
            subscriptionId: current.subscription.providerSubscriptionId,
          })
        : await provider.createCheckoutSession(providerInput);
  } catch (error) {
    if (error instanceof BillingProviderInputError) throw new BadRequestException(error.message);
    if (process.env.NODE_ENV === "production") {
      throw new ServiceUnavailableException("Stripe checkout is temporarily unavailable.", { cause: error });
    }
    console.error("Stripe checkout failed; using development simulation:", error);
    checkout = await createBillingProvider(0).createCheckoutSession({
      organizationId: input.organizationId,
      plan: input.plan,
      planName: plan.name,
      billingInterval: input.billingInterval,
      seats: input.seats,
      unitPriceCents,
      currency: plan.currency,
      returnUrl,
      idempotencyKey: input.idempotencyKey,
      promotionCode: input.promotionCode,
    });
  }

  if (checkout.mode === "simulation") {
    await repository.updateSubscription(input.plan, input.seats, "checkout.session.completed", {
      billingInterval: input.billingInterval,
      provider: "internal",
    });
    await repository.createInvoice({
      number: `INV-${new Date().getFullYear()}-${Math.floor(Math.random() * 899 + 100)}`,
      amount: (unitPriceCents / 100) * input.seats,
      currency: plan.currency,
    });
  }
  return checkout;
}

export async function createCustomerPortalSession(input: {
  organizationId: string;
  returnUrl: string;
  idempotencyKey: string;
}) {
  const repository = createBillingRepository({ organizationId: input.organizationId });
  const current = await repository.getCurrentSubscription();
  if (
    !current ||
    current.subscription.provider !== "stripe" ||
    !current.subscription.providerCustomerId ||
    !current.subscription.providerSubscriptionId
  ) {
    throw new BadRequestException("The organization has no active Stripe subscription to manage.");
  }
  return createConfiguredStripeBillingProvider().createPortalSession({
    customerId: current.subscription.providerCustomerId,
    returnUrl: normalizeBillingReturnUrl(input.returnUrl),
    idempotencyKey: input.idempotencyKey,
  });
}

function dateFromUnixSeconds(value: unknown) {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1_000) : undefined;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function readStripeGracePeriodDays(env: NodeJS.ProcessEnv = process.env) {
  const days = Number(env.STRIPE_GRACE_PERIOD_DAYS ?? 7);
  if (!Number.isInteger(days) || days < 1 || days > 30) {
    throw new Error("STRIPE_GRACE_PERIOD_DAYS must be between 1 and 30");
  }
  return days;
}

function gracePeriodEnd(eventCreatedAt: Date) {
  return new Date(eventCreatedAt.getTime() + readStripeGracePeriodDays() * 24 * 60 * 60 * 1_000);
}

function stripeEventCreatedAt(event: Record<string, unknown>) {
  return dateFromUnixSeconds(event.created) ?? new Date();
}

export function stripeEventSubscriptionId(event: Record<string, unknown>) {
  const eventType = stringValue(event.type) ?? "";
  const object = objectValue(objectValue(event.data).object);
  const parentSubscription = objectValue(objectValue(object.parent).subscription_details);
  if (eventType.startsWith("customer.subscription.")) return stringValue(object.id);
  return stringValue(parentSubscription.subscription) ?? stringValue(object.subscription);
}

function stripeEventCustomerId(event: Record<string, unknown>) {
  const object = objectValue(objectValue(event.data).object);
  return stringValue(object.customer);
}

export function stripeEventOrganizationId(event: Record<string, unknown>) {
  const object = objectValue(objectValue(event.data).object);
  const parentSubscription = objectValue(objectValue(object.parent).subscription_details);
  const metadataSources = [
    objectValue(object.metadata),
    objectValue(parentSubscription.metadata),
    objectValue(objectValue(object.subscription_details).metadata),
  ];
  for (const metadata of metadataSources) {
    const organizationId = stringValue(metadata.organizationId);
    if (organizationId) return organizationId;
  }
  return stringValue(object.client_reference_id);
}

export async function applyStripeEvent(event: Record<string, unknown>) {
  const eventType = typeof event.type === "string" ? event.type : "checkout.session.completed";
  const object = objectValue(objectValue(event.data).object);
  const parentSubscription = objectValue(objectValue(object.parent).subscription_details);
  const metadata = {
    ...objectValue(objectValue(object.subscription_details).metadata),
    ...objectValue(parentSubscription.metadata),
    ...objectValue(object.metadata),
  };
  const organizationId = stripeEventOrganizationId(event);
  if (!organizationId) return eventType;
  const repository = createBillingRepository({ organizationId });
  const providerEventCreatedAt = stripeEventCreatedAt(event);
  const providerCustomerId = stripeEventCustomerId(event);
  const providerSubscriptionId = stripeEventSubscriptionId(event);
  if (eventType === "checkout.session.completed" || eventType === "customer.subscription.updated") {
    const stripeStatus = stringValue(object.status);
    if (
      eventType === "customer.subscription.updated" &&
      (stripeStatus === "canceled" || stripeStatus === "unpaid" || stripeStatus === "incomplete_expired")
    ) {
      await repository.applyLifecycleEvent({
        status: "canceled",
        providerEventCreatedAt,
        providerCustomerId,
        providerSubscriptionId,
        canceledAt: dateFromUnixSeconds(object.canceled_at),
        endedAt: dateFromUnixSeconds(object.ended_at),
      });
      return eventType;
    }
    const plan = parseBillingPlan(metadata.planId);
    const billingInterval = parseBillingInterval(metadata.billingInterval);
    const seats = Math.max(1, Math.round(Number(metadata.seats ?? 1)) || 1);
    const status =
      stripeStatus === "trialing" || stripeStatus === "paused" || stripeStatus === "incomplete"
        ? stripeStatus
        : stripeStatus === "past_due"
          ? "grace_period"
          : "active";
    const { organization, workspace, applied } = await repository.updateSubscription(plan, seats, eventType, {
      billingInterval,
      status,
      provider: "stripe",
      providerCustomerId,
      providerSubscriptionId,
      providerEventCreatedAt,
      currentPeriodStart: dateFromUnixSeconds(object.current_period_start),
      currentPeriodEnd: dateFromUnixSeconds(object.current_period_end),
      trialEndsAt: status === "trialing" ? dateFromUnixSeconds(object.trial_end) : null,
      gracePeriodEndsAt: status === "grace_period" ? gracePeriodEnd(providerEventCreatedAt) : null,
      cancelAtPeriodEnd: object.cancel_at_period_end === true,
    });
    if (applied && organization.ownerId && workspace) {
      await createActivitiesRepository({
        organizationId,
        workspaceId: workspace.id,
        actorId: organization.ownerId,
      }).create({
        actorId: organization.ownerId,
        action: "billing.subscription.updated",
        entityType: "subscription",
        entityId: organizationId,
        newValues: { plan, seats, billingInterval, eventType },
      });
    }
  } else if (eventType === "invoice.payment_failed") {
    await repository.applyLifecycleEvent({
      status: "grace_period",
      providerEventCreatedAt,
      providerCustomerId,
      providerSubscriptionId,
      gracePeriodEndsAt: gracePeriodEnd(providerEventCreatedAt),
    });
    await repository.createInvoice({
      number: stringValue(object.number) ?? stringValue(object.id) ?? `INV-${event.id}`,
      amount: Number(object.amount_due ?? 0) / 100,
      currency: stringValue(object.currency)?.toUpperCase() ?? "USD",
      status: "failed",
    });
  } else if (eventType === "invoice.payment_succeeded" || eventType === "invoice.paid") {
    await repository.applyLifecycleEvent({
      status: "active",
      providerEventCreatedAt,
      providerCustomerId,
      providerSubscriptionId,
    });
    await repository.createInvoice({
      number: stringValue(object.number) ?? stringValue(object.id) ?? `INV-${event.id}`,
      amount: Number(object.amount_paid ?? 0) / 100,
      currency: stringValue(object.currency)?.toUpperCase() ?? "USD",
      status: "paid",
    });
  } else if (eventType === "customer.subscription.deleted") {
    await repository.applyLifecycleEvent({
      status: "canceled",
      providerEventCreatedAt,
      providerCustomerId,
      providerSubscriptionId,
      canceledAt: dateFromUnixSeconds(object.canceled_at),
      endedAt: dateFromUnixSeconds(object.ended_at),
    });
  }
  return eventType;
}
