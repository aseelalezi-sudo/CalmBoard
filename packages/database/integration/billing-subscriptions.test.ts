import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import { and, eq, isNull } from "drizzle-orm";
import {
  createBillingRepository,
  db,
  invoices,
  organizations,
  pool,
  subscriptionPlans,
  subscriptions,
  usageLimits,
  workspaces,
} from "../src/index";

after(async () => {
  await pool.end();
});

describe("subscription plans and organization subscriptions", () => {
  it("keeps the relational subscription, compatibility projection, and usage limits consistent", async () => {
    const organizationId = randomUUID();
    const workspaceId = randomUUID();

    try {
      await db.insert(organizations).values({
        id: organizationId,
        name: "Billing integration tenant",
        slug: `billing-${organizationId}`,
        plan: "team",
        seats: 5,
      });
      await db.insert(workspaces).values({
        id: workspaceId,
        organizationId,
        name: "Billing workspace",
        slug: `billing-${workspaceId}`,
      });

      const repository = createBillingRepository({ organizationId });
      const catalog = await repository.listPlans();
      assert.deepEqual(
        catalog.map((plan) => plan.key),
        ["free", "starter", "team", "business", "enterprise"],
      );
      const initial = await repository.getCurrentSubscription();
      assert.equal(initial?.plan.key, "team");
      assert.equal(initial?.subscription.seats, 5);

      const updated = await repository.updateSubscription("business", 12, "integration.plan.changed", {
        billingInterval: "yearly",
        provider: "stripe",
        providerCustomerId: `cus_${organizationId}`,
        providerSubscriptionId: `sub_${organizationId}`,
      });
      assert.equal(updated.organization.plan, "business");
      assert.equal(updated.organization.seats, 12);
      assert.equal(updated.subscription.billingInterval, "yearly");
      assert.equal(updated.subscription.unitPriceCents, 16_000);
      assert.equal(updated.subscription.provider, "stripe");

      const [limits] = await db.select().from(usageLimits).where(eq(usageLimits.organizationId, organizationId));
      assert.equal(limits.maxSeats, 12);
      assert.equal(limits.maxProjects, 1_000);
      assert.equal(limits.maxTasks, 100_000);

      const currentSubscriptions = await db
        .select()
        .from(subscriptions)
        .where(and(eq(subscriptions.organizationId, organizationId), isNull(subscriptions.endedAt)));
      assert.equal(currentSubscriptions.length, 1);
      await assert.rejects(
        () => db.update(subscriptions).set({ seats: 101 }).where(eq(subscriptions.id, updated.subscription.id)),
        (error: unknown) =>
          (error as { cause?: { message?: string } }).cause?.message?.includes(
            "Subscription seats must be between 1 and 100",
          ) === true,
      );

      const businessPlan = catalog.find((plan) => plan.key === "business")!;
      await assert.rejects(
        () =>
          db.insert(subscriptions).values({
            organizationId,
            planId: businessPlan.id,
            seats: 12,
            unitPriceCents: businessPlan.monthlyPriceCents,
            currency: businessPlan.currency,
            currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1_000),
          }),
        (error: unknown) =>
          (error as { cause?: { constraint?: string } }).cause?.constraint ===
          "subscriptions_organization_current_unique",
      );

      await assert.rejects(() => repository.updateSubscription("free", 4), /seats must be between 1 and 3/);
      assert.equal(
        (
          await db
            .select({ id: subscriptionPlans.id })
            .from(subscriptionPlans)
            .where(eq(subscriptionPlans.isActive, true))
        ).length,
        5,
      );

      const failedAt = new Date("2026-08-01T10:00:00.000Z");
      const gracePeriodEndsAt = new Date("2026-08-08T10:00:00.000Z");
      const failed = await repository.applyLifecycleEvent({
        status: "grace_period",
        providerEventCreatedAt: failedAt,
        providerCustomerId: `cus_${organizationId}`,
        providerSubscriptionId: `sub_${organizationId}`,
        gracePeriodEndsAt,
      });
      assert.equal(failed.applied, true);
      assert.equal(failed.subscription?.status, "grace_period");
      assert.equal(failed.subscription?.gracePeriodEndsAt?.toISOString(), gracePeriodEndsAt.toISOString());

      const staleSubscriptionUpdate = await repository.updateSubscription(
        "business",
        12,
        "customer.subscription.updated",
        {
          status: "active",
          providerEventCreatedAt: new Date("2026-08-01T09:59:58.000Z"),
        },
      );
      assert.equal(staleSubscriptionUpdate.applied, false);
      assert.equal(staleSubscriptionUpdate.subscription.status, "grace_period");

      const stale = await repository.applyLifecycleEvent({
        status: "active",
        providerEventCreatedAt: new Date("2026-08-01T09:59:59.000Z"),
        providerSubscriptionId: `sub_${organizationId}`,
      });
      assert.equal(stale.applied, false);
      assert.equal(stale.subscription?.status, "grace_period");

      await repository.createInvoice({ number: "INV-LIFECYCLE", amount: 160, currency: "USD", status: "failed" });
      await repository.createInvoice({ number: "INV-LIFECYCLE", amount: 160, currency: "USD", status: "paid" });
      const storedInvoices = await db
        .select()
        .from(invoices)
        .where(and(eq(invoices.organizationId, organizationId), eq(invoices.number, "INV-LIFECYCLE")));
      assert.equal(storedInvoices.length, 1);
      assert.equal(storedInvoices[0]?.status, "paid");

      const recovered = await repository.applyLifecycleEvent({
        status: "active",
        providerEventCreatedAt: new Date("2026-08-01T10:01:00.000Z"),
        providerSubscriptionId: `sub_${organizationId}`,
      });
      assert.equal(recovered.applied, true);
      assert.equal(recovered.subscription?.status, "active");
      assert.equal(recovered.subscription?.gracePeriodEndsAt, null);

      const canceled = await repository.applyLifecycleEvent({
        status: "canceled",
        providerEventCreatedAt: new Date("2026-08-01T10:02:00.000Z"),
        providerSubscriptionId: `sub_${organizationId}`,
      });
      assert.equal(canceled.applied, true);
      assert.ok(canceled.subscription?.endedAt);
      assert.equal(await repository.getCurrentSubscription(), null);

      const [downgradedOrganization] = await db
        .select()
        .from(organizations)
        .where(eq(organizations.id, organizationId));
      const [downgradedLimits] = await db
        .select()
        .from(usageLimits)
        .where(eq(usageLimits.organizationId, organizationId));
      assert.equal(downgradedOrganization.plan, "free");
      assert.equal(downgradedOrganization.seats, 3);
      assert.equal(downgradedLimits.maxSeats, 3);
    } finally {
      await db
        .delete(invoices)
        .where(eq(invoices.organizationId, organizationId))
        .catch(() => undefined);
      await db
        .delete(workspaces)
        .where(eq(workspaces.organizationId, organizationId))
        .catch(() => undefined);
      await db
        .delete(subscriptions)
        .where(eq(subscriptions.organizationId, organizationId))
        .catch(() => undefined);
      await db
        .delete(usageLimits)
        .where(eq(usageLimits.organizationId, organizationId))
        .catch(() => undefined);
      await db
        .delete(organizations)
        .where(eq(organizations.id, organizationId))
        .catch(() => undefined);
    }
  });
});
