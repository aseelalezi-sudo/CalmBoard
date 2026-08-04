import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import {
  AIUsageLimitExceededError,
  aiUsageEvents,
  aiUsagePeriods,
  createAIUsageRepository,
  db,
  organizations,
  pool,
  usageLimits,
  users,
  withDatabaseContext,
  workspaces,
  type AIUsageReservation,
  type DatabaseTenantContext,
} from "../src/index";

after(async () => {
  await pool.end();
});

async function tenantFixture(label: string) {
  const actorId = randomUUID();
  const organizationId = randomUUID();
  const workspaceId = randomUUID();
  await db.insert(users).values({
    id: actorId,
    name: `${label} owner`,
    email: `ai-usage-${actorId}@example.test`,
    passwordHash: "integration-test-hash",
  });
  await db.insert(organizations).values({
    id: organizationId,
    name: `${label} organization`,
    slug: `ai-usage-${organizationId}`,
    ownerId: actorId,
    plan: "team",
    seats: 1,
  });
  await db.insert(workspaces).values({
    id: workspaceId,
    organizationId,
    name: `${label} workspace`,
    slug: `ai-usage-${workspaceId}`,
  });
  await db
    .update(usageLimits)
    .set({ maxAiRequestsPerMonth: 2, maxAiTokensPerMonth: 100 })
    .where(eq(usageLimits.organizationId, organizationId));
  return { organizationId, workspaceId, actorId } satisfies DatabaseTenantContext & { actorId: string };
}

async function cleanup(contexts: DatabaseTenantContext[]) {
  for (const context of contexts) {
    await db
      .delete(organizations)
      .where(eq(organizations.id, context.organizationId))
      .catch(() => undefined);
    if (context.actorId)
      await db
        .delete(users)
        .where(eq(users.id, context.actorId))
        .catch(() => undefined);
  }
}

describe("monthly AI usage accounting", () => {
  it("reserves concurrent requests atomically, settles cost, and isolates tenants", async () => {
    const first = await tenantFixture("First AI tenant");
    const second = await tenantFixture("Second AI tenant");

    try {
      const attempts = await Promise.allSettled(
        [1, 2].map(() => withDatabaseContext(first, () => createAIUsageRepository(first).reserve("summarize", 60))),
      );
      const fulfilled = attempts.find(
        (attempt): attempt is PromiseFulfilledResult<AIUsageReservation> => attempt.status === "fulfilled",
      );
      const rejected = attempts.find((attempt) => attempt.status === "rejected");
      assert.ok(fulfilled);
      assert.ok(rejected?.status === "rejected");
      assert.ok(rejected.reason instanceof AIUsageLimitExceededError);
      assert.equal(rejected.reason.resource, "tokens");

      await withDatabaseContext(first, () =>
        createAIUsageRepository(first).complete(
          fulfilled.value,
          { inputTokens: 10, outputTokens: 5, estimatedCostMicrousd: 30 },
          "openai",
          "integration-model",
        ),
      );

      const failedReservation = await withDatabaseContext(first, () =>
        createAIUsageRepository(first).reserve("report", 60),
      );
      await withDatabaseContext(first, () => createAIUsageRepository(first).fail(failedReservation, "provider_failed"));
      await assert.rejects(
        () => withDatabaseContext(first, () => createAIUsageRepository(first).reserve("priority", 1)),
        (error: unknown) => error instanceof AIUsageLimitExceededError && error.resource === "requests",
      );

      const secondReservation = await withDatabaseContext(second, () =>
        createAIUsageRepository(second).reserve("priority", 10),
      );
      await withDatabaseContext(second, () =>
        createAIUsageRepository(second).fail(secondReservation, "provider_failed"),
      );

      const firstSnapshot = await withDatabaseContext(first, async () => {
        const periods = await db
          .select()
          .from(aiUsagePeriods)
          .where(eq(aiUsagePeriods.organizationId, first.organizationId));
        const events = await db
          .select()
          .from(aiUsageEvents)
          .where(eq(aiUsageEvents.organizationId, first.organizationId));
        return { periods, events };
      });
      assert.equal(firstSnapshot.periods.length, 1);
      assert.equal(firstSnapshot.periods[0]?.requestCount, 2);
      assert.equal(firstSnapshot.periods[0]?.reservedTokens, 0);
      assert.equal(firstSnapshot.periods[0]?.inputTokens, 10);
      assert.equal(firstSnapshot.periods[0]?.outputTokens, 5);
      assert.equal(firstSnapshot.periods[0]?.estimatedCostMicrousd, 30);
      assert.deepEqual(firstSnapshot.events.map((event) => event.status).sort(), ["completed", "failed"]);
      assert.ok(firstSnapshot.events.every((event) => event.organizationId === first.organizationId));

      const secondEvents = await withDatabaseContext(second, () =>
        db.select().from(aiUsageEvents).where(eq(aiUsageEvents.organizationId, second.organizationId)),
      );
      assert.equal(secondEvents.length, 1);
      assert.equal(secondEvents[0]?.organizationId, second.organizationId);
    } finally {
      await cleanup([first, second]);
    }
  });
});
