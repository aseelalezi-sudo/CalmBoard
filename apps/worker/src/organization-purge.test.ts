import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { Pool } from "pg";
import { organizationPurgeDomains, type OrganizationPurgePolicy } from "./data-retention.js";
import { claimOrganizationDeletion, processOrganizationRequest } from "./organization-purge.js";

const options = { batchSize: 25, claimTimeoutMinutes: 15, maxAttempts: 3, retryBaseSeconds: 5 };
const policy: OrganizationPurgePolicy = {
  enabled: true,
  classifications: Object.fromEntries(organizationPurgeDomains.map((domain) => [domain, "PURGE"])) as NonNullable<
    OrganizationPurgePolicy["classifications"]
  >,
};

describe("organization purge worker", () => {
  it(
    "write-freezes, verifies every domain, retains a receipt, and removes the tenant",
    { skip: !process.env.DATABASE_MAINTENANCE_URL },
    async () => {
      const pool = new Pool({ connectionString: process.env.DATABASE_MAINTENANCE_URL, max: 3 });
      const ownerId = randomUUID();
      const organizationId = randomUUID();
      const requestId = randomUUID();
      const startedAt = new Date();
      try {
        await pool.query("insert into users (id, email, name) values ($1, $2, 'Organization purge owner')", [
          ownerId,
          `organization-purge-${ownerId}@example.test`,
        ]);
        await pool.query(
          `insert into organizations (id, name, slug, owner_id, lifecycle_state)
           values ($1, 'Organization purge fixture', $2, $3, 'deletion_pending')`,
          [organizationId, `organization-purge-${organizationId}`, ownerId],
        );
        await pool.query(
          `insert into organization_deletion_requests
            (id, organization_id, requested_by_user_id, status, policy_version, confirmation_version,
             requested_at, reauthenticated_at, scheduled_for)
           values ($1, $2, $3, 'scheduled', 'policy-v1', 'organization-name-v1', now(), now(), now())`,
          [requestId, organizationId, ownerId],
        );

        const client = await pool.connect();
        const request = await claimOrganizationDeletion(client, options, policy);
        client.release();
        assert.equal(request?.id, requestId);
        assert.equal(
          (await pool.query("select lifecycle_state from organizations where id = $1", [organizationId])).rows[0]
            ?.lifecycle_state,
          "write_frozen",
        );
        await processOrganizationRequest(
          pool,
          request!,
          {
            async deleteReference() {},
            async referenceExists() {
              return false;
            },
            async deleteObject() {},
            async objectExists() {
              return false;
            },
          },
          {
            async revokeIntegration() {},
            async revokeBilling() {},
          },
          policy,
          options,
        );

        assert.equal(
          (await pool.query("select count(*)::int as count from organizations where id = $1", [organizationId])).rows[0]
            ?.count,
          0,
        );
        assert.equal(
          (
            await pool.query(
              `select count(*)::int as count from data_deletion_receipts
                where subject_type = 'organization' and outcome = 'purged' and completed_at >= $1`,
              [startedAt],
            )
          ).rows[0]?.count,
          1,
        );
      } finally {
        await pool.query("delete from organizations where id = $1", [organizationId]).catch(() => undefined);
        await pool.query("delete from users where id = $1", [ownerId]).catch(() => undefined);
        await pool
          .query(
            "delete from data_deletion_receipts where subject_type = 'organization' and outcome = 'purged' and completed_at >= $1",
            [startedAt],
          )
          .catch(() => undefined);
        await pool.end();
      }
    },
  );
});
