import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { Pool } from "pg";
import { processDataLifecycle, readDataLifecycleOptions, retryFailedDataLifecycleRequest } from "./data-lifecycle.js";

describe("data lifecycle worker", () => {
  it("validates bounded processing options", () => {
    assert.deepEqual(
      readDataLifecycleOptions({
        DATA_LIFECYCLE_BATCH_SIZE: "10",
        DATA_LIFECYCLE_CLAIM_TIMEOUT_MINUTES: "20",
        DATA_LIFECYCLE_MAX_ATTEMPTS: "5",
        DATA_LIFECYCLE_RETRY_BASE_SECONDS: "60",
      }),
      { batchSize: 10, claimTimeoutMinutes: 20, maxAttempts: 5, retryBaseSeconds: 60 },
    );
    assert.throws(() => readDataLifecycleOptions({ DATA_LIFECYCLE_BATCH_SIZE: "0" }), /between 1 and 1000/);
  });

  it(
    "revokes personal state and completes one account as a retained anonymized principal",
    { skip: !process.env.DATABASE_MAINTENANCE_URL },
    async () => {
      const pool = new Pool({ connectionString: process.env.DATABASE_MAINTENANCE_URL, max: 3 });
      const userId = randomUUID();
      const requestId = randomUUID();
      const startedAt = new Date();
      try {
        await pool.query(
          `insert into users
            (id, email, name, password_hash, lifecycle_state)
           values ($1, $2, 'Lifecycle account', 'disabled-test-hash', 'deletion_pending')`,
          [userId, `lifecycle-worker-${userId}@example.test`],
        );
        await pool.query(
          `insert into notification_preferences (user_id, email_enabled)
           values ($1, true)`,
          [userId],
        );
        await pool.query(
          `insert into auth_tokens (user_id, purpose, token_hash, expires_at)
           values ($1, 'password_reset', $2, now() + interval '1 hour')`,
          [userId, "a".repeat(64)],
        );
        await pool.query(
          `insert into account_deletion_requests
            (id, user_id, status, policy_version, requested_at, reauthenticated_at, scheduled_for)
           values ($1, $2, 'scheduled', 'policy-v1', now(), now(), now())`,
          [requestId, userId],
        );

        assert.deepEqual(
          await processDataLifecycle(pool, {
            batchSize: 1,
            claimTimeoutMinutes: 15,
            maxAttempts: 3,
            retryBaseSeconds: 5,
          }),
          { processed: 1 },
        );

        const state = await pool.query(
          `select request.status, request.completed_at is not null as completed,
                  account.lifecycle_state, account.password_hash, account.email,
                  (select count(*)::int from auth_tokens where user_id = $2) as auth_tokens,
                  (select count(*)::int from notification_preferences where user_id = $2) as preferences,
                  (select count(*)::int from data_purge_checkpoints where account_request_id = $1 and status = 'verified') as verified_domains
             from account_deletion_requests request
             join users account on account.id = request.user_id
            where request.id = $1`,
          [requestId, userId],
        );
        assert.deepEqual(state.rows[0], {
          status: "completed",
          completed: true,
          lifecycle_state: "anonymized",
          password_hash: null,
          email: `deleted+${userId}@users.invalid`,
          auth_tokens: 0,
          preferences: 0,
          verified_domains: 4,
        });
        const receipts = await pool.query<{ count: number }>(
          `select count(*)::int as count
             from data_deletion_receipts
            where subject_type = 'account' and outcome = 'anonymized' and completed_at >= $1`,
          [startedAt],
        );
        assert.equal(receipts.rows[0]?.count, 1);
      } finally {
        await pool.query("delete from account_deletion_requests where id = $1", [requestId]).catch(() => undefined);
        await pool.query("delete from users where id = $1", [userId]).catch(() => undefined);
        await pool
          .query(
            "delete from data_deletion_receipts where subject_type = 'account' and outcome = 'anonymized' and completed_at >= $1",
            [startedAt],
          )
          .catch(() => undefined);
        await pool.end();
      }
    },
  );

  it(
    "allows only a trusted retry of the same failed durable request",
    { skip: !process.env.DATABASE_MAINTENANCE_URL },
    async () => {
      const pool = new Pool({ connectionString: process.env.DATABASE_MAINTENANCE_URL, max: 2 });
      const userId = randomUUID();
      const requestId = randomUUID();
      try {
        await pool.query(
          "insert into users (id, email, name, lifecycle_state, auth_disabled_at) values ($1, $2, 'Retry user', 'auth_disabled', now())",
          [userId, `lifecycle-retry-${userId}@example.test`],
        );
        await pool.query(
          `insert into account_deletion_requests
            (id, user_id, status, policy_version, requested_at, reauthenticated_at,
             processing_started_at, failed_at, attempts, last_error_code)
           values ($1, $2, 'failed', 'policy-v1', now(), now(), now(), now(), 8, 'TEST_FAILURE')`,
          [requestId, userId],
        );
        assert.equal(await retryFailedDataLifecycleRequest(pool, "account", requestId), true);
        const state = await pool.query(
          "select status, retry_at is not null as retry_scheduled, failed_at is not null as failure_retained from account_deletion_requests where id = $1",
          [requestId],
        );
        assert.deepEqual(state.rows[0], { status: "retry_wait", retry_scheduled: true, failure_retained: true });
        assert.equal(await retryFailedDataLifecycleRequest(pool, "account", requestId), false);
      } finally {
        await pool.query("delete from account_deletion_requests where id = $1", [requestId]).catch(() => undefined);
        await pool.query("delete from users where id = $1", [userId]).catch(() => undefined);
        await pool.end();
      }
    },
  );
});
