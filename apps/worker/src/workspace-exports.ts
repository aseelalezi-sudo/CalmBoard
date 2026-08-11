import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  NotFound,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import type { Readable } from "node:stream";
import type { Pool, PoolClient } from "pg";
import {
  createWorkspacePdf,
  createWorkspaceXlsx,
  workspaceReportContentType,
  type WorkspaceExportArchive,
} from "./workspace-report-export.js";
import { createWorkspacePortabilityZip } from "./portability-export.js";
import { createOrganizationPortabilityArchive } from "./organization-portability-export.js";

export const workspaceExportJobName = "exports.process-workspace";

export type WorkspaceExportOptions = {
  batchSize: number;
  claimTimeoutMinutes: number;
  retentionDays: number;
  organizationPageSize: number;
  cleanupBatchSize: number;
};

export type WorkspaceExportCandidate = {
  id: string;
  organizationId: string;
  workspaceId: string | null;
  exportScope: "workspace" | "organization";
  requestedBy: string;
  attempt: number;
  maxAttempts: number;
  claimToken: string;
  format: "json" | "pdf" | "xlsx";
  reportScheduleId: string | null;
  scheduledFor: Date | null;
};

export type WorkspaceExportStorage = {
  putObject(key: string, body: Uint8Array | Readable, contentType: string): Promise<void>;
  getObject?(key: string): Promise<Uint8Array>;
  getReference?(reference: string): Promise<Uint8Array>;
  deleteObject?(key: string): Promise<void>;
  objectExists?(key: string): Promise<boolean>;
};

function assertWorkspaceExportTarget(
  job: WorkspaceExportCandidate,
): asserts job is WorkspaceExportCandidate & { exportScope: "workspace"; workspaceId: string } {
  if (job.exportScope !== "workspace" || !job.workspaceId) {
    throw new Error("Workspace export job has an invalid persisted target");
  }
}

export function readWorkspaceExportOptions(env: NodeJS.ProcessEnv = process.env): WorkspaceExportOptions {
  const integer = (name: string, fallback: number, minimum: number, maximum: number) => {
    const value = env[name] === undefined ? fallback : Number(env[name]);
    if (!Number.isInteger(value) || value < minimum || value > maximum) {
      throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
    }
    return value;
  };
  return {
    batchSize: integer("WORKSPACE_EXPORT_BATCH_SIZE", 5, 1, 50),
    claimTimeoutMinutes: integer("WORKSPACE_EXPORT_CLAIM_TIMEOUT_MINUTES", 30, 1, 1440),
    retentionDays: integer("WORKSPACE_EXPORT_RETENTION_DAYS", 7, 1, 90),
    organizationPageSize: integer("ORGANIZATION_EXPORT_PAGE_SIZE", 500, 25, 2000),
    cleanupBatchSize: integer("EXPORT_CLEANUP_BATCH_SIZE", 25, 1, 200),
  };
}

export function createWorkspaceExportStorage(env: NodeJS.ProcessEnv = process.env): WorkspaceExportStorage {
  const endpoint = env.S3_ENDPOINT;
  const region = env.S3_REGION ?? "us-east-1";
  const bucket = env.S3_BUCKET;
  const accessKeyId = env.S3_ACCESS_KEY_ID;
  const secretAccessKey = env.S3_SECRET_ACCESS_KEY;
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error("S3 export storage is not configured");
  }
  const client = new S3Client({
    endpoint,
    region,
    forcePathStyle: true,
    requestChecksumCalculation: "WHEN_REQUIRED",
    credentials: { accessKeyId, secretAccessKey },
  });
  const referencePrefix = `s3://${bucket}/`;
  return {
    async putObject(key, body, contentType) {
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
    },
    async getObject(key) {
      const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      if (!response.Body) throw new Error("Workspace export object body is unavailable");
      return response.Body.transformToByteArray();
    },
    async getReference(reference) {
      if (!reference.startsWith(referencePrefix)) throw new Error("Object reference points outside the export bucket");
      const key = reference.slice(referencePrefix.length);
      if (!key) throw new Error("Object reference key is empty");
      const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      if (!response.Body) throw new Error("Portability attachment object body is unavailable");
      return response.Body.transformToByteArray();
    },
    async deleteObject(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
    async objectExists(key) {
      try {
        await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return true;
      } catch (error) {
        if (error instanceof NotFound || (error as { name?: string }).name === "NotFound") return false;
        throw error;
      }
    },
  };
}

