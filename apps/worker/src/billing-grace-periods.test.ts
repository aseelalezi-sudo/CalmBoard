import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { Pool } from "pg";
import { expireBillingGracePeriods, readBillingGracePeriodOptions } from "./billing-grace-periods.js";

describe("billing grace-period worker", () => {
  it("validates a bounded batch size", () => {
    assert.deepEqual(readBillingGracePeriodOptions({ BILLING_GRACE_PERIOD_BATCH_SIZE: "25" }), { batchSize: 25 });
    assert.throws(() => readBillingGracePeriodOptions({ BILLING_GRACE_PERIOD_BATCH_SIZE: "0" }), /between 1 and 500/);
  });

  it("claims only expired grace periods with skip-locked", async () => {
    let statement = "";
    const pool = {
      async query(sql: string) {
        statement = sql;
        return { rowCount: 0, rows: [] };
      },
    } as unknown as Pool;
    assert.deepEqual(await expireBillingGracePeriods(pool, { batchSize: 20 }), { expired: 0, subscriptions: [] });
    assert.match(statement, /grace_period_ends_at <= now\(\)/);
    assert.match(statement, /for update skip locked/);
    assert.match(statement, /status = 'canceled'/);
  });

  it(
    "expires a grace period once and restores free entitlements",
    { skip: !process.env.DATABASE_MAINTENANCE_URL },
    async () => {
      const pool = new Pool({ connectionString: process.env.DATABASE_MAINTENANCE_URL, max: 4 });
      const organizationId = randomUUID();
      try {
        await pool.query("insert into organizations (id, name, slug) values ($1, 'Grace tenant', $2)", [
          organizationId,
          `grace-${organizationId}`,
        ]);
        await pool.query(
          `update subscriptions
         set status = 'grace_period', grace_period_ends_at = now() - interval '1 minute'
         where organization_id = $1 and ended_at is null`,
          [organizationId],
        );

        assert.equal((await expireBillingGracePeriods(pool, { batchSize: 25 })).expired, 1);
        assert.equal((await expireBillingGracePeriods(pool, { batchSize: 25 })).expired, 0);

        const state = await pool.query<{
          status: string;
          ended_at: Date | null;
          plan: string;
          seats: number;
          max_seats: number;
        }>(
          `select subscription.status, subscription.ended_at, organization.plan, organization.seats,
           limits.max_seats
         from subscriptions subscription
         join organizations organization on organization.id = subscription.organization_id
         join usage_limits limits on limits.organization_id = organization.id
         where subscription.organization_id = $1
         order by subscription.created_at desc limit 1`,
          [organizationId],
        );
        assert.equal(state.rows[0]?.status, "canceled");
        assert.ok(state.rows[0]?.ended_at);
        assert.equal(state.rows[0]?.plan, "free");
        assert.equal(state.rows[0]?.seats, 3);
        assert.equal(state.rows[0]?.max_seats, 3);
      } finally {
        await pool.query("delete from subscriptions where organization_id = $1", [organizationId]);
        await pool.query("delete from usage_limits where organization_id = $1", [organizationId]);
        await pool.query("delete from organizations where id = $1", [organizationId]);
        await pool.end();
      }
    },
  );
});
