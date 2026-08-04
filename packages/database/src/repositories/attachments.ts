import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "../client.js";
import { TenantResourceNotFoundError } from "../errors.js";
import { attachments, projects, tasks } from "../schema.js";
import { assertWorkspaceTenantContext, type DatabaseTenantContext } from "../tenant-context.js";

export type AttachmentTarget = { taskId: string; projectId?: never } | { projectId: string; taskId?: never };

export type CreateAttachmentInput = AttachmentTarget & {
  uploaderId: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  storageReference: string;
};

export type AttachmentScanResult = {
  status: "clean" | "infected" | "failed";
  engine: string;
  signature?: string;
};

export type AttachmentPreviewResult = {
  status: "ready" | "source" | "unsupported" | "failed";
  storageReference?: string;
  mimeType?: string;
  width?: number;
  height?: number;
};

export class InvalidAttachmentTargetError extends Error {
  constructor() {
    super("exactly one attachment target is required");
    this.name = "InvalidAttachmentTargetError";
  }
}

export function createAttachmentsRepository(context: DatabaseTenantContext) {
  assertWorkspaceTenantContext(context);
  const { organizationId, workspaceId } = context;
  const attachmentScope = and(
    eq(attachments.organizationId, organizationId),
    eq(attachments.workspaceId, workspaceId),
    isNull(attachments.deletedAt),
  )!;

  function normalizeTarget(target: { taskId?: string | null; projectId?: string | null }): AttachmentTarget {
    if (Boolean(target.taskId) === Boolean(target.projectId)) {
      throw new InvalidAttachmentTargetError();
    }
    return target.taskId ? { taskId: target.taskId } : { projectId: target.projectId! };
  }

  async function requireTask(taskId: string) {
    const [task] = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.organizationId, organizationId), eq(tasks.workspaceId, workspaceId)))
      .limit(1);
    if (!task) throw new TenantResourceNotFoundError("task");
    return task;
  }

  async function requireProject(projectId: string) {
    const [project] = await db
      .select()
      .from(projects)
      .where(
        and(
          eq(projects.id, projectId),
          eq(projects.organizationId, organizationId),
          eq(projects.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    if (!project) throw new TenantResourceNotFoundError("project");
    return project;
  }

  async function requireTarget(target: AttachmentTarget) {
    return "taskId" in target && target.taskId ? requireTask(target.taskId) : requireProject(target.projectId!);
  }

  return {
    validateTarget(target: AttachmentTarget) {
      return requireTarget(normalizeTarget(target));
    },

    async list(target: AttachmentTarget) {
      const normalizedTarget = normalizeTarget(target);
      await requireTarget(normalizedTarget);

      return "taskId" in normalizedTarget && normalizedTarget.taskId
        ? db
            .select()
            .from(attachments)
            .where(and(eq(attachments.taskId, normalizedTarget.taskId), attachmentScope))
            .orderBy(desc(attachments.createdAt))
        : db
            .select()
            .from(attachments)
            .where(and(eq(attachments.projectId, normalizedTarget.projectId!), attachmentScope))
            .orderBy(desc(attachments.createdAt));
    },

    async create(input: CreateAttachmentInput) {
      const target = normalizeTarget(input);
      await requireTarget(target);

      const [attachment] = await db
        .insert(attachments)
        .values({
          organizationId,
          workspaceId,
          taskId: "taskId" in target ? target.taskId : null,
          projectId: "projectId" in target ? target.projectId : null,
          uploaderId: input.uploaderId,
          fileName: input.fileName,
          fileSize: input.fileSize,
          mimeType: input.mimeType,
          url: input.storageReference,
        })
        .returning();

      return attachment;
    },

    async get(attachmentId: string) {
      const [attachment] = await db
        .select()
        .from(attachments)
        .where(and(eq(attachments.id, attachmentId), attachmentScope))
        .limit(1);
      if (!attachment) throw new TenantResourceNotFoundError("attachment");
      await requireTarget(normalizeTarget(attachment));
      return attachment;
    },

    async setScanResult(attachmentId: string, result: AttachmentScanResult) {
      const [attachment] = await db
        .update(attachments)
        .set({
          scanStatus: result.status,
          scanEngine: result.engine,
          scanSignature: result.signature ?? null,
          scannedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(eq(attachments.id, attachmentId), attachmentScope))
        .returning();
      if (!attachment) throw new TenantResourceNotFoundError("attachment");
      return attachment;
    },

    async setPreviewResult(attachmentId: string, result: AttachmentPreviewResult) {
      const [attachment] = await db
        .update(attachments)
        .set({
          previewStatus: result.status,
          previewReference: result.storageReference ?? null,
          previewMimeType: result.mimeType ?? null,
          previewWidth: result.width ?? null,
          previewHeight: result.height ?? null,
          updatedAt: new Date(),
        })
        .where(and(eq(attachments.id, attachmentId), attachmentScope))
        .returning();
      if (!attachment) throw new TenantResourceNotFoundError("attachment");
      return attachment;
    },

    async delete(attachmentId: string) {
      const [attachment] = await db
        .select()
        .from(attachments)
        .where(and(eq(attachments.id, attachmentId), attachmentScope))
        .limit(1);
      if (!attachment) {
        throw new TenantResourceNotFoundError("attachment");
      }

      await requireTarget(normalizeTarget(attachment));
      await db
        .update(attachments)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(attachments.id, attachmentId), attachmentScope));
      return attachment;
    },
  };
}