export async function claimWorkspaceExportBatch(
  client: PoolClient,
  options: WorkspaceExportOptions,
): Promise<WorkspaceExportCandidate[]> {
  await client.query("begin");
  try {
    const result = await client.query<{
      id: string;
      organization_id: string;
      workspace_id: string | null;
      export_scope: "workspace" | "organization";
      requested_by: string;
      attempts: number;
      max_attempts: number;
      claim_token: string;
      format: "json" | "pdf" | "xlsx";
      report_schedule_id: string | null;
      scheduled_for: Date | null;
    }>(
      `with candidates as (
         select job.id
         from export_jobs job
         where job.attempts < job.max_attempts
           and job.available_at <= now()
           and (
             job.status = 'pending'
             or (
               job.status = 'processing'
               and job.claimed_at < now() - make_interval(mins => $1)
             )
           )
         order by job.available_at, job.created_at, job.id
         for update skip locked
         limit $2
       )
       update export_jobs job
       set status = 'processing',
           attempts = job.attempts + 1,
           claimed_at = now(),
           claim_token = gen_random_uuid(),
           last_error = null,
           updated_at = now()
       from candidates
       where job.id = candidates.id
       returning job.id, job.organization_id, job.workspace_id, job.requested_by,
         job.attempts, job.max_attempts, job.claim_token, job.format, job.export_scope,
         job.report_schedule_id, job.scheduled_for`,
      [options.claimTimeoutMinutes, options.batchSize],
    );
    await client.query("commit");
    return result.rows.map((row) => ({
      id: row.id,
      organizationId: row.organization_id,
      workspaceId: row.workspace_id,
      exportScope: row.export_scope,
      requestedBy: row.requested_by,
      attempt: row.attempts,
      maxAttempts: row.max_attempts,
      claimToken: row.claim_token,
      format: row.format,
      reportScheduleId: row.report_schedule_id ?? null,
      scheduledFor: row.scheduled_for ?? null,
    }));
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

async function buildArchive(client: PoolClient, job: WorkspaceExportCandidate) {
  assertWorkspaceExportTarget(job);
  await client.query("begin isolation level repeatable read read only");
  try {
    const workspace = await client.query(
      `select * from workspaces where id = $1 and organization_id = $2 and deleted_at is null`,
      [job.workspaceId, job.organizationId],
    );
    if (!workspace.rowCount) throw new Error("Export workspace is unavailable");
    const tables = [
      { name: "projects", softDeleted: true },
      { name: "project_sections", softDeleted: true },
      { name: "tasks", softDeleted: true },
      { name: "comments", softDeleted: true },
      { name: "attachments", softDeleted: true },
      { name: "docs", softDeleted: true },
      { name: "goals", softDeleted: true },
      { name: "time_logs", softDeleted: false },
      { name: "automations", softDeleted: true },
      { name: "forms", softDeleted: true },
      { name: "custom_fields", softDeleted: true },
      { name: "saved_views", softDeleted: true },
      { name: "activities", softDeleted: false },
    ] as const;
    const records: Record<string, unknown[]> = {};
    for (const table of tables) {
      const rows = await client.query(
        `select * from ${table.name}
         where organization_id = $1 and workspace_id = $2
           ${table.softDeleted ? "and deleted_at is null" : ""}
         order by created_at, id`,
        [job.organizationId, job.workspaceId],
      );
      records[table.name] = rows.rows;
    }
    const members = await client.query(
      `select
         membership.id,
         membership.user_id,
         membership.workspace_id,
         membership.role,
         membership.status,
         membership.joined_at,
         account.name,
         account.email,
         account.avatar_url,
         account.locale
       from memberships membership
       join users account on account.id = membership.user_id
       where membership.organization_id = $1
         and membership.status = 'active'
         and (membership.workspace_id = $2 or membership.workspace_id is null)
       order by account.name, membership.id`,
      [job.organizationId, job.workspaceId],
    );
    await client.query("commit");
    return {
      exportVersion: "3.1.0",
      generatedAt: new Date().toISOString(),
      organizationId: job.organizationId,
      workspace: workspace.rows[0],
      members: members.rows,
      ...records,
    } satisfies WorkspaceExportArchive;
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

async function markCompleted(
  client: PoolClient,
  job: WorkspaceExportCandidate,
  result: { objectKey: string; fileName: string; contentType: string; fileSize: number; checksum: string },
  retentionDays: number,
) {
  await client.query("begin");
  try {
    const updated = await client.query(
      `update export_jobs
     set status = 'completed',
         object_key = $3,
         file_name = $4,
         content_type = $5,
         file_size = $6,
         checksum_sha256 = $7,
         completed_at = now(),
         expires_at = now() + make_interval(days => $8),
         claimed_at = null,
         claim_token = null,
         last_error = null,
         updated_at = now()
     where id = $1 and status = 'processing' and claim_token = $2`,
      [
        job.id,
        job.claimToken,
        result.objectKey,
        result.fileName,
        result.contentType,
        result.fileSize,
        result.checksum,
        retentionDays,
      ],
    );
    if (updated.rowCount !== 1) throw new Error("Workspace export claim was lost before completion");
    if (job.reportScheduleId) {
      assertWorkspaceExportTarget(job);
      await client.query(
        `with recipients as (
           select recipient.user_id, schedule.name
           from report_schedule_recipients recipient
           join report_schedules schedule on schedule.id = recipient.schedule_id
           where recipient.schedule_id = $1
             and recipient.organization_id = $2
             and recipient.workspace_id = $3
             and exists (
               select 1 from memberships membership
               where membership.user_id = recipient.user_id
                 and membership.organization_id = recipient.organization_id
                 and membership.status = 'active'
                 and (membership.workspace_id = recipient.workspace_id or membership.workspace_id is null)
             )
         ), inserted_notifications as (
           insert into notifications (
             organization_id, workspace_id, user_id, type, title, body, entity_type, entity_id
           )
           select $2, $3, recipient.user_id, 'scheduled_report',
             'التقرير المجدول جاهز',
             'أصبح التقرير المجدول «' || recipient.name || '» جاهزًا وتم إرساله إلى بريدك.',
             'export_job', $4
           from recipients recipient
           returning id, user_id
         )
         insert into notification_email_outbox (
           organization_id, workspace_id, user_id, notification_id, subject, body,
           attachment_object_key, attachment_file_name, attachment_content_type, idempotency_key
         )
         select $2, $3, notification.user_id, notification.id,
           'CalmBoard - التقرير المجدول جاهز',
           'مرفق تقرير مساحة العمل المجدول بصيغة ${job.format.toUpperCase()}.',
           $5, $6, $7, 'scheduled-report-email/' || $4::text || '/' || notification.user_id::text
         from inserted_notifications notification
         on conflict (idempotency_key) do nothing`,
        [
          job.reportScheduleId,
          job.organizationId,
          job.workspaceId,
          job.id,
          result.objectKey,
          result.fileName,
          result.contentType,
        ],
      );
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

async function releaseFailed(client: PoolClient, job: WorkspaceExportCandidate, error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown workspace export error";
  const backoffSeconds = Math.min(3600, 30 * 2 ** Math.max(job.attempt - 1, 0));
  await client.query(
    `update export_jobs
     set status = case when attempts >= max_attempts then 'dead'::export_job_status else 'pending'::export_job_status end,
         available_at = case when attempts >= max_attempts then available_at else now() + make_interval(secs => $3) end,
         claimed_at = null,
         claim_token = null,
         last_error = $4,
         updated_at = now()
     where id = $1 and status = 'processing' and claim_token = $2`,
    [job.id, job.claimToken, backoffSeconds, message.slice(0, 2000)],
  );
}

export async function processWorkspaceExports(
  pool: Pool,
  storage: WorkspaceExportStorage,
  options: WorkspaceExportOptions = readWorkspaceExportOptions(),
) {
  const claimClient = await pool.connect();
  let jobs: WorkspaceExportCandidate[];
  try {
    jobs = await claimWorkspaceExportBatch(claimClient, options);
  } finally {
    claimClient.release();
  }
  let completed = 0;
  let failed = 0;
  for (const job of jobs) {
    const client = await pool.connect();
    let temporaryArchive: Awaited<ReturnType<typeof createOrganizationPortabilityArchive>> | undefined;
    try {
      if (job.exportScope === "organization") {
        if (job.workspaceId !== null || job.format !== "json" || job.reportScheduleId !== null) {
          throw new Error("Organization export job has an invalid persisted target");
        }
        if (!storage.getReference) {
          throw new Error("Organization portability storage cannot read attachment references");
        }
        temporaryArchive = await createOrganizationPortabilityArchive(
          client,
          { id: job.id, organizationId: job.organizationId },
          { getReference: storage.getReference },
          { pageSize: options.organizationPageSize },
        );
        const objectKey = `organizations/${job.organizationId}/exports/${job.id}.zip`;
        await storage.putObject(objectKey, createReadStream(temporaryArchive.filePath), temporaryArchive.contentType);
        await markCompleted(
          client,
          job,
          {
            objectKey,
            fileName: temporaryArchive.fileName,
            contentType: temporaryArchive.contentType,
            fileSize: temporaryArchive.fileSize,
            checksum: temporaryArchive.checksum,
          },
          options.retentionDays,
        );
        completed += 1;
        continue;
      }

      assertWorkspaceExportTarget(job);
      let body: Buffer;
      let workspaceSlug: string;
      if (job.format === "json") {
        if (!storage.getReference) {
          throw new Error("Portability export storage cannot read attachment references");
        }
        const portability = await createWorkspacePortabilityZip(client, job, {
          getReference: storage.getReference,
        });
        body = portability.body;
        workspaceSlug = portability.workspaceSlug;
      } else {
        const archive = await buildArchive(client, job);
        body = job.format === "pdf" ? await createWorkspacePdf(archive) : await createWorkspaceXlsx(archive);
        workspaceSlug = String((archive.workspace as { slug?: unknown }).slug ?? job.workspaceId);
      }
      const checksum = createHash("sha256").update(body).digest("hex");
      const slug = workspaceSlug.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);
      const fileName =
        job.format === "json"
          ? `calmboard-portability-${slug}-${job.id}.zip`
          : `calmboard-report-${slug}-${job.id}.${job.format}`;
      const extension = job.format === "json" ? "zip" : job.format;
      const objectKey = `organizations/${job.organizationId}/workspaces/${job.workspaceId}/exports/${job.id}.${extension}`;
      const contentType = job.format === "json" ? "application/zip" : workspaceReportContentType(job.format);
      await storage.putObject(objectKey, body, contentType);
      await markCompleted(
        client,
        job,
        { objectKey, fileName, contentType, fileSize: body.byteLength, checksum },
        options.retentionDays,
      );
      completed += 1;
    } catch (error) {
      await releaseFailed(client, job, error);
      failed += 1;
    } finally {
      await temporaryArchive?.cleanup().catch(() => undefined);
      client.release();
    }
  }
  return { claimed: jobs.length, completed, failed };
}

type ExportCleanupCandidate = {
  id: string;
  organization_id: string;
  workspace_id: string | null;
  export_scope: "workspace" | "organization";
  format: "json" | "pdf" | "xlsx";
  status: "completed" | "dead";
  object_key: string | null;
};

function deterministicExportObjectKey(job: ExportCleanupCandidate) {
  const extension = job.format === "json" ? "zip" : job.format;
  return job.export_scope === "organization"
    ? `organizations/${job.organization_id}/exports/${job.id}.zip`
    : `organizations/${job.organization_id}/workspaces/${job.workspace_id}/exports/${job.id}.${extension}`;
}

export async function cleanupExpiredExports(
  pool: Pool,
  storage: Pick<WorkspaceExportStorage, "deleteObject" | "objectExists">,
  options: Pick<WorkspaceExportOptions, "cleanupBatchSize"> = readWorkspaceExportOptions(),
) {
  if (!storage.deleteObject || !storage.objectExists) {
    throw new Error("Export cleanup storage must support delete and existence verification");
  }
  const client = await pool.connect();
  let candidates: ExportCleanupCandidate[] = [];
  try {
    const result = await client.query<ExportCleanupCandidate>(
      `select id, organization_id, workspace_id, export_scope, format, status, object_key
       from export_jobs
       where (
         status = 'completed' and expires_at <= now()
         and coalesce(last_error, '') not like '[artifact-cleaned]%'
       ) or (
         status = 'dead' and coalesce(last_error, '') not like '[artifact-cleaned]%'
       )
       order by case when status = 'completed' then expires_at else updated_at end, id
       limit $1`,
      [options.cleanupBatchSize],
    );
    candidates = result.rows;
  } finally {
    client.release();
  }

  let cleaned = 0;
  let failed = 0;
  for (const candidate of candidates) {
    const objectKey = candidate.object_key ?? deterministicExportObjectKey(candidate);
    try {
      await storage.deleteObject(objectKey);
      if (await storage.objectExists(objectKey)) throw new Error("Export artifact remains after deletion");
      const update = await pool.query(
        `update export_jobs
         set last_error = '[artifact-cleaned] ' || coalesce(last_error, $2),
             updated_at = now()
         where id = $1 and status = $3::export_job_status
           and coalesce(last_error, '') not like '[artifact-cleaned]%'`,
        [candidate.id, `${candidate.status} export artifact removed`, candidate.status],
      );
      if (update.rowCount === 1) cleaned += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown export artifact cleanup error";
      await pool.query(
        `update export_jobs set last_error = $2, updated_at = now()
         where id = $1 and status in ('completed', 'dead')`,
        [candidate.id, `Artifact cleanup failed: ${message}`.slice(0, 2000)],
      );
      failed += 1;
    }
  }
  return { selected: candidates.length, cleaned, failed };
}
