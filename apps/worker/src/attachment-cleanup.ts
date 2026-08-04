import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Pool, type PoolClient } from "pg";

export const attachmentCleanupJobName = "attachments.cleanup-orphans";

export type AttachmentCleanupCandidate = {
  id: string;
  url: string;
  previewReference: string | null;
  claimToken: Date;
};

export type AttachmentCleanupOptions = {
  pendingRetentionHours: number;
  deletedRetentionHours: number;
  claimTimeoutMinutes: number;
  batchSize: number;
  maxAttempts: number;
};

export function readAttachmentCleanupOptions(env: NodeJS.ProcessEnv = process.env): AttachmentCleanupOptions {
  const readNumber = (name: string, fallback: number, minimum: number, maximum: number) => {
    const value = env[name] === undefined ? fallback : Number(env[name]);
    if (!Number.isFinite(value) || value < minimum || value > maximum) {
      throw new Error(`${name} must be between ${minimum} and ${maximum}`);
    }
    return value;
  };
  return {
    pendingRetentionHours: readNumber("ATTACHMENT_PENDING_RETENTION_HOURS", 2, 1, 168),
    deletedRetentionHours: readNumber("ATTACHMENT_DELETED_RETENTION_HOURS", 24, 1, 720),
    claimTimeoutMinutes: readNumber("ATTACHMENT_CLEANUP_CLAIM_TIMEOUT_MINUTES", 30, 5, 1440),
    batchSize: Math.floor(readNumber("ATTACHMENT_CLEANUP_BATCH_SIZE", 100, 1, 1000)),
    maxAttempts: Math.floor(readNumber("ATTACHMENT_CLEANUP_MAX_ATTEMPTS", 10, 1, 100)),
  };
}

export function readMaintenanceDatabaseUrl(env: NodeJS.ProcessEnv = process.env) {
  const url = env.DATABASE_MAINTENANCE_URL ?? (env.NODE_ENV === "production" ? undefined : env.DATABASE_URL);
  if (!url) throw new Error("DATABASE_MAINTENANCE_URL is required by the cleanup worker");
  return url;
}

export async function claimAttachmentCleanupBatch(
  client: PoolClient,
  options: AttachmentCleanupOptions,
): Promise<AttachmentCleanupCandidate[]> {
  await client.query("begin");
  try {
    const result = await client.query<{
      id: string;
      url: string;
      preview_reference: string | null;
      cleanup_claimed_at: Date;
    }>(
      `with candidates as (
         select attachment.id
         from attachments attachment
         where attachment.cleanup_attempts < $1
           and (
             attachment.cleanup_claimed_at is null
             or attachment.cleanup_claimed_at < now() - make_interval(mins => $2)
           )
           and (
             (attachment.deleted_at is not null
               and attachment.deleted_at < now() - make_interval(hours => $3))
             or (attachment.scan_status in ('pending', 'failed', 'infected')
               and attachment.updated_at < now() - make_interval(hours => $4))
             or (attachment.task_id is not null and not exists (
               select 1 from tasks task
               where task.id = attachment.task_id and task.deleted_at is null
             ))
             or (attachment.project_id is not null and not exists (
               select 1 from projects project
               where project.id = attachment.project_id and project.deleted_at is null
             ))
           )
         order by attachment.updated_at, attachment.id
         for update skip locked
         limit $5
       )
       update attachments attachment
       set cleanup_claimed_at = now(),
           cleanup_attempts = attachment.cleanup_attempts + 1,
           cleanup_error = null
       from candidates
       where attachment.id = candidates.id
       returning attachment.id, attachment.url, attachment.preview_reference, attachment.cleanup_claimed_at`,
      [
        options.maxAttempts,
        options.claimTimeoutMinutes,
        options.deletedRetentionHours,
        options.pendingRetentionHours,
        options.batchSize,
      ],
    );
    await client.query("commit");
    return result.rows.map((row) => ({
      id: row.id,
      url: row.url,
      previewReference: row.preview_reference,
      claimToken: row.cleanup_claimed_at,
    }));
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

type CleanupStorage = {
  deleteReference(reference: string): Promise<void>;
};

export function createCleanupStorage(env: NodeJS.ProcessEnv = process.env): CleanupStorage {
  const endpoint = env.S3_ENDPOINT;
  const region = env.S3_REGION ?? "us-east-1";
  const bucket = env.S3_BUCKET;
  const accessKeyId = env.S3_ACCESS_KEY_ID;
  const secretAccessKey = env.S3_SECRET_ACCESS_KEY;
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error("S3 cleanup storage is not configured");
  }
  const client = new S3Client({
    endpoint,
    region,
    forcePathStyle: true,
    requestChecksumCalculation: "WHEN_REQUIRED",
    credentials: { accessKeyId, secretAccessKey },
  });
  const prefix = `s3://${bucket}/`;
  return {
    async deleteReference(reference: string) {
      if (!reference.startsWith(prefix)) throw new Error("Attachment points outside the configured storage bucket");
      const key = reference.slice(prefix.length);
      if (!key) throw new Error("Attachment storage key is empty");
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
}

async function finishCandidate(client: PoolClient, candidate: AttachmentCleanupCandidate) {
  await client.query("delete from attachments where id = $1 and cleanup_claimed_at = $2", [
    candidate.id,
    candidate.claimToken,
  ]);
}

async function releaseCandidate(client: PoolClient, candidate: AttachmentCleanupCandidate, error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown cleanup error";
  await client.query(
    `update attachments
     set cleanup_claimed_at = null, cleanup_error = $3
     where id = $1 and cleanup_claimed_at = $2`,
    [candidate.id, candidate.claimToken, message.slice(0, 2000)],
  );
}

export async function cleanupOrphanAttachments(
  pool: Pool,
  storage: CleanupStorage,
  options: AttachmentCleanupOptions = readAttachmentCleanupOptions(),
) {
  const client = await pool.connect();
  try {
    const candidates = await claimAttachmentCleanupBatch(client, options);
    let deleted = 0;
    let failed = 0;
    for (const candidate of candidates) {
      try {
        await storage.deleteReference(candidate.url);
        if (candidate.previewReference) await storage.deleteReference(candidate.previewReference);
        await finishCandidate(client, candidate);
        deleted += 1;
      } catch (error) {
        await releaseCandidate(client, candidate, error);
        failed += 1;
      }
    }
    return { claimed: candidates.length, deleted, failed };
  } finally {
    client.release();
  }
}

export function createAttachmentCleanupPool(env: NodeJS.ProcessEnv = process.env) {
  return new Pool({ connectionString: readMaintenanceDatabaseUrl(env), max: 4 });
}
