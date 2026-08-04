import { and, desc, eq } from "drizzle-orm";
import { db } from "../client.js";
import { TenantConflictError, TenantResourceNotFoundError } from "../errors.js";
import { exportJobs, type WorkspaceExportFormat } from "../schema.js";
import { assertWorkspaceTenantContext, type DatabaseTenantContext } from "../tenant-context.js";
import { createWorkspaceRepository } from "./workspaces.js";

export function createExportJobsRepository(context: DatabaseTenantContext) {
  assertWorkspaceTenantContext(context);
  if (!context.actorId) throw new TenantResourceNotFoundError("export requester");
  const { organizationId, workspaceId, actorId } = context;
  const scope = and(
    eq(exportJobs.organizationId, organizationId),
    eq(exportJobs.workspaceId, workspaceId),
    eq(exportJobs.requestedBy, actorId),
  )!;

  function publicJob(job: typeof exportJobs.$inferSelect) {
    return {
      id: job.id,
      format: job.format,
      status: job.status,
      attempts: job.attempts,
      maxAttempts: job.maxAttempts,
      fileName: job.fileName,
      fileSize: job.fileSize,
      checksumSha256: job.checksumSha256,
      completedAt: job.completedAt,
      expiresAt: job.expiresAt,
      lastError: job.lastError,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      downloadReady: job.status === "completed" && Boolean(job.objectKey),
    };
  }

  return {
    async request(idempotencyKey: string, format: WorkspaceExportFormat = "json") {
      await createWorkspaceRepository(context).get();
      const [created] = await db
        .insert(exportJobs)
        .values({
          organizationId,
          workspaceId,
          requestedBy: actorId,
          idempotencyKey,
          format,
        })
        .onConflictDoNothing({ target: exportJobs.idempotencyKey })
        .returning();
      if (created) return publicJob(created);
      const [existing] = await db
        .select()
        .from(exportJobs)
        .where(and(scope, eq(exportJobs.idempotencyKey, idempotencyKey)));
      if (!existing) throw new TenantResourceNotFoundError("export job");
      if (existing.format !== format) {
        throw new TenantConflictError("Export idempotency key was already used for a different format");
      }
      return publicJob(existing);
    },

    async get(jobId: string) {
      const [job] = await db
        .select()
        .from(exportJobs)
        .where(and(scope, eq(exportJobs.id, jobId)))
        .limit(1);
      if (!job) throw new TenantResourceNotFoundError("export job");
      return publicJob(job);
    },

    async getDownload(jobId: string) {
      const [job] = await db
        .select()
        .from(exportJobs)
        .where(and(scope, eq(exportJobs.id, jobId)))
        .limit(1);
      if (!job || job.status !== "completed" || !job.objectKey || !job.fileName) {
        throw new TenantResourceNotFoundError("completed export job");
      }
      if (!job.expiresAt || job.expiresAt <= new Date()) {
        throw new TenantResourceNotFoundError("active export job");
      }
      return { objectKey: job.objectKey, fileName: job.fileName, contentType: job.contentType! };
    },

    async list(limit = 20) {
      const jobs = await db
        .select()
        .from(exportJobs)
        .where(scope)
        .orderBy(desc(exportJobs.createdAt))
        .limit(Math.min(Math.max(limit, 1), 50));
      return jobs.map(publicJob);
    },
  };
}
