import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "../client.js";
import { TenantResourceNotFoundError } from "../errors.js";
import { invoices, organizations, subscriptionPlans, subscriptions, workspaces } from "../schema.js";
import { assertTenantContext, type DatabaseTenantContext } from "../tenant-context.js";

export type BillingPlan = "free" | "starter" | "team" | "business" | "enterprise";
export type BillingInterval = "monthly" | "yearly";
export type SubscriptionStatus =
  "trialing" | "active" | "past_due" | "grace_period" | "paused" | "canceled" | "incomplete";

export type SubscriptionUpdateOptions = {
  billingInterval?: BillingInterval;
  status?: Exclude<SubscriptionStatus, "canceled">;
  provider?: string;
  providerCustomerId?: string | null;
  providerSubscriptionId?: string | null;
  providerEventCreatedAt?: Date;
  currentPeriodStart?: Date;
  currentPeriodEnd?: Date;
  trialEndsAt?: Date | null;
  gracePeriodEndsAt?: Date | null;
  cancelAtPeriodEnd?: boolean;
};

export type SubscriptionLifecycleEvent = {
  status: SubscriptionStatus;
  providerEventCreatedAt: Date;
  providerCustomerId?: string;
  providerSubscriptionId?: string;
  gracePeriodEndsAt?: Date;
  canceledAt?: Date;
  endedAt?: Date;
};

function nextPeriod(start: Date, interval: BillingInterval) {
  const end = new Date(start);
  if (interval === "yearly") end.setUTCFullYear(end.getUTCFullYear() + 1);
  else end.setUTCMonth(end.getUTCMonth() + 1);
  return end;
}

