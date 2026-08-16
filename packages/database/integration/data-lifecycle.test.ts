import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import {
  createAccountDeletionRepository,
  createOrganizationDeletionRepository,
  pool,
  purgeLocatorFingerprint,
} from "../src/index.js";

after(async () => {
  await pool.end();
});

function hasDatabaseCode(error: unknown, code: string) {
  let current: unknown = error;
  while (typeof current === "object" && current !== null) {
    if ("code" in current && current.code === code) return true;
    current = "cause" in current ? current.cause : null;
  }
  return false;
}

async function expectDatabaseCode(operation: () => Promise<unknown>, code: string) {
  await assert.rejects(operation, (error: unknown) => hasDatabaseCode(error, code));
}

const quoteIdentifier = (value: string) => `"${value.replaceAll('"', '""')}"`;

describe("0062 data lifecycle", () => {
  it("enforces sole-owner protection and owner-only exact-name Organization scheduling transactionally", async () => {
    const ownerId = randomUUID();
    const memberId = randomUUID();
    const organizationId = randomUUID();
    try {
      await pool.query("insert into users (id, email, name) values ($1, $2, 'Sole owner'), ($3, $4, 'Member')", [
        ownerId,
        `sole-owner-${ownerId}@example.test`,
        memberId,
        `lifecycle-member-${memberId}@example.test`,
      ]);
      await pool.query(
        "insert into organizations (id, name, slug, owner_id) values ($1, 'Exact Organization Name', $2, $3)",
        [organizationId, `sole-owner-${organizationId}`, ownerId],
      );
      const schedule = {
        reauthenticatedAt: new Date(),
        scheduledFor: new Date(Date.now() + 60_000),
        policyVersion: "policy-v1",
      };
      await assert.rejects(
        () => createAccountDeletionRepository(ownerId).schedule(schedule),
        /Transfer ownership or schedule deletion/,
      );
      await assert.rejects(
        () =>
          createOrganizationDeletionRepository(organizationId, memberId).schedule({
            ...schedule,
            confirmationVersion: "organization-name-v1",
            confirmedName: "Exact Organization Name",
          }),
        /Only the Organization owner/,
      );
      await assert.rejects(
        () =>
          createOrganizationDeletionRepository(organizationId, ownerId).schedule({
            ...schedule,
            confirmationVersion: "organization-name-v1",
            confirmedName: "exact organization name",
          }),
        /does not match exactly/,
      );
      await createOrganizationDeletionRepository(organizationId, ownerId).schedule({
        ...schedule,
        confirmationVersion: "organization-name-v1",
        confirmedName: "Exact Organization Name",
      });
      const accountRequest = await createAccountDeletionRepository(ownerId).schedule(schedule);
      assert.equal(accountRequest.status, "scheduled");
    } finally {
      await pool.query("delete from organizations where id = $1", [organizationId]).catch(() => undefined);
      await pool.query("delete from account_deletion_requests where user_id = $1", [ownerId]).catch(() => undefined);
      await pool.query("delete from users where id = any($1::uuid[])", [[ownerId, memberId]]).catch(() => undefined);
    }
  });

  it("enforces active-request uniqueness, retry history, terminal reuse, XOR parents, and locator uniqueness", async () => {
    const userId = randomUUID();
    const canceledUserId = randomUUID();
    const completedUserId = randomUUID();
    const ownerId = randomUUID();
    const organizationId = randomUUID();
    try {
      await pool.query(
        `insert into users (id, email, name) values
          ($1, $2, 'Active request'),
          ($3, $4, 'Canceled request'),
          ($5, $6, 'Completed request'),
          ($7, $8, 'Organization owner')`,
        [
          userId,
          `active-${userId}@example.test`,
          canceledUserId,
          `canceled-${canceledUserId}@example.test`,
          completedUserId,
          `completed-${completedUserId}@example.test`,
          ownerId,
          `owner-${ownerId}@example.test`,
        ],
      );
      await pool.query("insert into organizations (id, name, slug, owner_id) values ($1, 'Lifecycle tenant', $2, $3)", [
        organizationId,
        `lifecycle-${organizationId}`,
        ownerId,
      ]);

      const accountInsert = `insert into account_deletion_requests
        (user_id, policy_version, requested_at, reauthenticated_at)
        values ($1, 'policy-v1', now(), now()) returning id`;
      const concurrent = await Promise.allSettled([
        pool.query(accountInsert, [userId]),
        pool.query(accountInsert, [userId]),
      ]);
      assert.equal(concurrent.filter((result) => result.status === "fulfilled").length, 1);
      assert.equal(concurrent.filter((result) => result.status === "rejected").length, 1);
      assert.ok(concurrent.some((result) => result.status === "rejected" && hasDatabaseCode(result.reason, "23505")));
      const activeRequest = await pool.query<{ id: string }>(
        "select id from account_deletion_requests where user_id = $1",
        [userId],
      );
      const activeRequestId = activeRequest.rows[0]!.id;
      await pool.query(
        `update account_deletion_requests
            set status = 'processing', scheduled_for = now(), processing_started_at = now(),
                claim_token = gen_random_uuid(), claimed_at = now(), heartbeat_at = now()
          where id = $1`,
        [activeRequestId],
      );
      await pool.query(
        `update account_deletion_requests
            set status = 'failed', failed_at = now(), claim_token = null, claimed_at = null, heartbeat_at = null
          where id = $1`,
        [activeRequestId],
      );
      await expectDatabaseCode(() => pool.query(accountInsert, [userId]), "23505");
      await expectDatabaseCode(
        () =>
          pool.query(
            "update account_deletion_requests set status = 'canceled', canceled_at = now(), failed_at = null where id = $1",
            [activeRequestId],
          ),
        "23514",
      );

      const canceled = await pool.query<{ id: string }>(accountInsert, [canceledUserId]);
      await pool.query("update account_deletion_requests set status = 'canceled', canceled_at = now() where id = $1", [
        canceled.rows[0]!.id,
      ]);
      await pool.query(accountInsert, [canceledUserId]);

      const completed = await pool.query<{ id: string }>(accountInsert, [completedUserId]);
      await pool.query(
        `update account_deletion_requests
            set status = 'processing', scheduled_for = now(), processing_started_at = now(),
                claim_token = gen_random_uuid(), claimed_at = now(), heartbeat_at = now()
          where id = $1`,
        [completed.rows[0]!.id],
      );
      await pool.query(
        `update account_deletion_requests
            set status = 'completed', completed_at = now(), claim_token = null, claimed_at = null, heartbeat_at = null
          where id = $1`,
        [completed.rows[0]!.id],
      );
      await pool.query(accountInsert, [completedUserId]);

      const organizationRequest = await pool.query<{ id: string }>(
        `insert into organization_deletion_requests
          (organization_id, requested_by_user_id, policy_version, confirmation_version, requested_at, reauthenticated_at)
         values ($1, $2, 'policy-v1', 'confirm-v1', now(), now()) returning id`,
        [organizationId, ownerId],
      );
      await expectDatabaseCode(
        () =>
          pool.query(
            `insert into organization_deletion_requests
              (organization_id, requested_by_user_id, policy_version, confirmation_version, requested_at, reauthenticated_at)
             values ($1, $2, 'policy-v1', 'confirm-v1', now(), now())`,
            [organizationId, ownerId],
          ),
        "23505",
      );

      const organizationRequestId = organizationRequest.rows[0]!.id;
      await expectDatabaseCode(
        () =>
          pool.query(
            `insert into data_purge_checkpoints
              (account_request_id, organization_request_id, domain, batch_size)
             values (null, null, 'organization_relational', 100)`,
          ),
        "23514",
      );
      await expectDatabaseCode(
        () =>
          pool.query(
            `insert into data_purge_checkpoints
              (account_request_id, organization_request_id, domain, batch_size)
             values ($1, $2, 'organization_relational', 100)`,
            [activeRequestId, organizationRequestId],
          ),
        "23514",
      );
      await pool.query(
        `insert into data_purge_checkpoints
          (organization_request_id, domain, partition_key, batch_size)
         values ($1, 'organization_relational', 'primary', 100)`,
        [organizationRequestId],
      );
      await expectDatabaseCode(
        () =>
          pool.query(
            `insert into data_purge_checkpoints
              (organization_request_id, domain, partition_key, batch_size)
             values ($1, 'organization_relational', 'primary', 100)`,
            [organizationRequestId],
          ),
        "23505",
      );

      const locator = { bucket: "private", key: `organizations/${organizationId}/file` };
      const fingerprint = purgeLocatorFingerprint("attachments", "object_key", locator);
      await pool.query(
        `insert into data_purge_items
          (organization_request_id, domain, locator_kind, locator, locator_fingerprint)
         values ($1, 'attachments', 'object_key', $2::jsonb, $3)`,
        [organizationRequestId, JSON.stringify(locator), fingerprint],
      );
      await expectDatabaseCode(
        () =>
          pool.query(
            `insert into data_purge_items
              (organization_request_id, domain, locator_kind, locator, locator_fingerprint)
             values ($1, 'attachments', 'object_key', $2::jsonb, $3)`,
            [organizationRequestId, JSON.stringify({ key: locator.key, bucket: locator.bucket }), fingerprint],
          ),
        "23505",
      );
    } finally {
      await pool.query("delete from organizations where id = $1", [organizationId]).catch(() => undefined);
      await pool
        .query("delete from account_deletion_requests where user_id = any($1::uuid[])", [
          [userId, canceledUserId, completedUserId],
        ])
        .catch(() => undefined);
      await pool
        .query("delete from users where id = any($1::uuid[])", [[userId, canceledUserId, completedUserId, ownerId]])
        .catch(() => undefined);
    }
  });

  it("enforces self/owner RLS, Worker-only rows, and the Organization write freeze", async () => {
    const ownerId = randomUUID();
    const memberId = randomUUID();
    const outsiderId = randomUUID();
    const selfRequestUserId = randomUUID();
    const organizationId = randomUUID();
    const otherOrganizationId = randomUUID();
    const appRole = `calmboard_lifecycle_app_${randomUUID().replaceAll("-", "")}`;
    const workerRole = `calmboard_lifecycle_worker_${randomUUID().replaceAll("-", "")}`;
    let rolesCreated = false;
    try {
      await pool.query(
        `insert into users (id, email, name) values
          ($1, $2, 'Owner'), ($3, $4, 'Member'), ($5, $6, 'Outsider'), ($7, $8, 'Self')`,
        [
          ownerId,
          `owner-${ownerId}@example.test`,
          memberId,
          `member-${memberId}@example.test`,
          outsiderId,
          `outsider-${outsiderId}@example.test`,
          selfRequestUserId,
          `self-${selfRequestUserId}@example.test`,
        ],
      );
      await pool.query(
        `insert into organizations (id, name, slug, owner_id) values
          ($1, 'Owner tenant', $2, $3), ($4, 'Other tenant', $5, $6)`,
        [
          organizationId,
          `owner-tenant-${organizationId}`,
          ownerId,
          otherOrganizationId,
          `other-tenant-${otherOrganizationId}`,
          outsiderId,
        ],
      );
      await pool.query(
        "insert into memberships (user_id, organization_id, role, status) values ($1, $2, 'member', 'active')",
        [memberId, organizationId],
      );
      await pool.query(
        `CREATE ROLE ${quoteIdentifier(appRole)} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`,
      );
      await pool.query(
        `CREATE ROLE ${quoteIdentifier(workerRole)} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT BYPASSRLS`,
      );
      rolesCreated = true;
      for (const role of [appRole, workerRole]) {
        await pool.query(`GRANT USAGE ON SCHEMA public TO ${quoteIdentifier(role)}`);
        await pool.query(
          `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${quoteIdentifier(role)}`,
        );
      }

      const app = await pool.connect();
      try {
        await app.query("begin");
        await app.query(`set local role ${quoteIdentifier(appRole)}`);
        await app.query("select set_config('app.actor_id', $1, true)", [selfRequestUserId]);
        await app.query(
          `insert into account_deletion_requests
            (user_id, policy_version, requested_at, reauthenticated_at)
           values ($1, 'policy-v1', now(), now())`,
          [selfRequestUserId],
        );
        const ownRows = await app.query("select user_id from account_deletion_requests");
        assert.deepEqual(ownRows.rows, [{ user_id: selfRequestUserId }]);
        await expectDatabaseCode(
          () =>
            app.query(
              `insert into account_deletion_requests
                (user_id, policy_version, requested_at, reauthenticated_at)
               values ($1, 'policy-v1', now(), now())`,
              [outsiderId],
            ),
          "42501",
        );
        await app.query("rollback");

        await app.query("begin");
        await app.query(`set local role ${quoteIdentifier(appRole)}`);
        await app.query("select set_config('app.actor_id', $1, true), set_config('app.organization_id', $2, true)", [
          ownerId,
          organizationId,
        ]);
        await app.query(
          `insert into organization_deletion_requests
            (organization_id, requested_by_user_id, policy_version, confirmation_version, requested_at, reauthenticated_at)
           values ($1, $2, 'policy-v1', 'confirm-v1', now(), now())`,
          [organizationId, ownerId],
        );
        await app.query("rollback");

        await app.query("begin");
        await app.query(`set local role ${quoteIdentifier(appRole)}`);
        await app.query("select set_config('app.actor_id', $1, true), set_config('app.organization_id', $2, true)", [
          memberId,
          organizationId,
        ]);
        await expectDatabaseCode(
          () =>
            app.query(
              `insert into organization_deletion_requests
                (organization_id, requested_by_user_id, policy_version, confirmation_version, requested_at, reauthenticated_at)
               values ($1, $2, 'policy-v1', 'confirm-v1', now(), now())`,
              [organizationId, memberId],
            ),
          "42501",
        );
        await app.query("rollback");
      } finally {
        app.release();
      }

      const organizationRequest = await pool.query<{ id: string }>(
        `insert into organization_deletion_requests
          (organization_id, requested_by_user_id, policy_version, confirmation_version, requested_at, reauthenticated_at)
         values ($1, $2, 'policy-v1', 'confirm-v1', now(), now()) returning id`,
        [organizationId, ownerId],
      );
      const worker = await pool.connect();
      try {
        await worker.query("begin");
        await worker.query(`set local role ${quoteIdentifier(workerRole)}`);
        await worker.query(
          `insert into data_purge_checkpoints
            (organization_request_id, domain, batch_size)
           values ($1, 'organization_relational', 100)`,
          [organizationRequest.rows[0]!.id],
        );
        await worker.query("commit");
      } finally {
        worker.release();
      }

      await pool.query(
        "update organizations set lifecycle_state = 'write_frozen', write_frozen_at = now() where id = $1",
        [organizationId],
      );
      const frozenApp = await pool.connect();
      try {
        await frozenApp.query("begin");
        await frozenApp.query(`set local role ${quoteIdentifier(appRole)}`);
        await frozenApp.query(
          "select set_config('app.actor_id', $1, true), set_config('app.organization_id', $2, true), set_config('app.workspace_id', '', true)",
          [ownerId, organizationId],
        );
        await expectDatabaseCode(
          () =>
            frozenApp.query("insert into workspaces (organization_id, name, slug) values ($1, 'Blocked', $2)", [
              organizationId,
              `blocked-${randomUUID()}`,
            ]),
          "55000",
        );
        await frozenApp.query("rollback");
      } finally {
        frozenApp.release();
      }
      await pool.query("insert into workspaces (organization_id, name, slug) values ($1, 'Maintenance allowed', $2)", [
        organizationId,
        `maintenance-${randomUUID()}`,
      ]);
    } finally {
      await pool
        .query("delete from organizations where id = any($1::uuid[])", [[organizationId, otherOrganizationId]])
        .catch(() => undefined);
      await pool
        .query("delete from users where id = any($1::uuid[])", [[ownerId, memberId, outsiderId, selfRequestUserId]])
        .catch(() => undefined);
      if (rolesCreated) {
        for (const role of [appRole, workerRole]) {
          await pool.query(`DROP OWNED BY ${quoteIdentifier(role)}`).catch(() => undefined);
          await pool.query(`DROP ROLE IF EXISTS ${quoteIdentifier(role)}`).catch(() => undefined);
        }
      }
    }
  });

  it("retains the anonymized User and FK-free receipt while Organization workflow rows cascade", async () => {
    const accountUserId = randomUUID();
    const ownerId = randomUUID();
    const organizationId = randomUUID();
    const receiptId = randomUUID();
    try {
      await pool.query(`insert into users (id, email, name) values ($1, $2, 'Account user'), ($3, $4, 'Owner')`, [
        accountUserId,
        `account-${accountUserId}@example.test`,
        ownerId,
        `owner-${ownerId}@example.test`,
      ]);
      const accountRequest = await pool.query<{ id: string }>(
        `insert into account_deletion_requests
          (user_id, policy_version, requested_at, reauthenticated_at)
         values ($1, 'policy-v1', now(), now()) returning id`,
        [accountUserId],
      );
      await pool.query(
        `update account_deletion_requests
            set status = 'processing', scheduled_for = now(), processing_started_at = now(),
                claim_token = gen_random_uuid(), claimed_at = now(), heartbeat_at = now()
          where id = $1`,
        [accountRequest.rows[0]!.id],
      );
      const completion = await pool.connect();
      try {
        await completion.query("begin");
        await completion.query(
          `update users
              set lifecycle_state = 'anonymized', auth_disabled_at = now(), anonymized_at = now(),
                  email = $2, name = 'Deleted user', password_hash = null, avatar_url = null
            where id = $1`,
          [accountUserId, `deleted-${accountUserId}@users.invalid`],
        );
        await completion.query(
          `update account_deletion_requests
              set status = 'completed', completed_at = now(), claim_token = null, claimed_at = null, heartbeat_at = null
            where id = $1`,
          [accountRequest.rows[0]!.id],
        );
        await completion.query(
          `insert into data_deletion_receipts
            (subject_type, outcome, schema_version, verification_version, domain_summary)
           values ('account', 'anonymized', 1, 'verify-v1', '{"account_profile":1}'::jsonb)`,
        );
        await completion.query("commit");
      } catch (error) {
        await completion.query("rollback");
        throw error;
      } finally {
        completion.release();
      }
      const retainedUser = await pool.query(
        "select lifecycle_state, anonymized_at is not null as anonymized from users where id = $1",
        [accountUserId],
      );
      assert.deepEqual(retainedUser.rows, [{ lifecycle_state: "anonymized", anonymized: true }]);

      await pool.query("insert into organizations (id, name, slug, owner_id) values ($1, 'Delete tenant', $2, $3)", [
        organizationId,
        `delete-${organizationId}`,
        ownerId,
      ]);
      const organizationRequest = await pool.query<{ id: string }>(
        `insert into organization_deletion_requests
          (organization_id, requested_by_user_id, policy_version, confirmation_version, requested_at, reauthenticated_at)
         values ($1, $2, 'policy-v1', 'confirm-v1', now(), now()) returning id`,
        [organizationId, ownerId],
      );
      await pool.query(
        `insert into data_purge_checkpoints
          (organization_request_id, domain, batch_size)
         values ($1, 'final_verification', 100)`,
        [organizationRequest.rows[0]!.id],
      );
      await pool.query(
        `insert into data_purge_items
          (organization_request_id, domain, locator_kind, locator, locator_fingerprint)
         values ($1, 'final_verification', 'provider_resource', '{"resource":"verified"}'::jsonb, $2)`,
        [
          organizationRequest.rows[0]!.id,
          purgeLocatorFingerprint("final_verification", "provider_resource", { resource: "verified" }),
        ],
      );
      await pool.query(
        `insert into data_deletion_receipts
          (id, subject_type, outcome, schema_version, verification_version, domain_summary)
         values ($1, 'organization', 'purged', 1, 'verify-v1', '{"final_verification":1}'::jsonb)`,
        [receiptId],
      );
      await pool.query("delete from organizations where id = $1", [organizationId]);
      const cascaded = await pool.query(
        `select
          (select count(*)::int from organization_deletion_requests where id = $1) as requests,
          (select count(*)::int from data_purge_checkpoints where organization_request_id = $1) as checkpoints,
          (select count(*)::int from data_purge_items where organization_request_id = $1) as items,
          (select count(*)::int from data_deletion_receipts where id = $2) as receipts`,
        [organizationRequest.rows[0]!.id, receiptId],
      );
      assert.deepEqual(cascaded.rows[0], { requests: 0, checkpoints: 0, items: 0, receipts: 1 });
    } finally {
      await pool.query("delete from data_deletion_receipts where id = $1", [receiptId]).catch(() => undefined);
      await pool.query("delete from organizations where id = $1", [organizationId]).catch(() => undefined);
      await pool
        .query("delete from account_deletion_requests where user_id = $1", [accountUserId])
        .catch(() => undefined);
      await pool
        .query("delete from users where id = any($1::uuid[])", [[accountUserId, ownerId]])
        .catch(() => undefined);
    }
  });
});
