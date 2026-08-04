import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Pool, PoolClient } from "pg";
import {
  claimAttachmentCleanupBatch,
  cleanupOrphanAttachments,
  readAttachmentCleanupOptions,
  readMaintenanceDatabaseUrl,
  type AttachmentCleanupOptions,
} from "./attachment-cleanup.js";

const options: AttachmentCleanupOptions = {
  pendingRetentionHours: 2,
  deletedRetentionHours: 24,
  claimTimeoutMinutes: 30,
  batchSize: 100,
  maxAttempts: 10,
};

describe("attachment cleanup configuration", () => {
  it("uses bounded defaults and normalizes integer batch settings", () => {
    assert.deepEqual(readAttachmentCleanupOptions({ ATTACHMENT_CLEANUP_BATCH_SIZE: "25.9" }), {
      pendingRetentionHours: 2,
      deletedRetentionHours: 24,
      claimTimeoutMinutes: 30,
      batchSize: 25,
      maxAttempts: 10,
    });
    assert.throws(() => readAttachmentCleanupOptions({ ATTACHMENT_PENDING_RETENTION_HOURS: "0" }), /between 1 and 168/);
  });

  it("requires a dedicated maintenance connection in production", () => {
    assert.throws(() => readMaintenanceDatabaseUrl({ NODE_ENV: "production", DATABASE_URL: "postgres://runtime" }));
    assert.equal(
      readMaintenanceDatabaseUrl({ NODE_ENV: "production", DATABASE_MAINTENANCE_URL: "postgres://maintenance" }),
      "postgres://maintenance",
    );
  });

  it("claims rows with a transaction and maps their immutable claim token", async () => {
    const statements: string[] = [];
    const claimedAt = new Date("2026-07-28T12:00:00.000Z");
    const client = {
      async query(statement: string) {
        statements.push(statement);
        return statement.startsWith("with candidates")
          ? {
              rows: [
                {
                  id: "attachment-1",
                  url: "s3://bucket/original",
                  preview_reference: "s3://bucket/preview",
                  cleanup_claimed_at: claimedAt,
                },
              ],
            }
          : { rows: [] };
      },
    } as unknown as PoolClient;

    assert.deepEqual(await claimAttachmentCleanupBatch(client, options), [
      {
        id: "attachment-1",
        url: "s3://bucket/original",
        previewReference: "s3://bucket/preview",
        claimToken: claimedAt,
      },
    ]);
    assert.equal(statements[0], "begin");
    assert.match(statements[1] ?? "", /for update skip locked/);
    assert.equal(statements[2], "commit");
  });

  it("deletes the original and preview before removing the claimed row", async () => {
    const statements: string[] = [];
    const deletedReferences: string[] = [];
    const claimedAt = new Date("2026-07-28T12:00:00.000Z");
    const client = {
      async query(statement: string) {
        statements.push(statement);
        return statement.startsWith("with candidates")
          ? {
              rows: [
                {
                  id: "attachment-1",
                  url: "s3://bucket/original",
                  preview_reference: "s3://bucket/preview",
                  cleanup_claimed_at: claimedAt,
                },
              ],
            }
          : { rows: [] };
      },
      release() {},
    } as unknown as PoolClient;
    const pool = { connect: async () => client } as unknown as Pool;
    const result = await cleanupOrphanAttachments(
      pool,
      { deleteReference: async (reference) => void deletedReferences.push(reference) },
      options,
    );

    assert.deepEqual(result, { claimed: 1, deleted: 1, failed: 0 });
    assert.deepEqual(deletedReferences, ["s3://bucket/original", "s3://bucket/preview"]);
    assert.match(statements.at(-1) ?? "", /delete from attachments/);
  });
});