export function createBillingRepository(context: DatabaseTenantContext) {
  assertTenantContext(context);
  const { organizationId } = context;

  async function requireOrganization() {
    const [organization] = await db
      .select()
      .from(organizations)
      .where(and(eq(organizations.id, organizationId), isNull(organizations.deletedAt)))
      .limit(1);
    if (!organization) throw new TenantResourceNotFoundError("organization");
    return organization;
  }

  return {
    async listPlans() {
      await requireOrganization();
      return db
        .select()
        .from(subscriptionPlans)
        .where(and(eq(subscriptionPlans.isActive, true), eq(subscriptionPlans.isPublic, true)))
        .orderBy(asc(subscriptionPlans.sortOrder));
    },

    async getPlan(plan: BillingPlan) {
      await requireOrganization();
      const [selectedPlan] = await db
        .select()
        .from(subscriptionPlans)
        .where(and(eq(subscriptionPlans.key, plan), eq(subscriptionPlans.isActive, true)))
        .limit(1);
      if (!selectedPlan) throw new TenantResourceNotFoundError("subscription plan");
      return selectedPlan;
    },

    async getCurrentSubscription() {
      await requireOrganization();
      const [current] = await db
        .select({ subscription: subscriptions, plan: subscriptionPlans })
        .from(subscriptions)
        .innerJoin(subscriptionPlans, eq(subscriptionPlans.id, subscriptions.planId))
        .where(and(eq(subscriptions.organizationId, organizationId), isNull(subscriptions.endedAt)))
        .limit(1);
      return current ?? null;
    },

    async updateSubscription(
      plan: BillingPlan,
      seats: number,
      eventType = "checkout.session.completed",
      options: SubscriptionUpdateOptions = {},
    ) {
      if (!Number.isSafeInteger(seats) || seats <= 0) throw new Error("seats must be a positive integer");

      return db.transaction(async (transaction) => {
        const [existingOrganization] = await transaction
          .select()
          .from(organizations)
          .where(and(eq(organizations.id, organizationId), isNull(organizations.deletedAt)))
          .limit(1);
        if (!existingOrganization) throw new TenantResourceNotFoundError("organization");

        const [selectedPlan] = await transaction
          .select()
          .from(subscriptionPlans)
          .where(and(eq(subscriptionPlans.key, plan), eq(subscriptionPlans.isActive, true)))
          .limit(1);
        if (!selectedPlan) throw new TenantResourceNotFoundError("subscription plan");
        if (seats < selectedPlan.minSeats || seats > selectedPlan.maxSeats) {
          throw new Error(`seats must be between ${selectedPlan.minSeats} and ${selectedPlan.maxSeats} for ${plan}`);
        }

        const [current] = await transaction
          .select()
          .from(subscriptions)
          .where(and(eq(subscriptions.organizationId, organizationId), isNull(subscriptions.endedAt)))
          .limit(1);
        if (
          current?.providerEventCreatedAt &&
          options.providerEventCreatedAt &&
          current.providerEventCreatedAt > options.providerEventCreatedAt
        ) {
          const [currentPlan] = await transaction
            .select()
            .from(subscriptionPlans)
            .where(eq(subscriptionPlans.id, current.planId))
            .limit(1);
          const [workspace] = await transaction
            .select()
            .from(workspaces)
            .where(eq(workspaces.organizationId, organizationId))
            .limit(1);
          return {
            organization: existingOrganization,
            workspace: workspace ?? null,
            subscription: current,
            plan: currentPlan,
            eventType,
            applied: false,
          };
        }
        const billingInterval = options.billingInterval ?? current?.billingInterval ?? "monthly";
        const periodStart = options.currentPeriodStart ?? current?.currentPeriodStart ?? new Date();
        const periodEnd =
          options.currentPeriodEnd ?? current?.currentPeriodEnd ?? nextPeriod(periodStart, billingInterval);
        const status = options.status ?? "active";
        const values = {
          planId: selectedPlan.id,
          status,
          billingInterval,
          seats,
          unitPriceCents: billingInterval === "yearly" ? selectedPlan.yearlyPriceCents : selectedPlan.monthlyPriceCents,
          currency: selectedPlan.currency,
          provider: options.provider ?? current?.provider ?? "internal",
          providerCustomerId: options.providerCustomerId ?? current?.providerCustomerId ?? null,
          providerSubscriptionId: options.providerSubscriptionId ?? current?.providerSubscriptionId ?? null,
          providerEventCreatedAt: options.providerEventCreatedAt ?? current?.providerEventCreatedAt ?? null,
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd,
          trialEndsAt: options.trialEndsAt ?? current?.trialEndsAt ?? null,
          gracePeriodEndsAt:
            options.gracePeriodEndsAt !== undefined ? options.gracePeriodEndsAt : (current?.gracePeriodEndsAt ?? null),
          cancelAtPeriodEnd: options.cancelAtPeriodEnd ?? current?.cancelAtPeriodEnd ?? false,
          updatedAt: new Date(),
        };

        const [subscription] = current
          ? await transaction.update(subscriptions).set(values).where(eq(subscriptions.id, current.id)).returning()
          : await transaction
              .insert(subscriptions)
              .values({ organizationId, ...values })
              .returning();

        const [organization] = await transaction
          .select()
          .from(organizations)
          .where(eq(organizations.id, organizationId))
          .limit(1);
        const [workspace] = await transaction
          .select()
          .from(workspaces)
          .where(eq(workspaces.organizationId, organizationId))
          .limit(1);
        return {
          organization,
          workspace: workspace ?? null,
          subscription,
          plan: selectedPlan,
          eventType,
          applied: true,
        };
      });
    },

    async applyLifecycleEvent(input: SubscriptionLifecycleEvent) {
      if (!Number.isFinite(input.providerEventCreatedAt.getTime())) throw new Error("provider event time is invalid");
      if (input.status === "grace_period" && !input.gracePeriodEndsAt) {
        throw new Error("gracePeriodEndsAt is required for a grace period");
      }

      return db.transaction(async (transaction) => {
        const [current] = await transaction
          .select()
          .from(subscriptions)
          .where(and(eq(subscriptions.organizationId, organizationId), isNull(subscriptions.endedAt)))
          .limit(1)
          .for("update");
        if (!current) return { applied: false, subscription: null };
        if (
          (input.providerSubscriptionId &&
            current.providerSubscriptionId &&
            input.providerSubscriptionId !== current.providerSubscriptionId) ||
          (input.providerCustomerId &&
            current.providerCustomerId &&
            input.providerCustomerId !== current.providerCustomerId)
        ) {
          throw new TenantResourceNotFoundError("provider subscription");
        }
        if (current.providerEventCreatedAt && current.providerEventCreatedAt > input.providerEventCreatedAt) {
          return { applied: false, subscription: current };
        }

        const canceled = input.status === "canceled";
        const [subscription] = await transaction
          .update(subscriptions)
          .set({
            status: input.status,
            providerCustomerId: input.providerCustomerId ?? current.providerCustomerId,
            providerSubscriptionId: input.providerSubscriptionId ?? current.providerSubscriptionId,
            providerEventCreatedAt: input.providerEventCreatedAt,
            gracePeriodEndsAt: input.status === "grace_period" ? input.gracePeriodEndsAt : null,
            cancelAtPeriodEnd: canceled ? false : current.cancelAtPeriodEnd,
            canceledAt: canceled ? (input.canceledAt ?? input.providerEventCreatedAt) : null,
            endedAt: canceled ? (input.endedAt ?? input.canceledAt ?? input.providerEventCreatedAt) : null,
            updatedAt: new Date(),
          })
          .where(eq(subscriptions.id, current.id))
          .returning();
        return { applied: true, subscription };
      });
    },

    async createInvoice(input: { number: string; amount: number; currency: string; status?: string }) {
      await requireOrganization();
      const [invoice] = await db
        .insert(invoices)
        .values({
          organizationId,
          number: input.number,
          amount: input.amount,
          currency: input.currency,
          status: input.status ?? "paid",
          periodStart: new Date(),
          periodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1_000),
        })
        .onConflictDoUpdate({
          target: [invoices.organizationId, invoices.number],
          set: {
            amount: input.amount,
            currency: input.currency,
            status: input.status ?? "paid",
          },
        })
        .returning();
      return invoice;
    },
  };
}
