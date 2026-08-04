import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { createSecurityEventsRepository, db, pool, securityEvents } from "../src/index";

after(async () => {
  await pool.end();
});

describe("append-only security events", () => {
  it("hashes login identities, removes secret metadata, and rejects mutation", async () => {
    const repository = createSecurityEventsRepository();
    const userId = randomUUID();
    const event = await repository.record({
      userId,
      email: "Security-Audit@Example.test",
      eventType: "login_password",
      outcome: "failure",
      ip: "203.0.113.50",
      userAgent: "Security integration test",
      metadata: { reason: "invalid_password", password: "must-not-persist", accessToken: "must-not-persist" },
    });
    assert.match(event.emailHash ?? "", /^[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(event).includes("security-audit@example.test"), false);
    assert.deepEqual(event.metadata, { reason: "invalid_password" });

    await assert.rejects(
      () => db.update(securityEvents).set({ outcome: "success" }).where(eq(securityEvents.id, event.id)),
      (error: unknown) => (error as { cause?: { code?: string } }).cause?.code === "P0001",
    );
    await assert.rejects(
      () => db.delete(securityEvents).where(eq(securityEvents.id, event.id)),
      (error: unknown) => (error as { cause?: { code?: string } }).cause?.code === "P0001",
    );
  });
});
