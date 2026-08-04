import type { Pool } from "pg";

export const billingGracePeriodJobName = "billing.expire-grace-periods";

export type BillingGracePeriodOptions = {
  batchSize: number;
};

export function readBillingGracePeriodOptions(env: NodeJS.ProcessEnv = process.env): BillingGracePeriodOptions {
  const batchSize = Number(env.BILLING_GRACE_PERIOD_BATCH_SIZE ?? 100);
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500) {
    throw new Error("BILLING_GRACE_PERIOD_BATCH_SIZE must be between 1 and 500");
  }
  return { batchSize };
}

export async function expireBillingGracePeriods(
  pool: Pool,
  options: BillingGracePeriodOptions = readBillingGracePeriodOptions(),
) {
  const result = await pool.query<{ id: string; organization_id: string }>(
    `with due as (
       select subscription.id
       from subscriptions subscription
       where subscription.status = 'grace_period'
         and subscription.ended_at is null
         and subscription.grace_period_ends_at <= now()
       order by subscription.grace_period_ends_at, subscription.id
       for update skip locked
       limit $1
     )
     update subscriptions subscription
     set status = 'canceled', canceled_at = now(), ended_at = now(),
       cancel_at_period_end = false, updated_at = now()
     from due
     where subscription.id = due.id
     returning subscription.id, subscription.organization_id`,
    [options.batchSize],
  );
  return { expired: result.rowCount ?? result.rows.length, subscriptions: result.rows };
}
