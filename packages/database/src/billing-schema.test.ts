import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getTableColumns } from "drizzle-orm";
import { aiUsageEvents, aiUsagePeriods, subscriptionPlans, subscriptions, usageLimits } from "./schema.js";

describe("billing subscription schema", () => {
  it("stores a reusable plan catalog with prices, limits, and feature flags", () => {
    const columns = getTableColumns(subscriptionPlans);
    assert.equal(columns.key.notNull, true);
    assert.equal(columns.monthlyPriceCents.notNull, true);
    assert.equal(columns.yearlyPriceCents.notNull, true);
    assert.equal(columns.maxSeats.notNull, true);
    assert.equal(columns.maxProjects.notNull, true);
    assert.equal(columns.maxTasks.notNull, true);
    assert.equal(columns.maxStorageMb.notNull, true);
    assert.equal(columns.maxAiRequestsPerMonth.notNull, true);
    assert.equal(columns.maxAiTokensPerMonth.notNull, true);
    assert.equal(columns.features.notNull, true);
    assert.equal(columns.isActive.notNull, true);
  });

  it("stores subscription lifecycle and provider references separately from organizations", () => {
    const columns = getTableColumns(subscriptions);
    assert.equal(columns.organizationId.notNull, true);
    assert.equal(columns.planId.notNull, true);
    assert.equal(columns.status.notNull, true);
    assert.equal(columns.billingInterval.notNull, true);
    assert.equal(columns.unitPriceCents.notNull, true);
    assert.equal(columns.currentPeriodStart.notNull, true);
    assert.equal(columns.currentPeriodEnd.notNull, true);
    assert.equal(columns.providerSubscriptionId.notNull, false);
    assert.equal(columns.providerEventCreatedAt.notNull, false);
    assert.equal(columns.gracePeriodEndsAt.notNull, false);
    assert.equal(columns.canceledAt.notNull, false);
    assert.equal(columns.endedAt.notNull, false);
  });

  it("stores current server-enforced usage beside each organization limit", () => {
    const columns = getTableColumns(usageLimits);
    assert.equal(columns.currentSeats.notNull, true);
    assert.equal(columns.currentProjects.notNull, true);
    assert.equal(columns.currentTasks.notNull, true);
    assert.equal(columns.currentStorageBytes.notNull, true);
    assert.equal(columns.maxAiRequestsPerMonth.notNull, true);
    assert.equal(columns.maxAiTokensPerMonth.notNull, true);
  });

  it("stores monthly AI totals and content-free request accounting", () => {
    const periodColumns = getTableColumns(aiUsagePeriods);
    assert.equal(periodColumns.organizationId.notNull, true);
    assert.equal(periodColumns.requestCount.notNull, true);
    assert.equal(periodColumns.reservedTokens.notNull, true);
    assert.equal(periodColumns.inputTokens.notNull, true);
    assert.equal(periodColumns.outputTokens.notNull, true);
    assert.equal(periodColumns.estimatedCostMicrousd.notNull, true);

    const eventColumns = getTableColumns(aiUsageEvents);
    assert.equal(eventColumns.organizationId.notNull, true);
    assert.equal(eventColumns.workspaceId.notNull, true);
    assert.equal(eventColumns.actorId.notNull, true);
    assert.equal(eventColumns.action.notNull, true);
    assert.equal(eventColumns.provider.notNull, false);
    assert.equal(eventColumns.model.notNull, false);
    assert.equal("prompt" in eventColumns, false);
    assert.equal("response" in eventColumns, false);
  });
});
