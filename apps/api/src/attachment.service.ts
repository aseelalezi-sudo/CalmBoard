import {
  assertWorkspaceTenantContext,
  createAttachmentsRepository,
  type AttachmentTarget,
  type DatabaseTenantContext,
} from "@calmboard/database";
import { logActivity } from "./automation-engine.js";
import type { AttachmentUploadInput } from "./attachment-validation.js";
import { createAttachmentPreview } from "./attachment-preview.js";
import { createAttachmentScanner } from "./attachment-scanner.js";
import { createObjectStorageAdapter, createStorageKey } from "./object-storage.js";
import { BadRequestException } from "@nestjs/common";

export function createAttachmentService(context: DatabaseTenantContext) {
  assertWorkspaceTenantContext(context);
  const repository = createAttachmentsRepository(context);

  async function presentAttachment<
    T extends {
      url: string;
      fileName: string;
      mimeType: string | null;
      scanStatus: string;
      previewStatus: string;
      previewReference: string | null;
      previewMimeType: string | null;
    },
  >(attachment: T) {
    const { previewReference, ...visibleAttachment } = attachment;
    if (attachment.scanStatus !== "clean") return { ...visibleAttachment, url: "", previewUrl: null };
    if (!attachment.url.startsWith("s3://")) return { ...visibleAttachment, previewUrl: null };
    const storage = createObjectStorageAdapter();
    const key = storage.readStorageKey(attachment.url);
    if (!key) return { ...visibleAttachment, url: "", previewUrl: null };
    const url = await storage.createDownloadUrl(key, attachment.fileName);
    let previewUrl: string | null = null;
    if (attachment.previewStatus === "ready" && previewReference) {
      const previewKey = storage.readStorageKey(previewReference);
      if (previewKey) {
        previewUrl = await storage.createPreviewUrl(previewKey, attachment.previewMimeType ?? "image/webp");
      }
    } else if (attachment.previewStatus === "source") {
      previewUrl = await storage.createPreviewUrl(key, attachment.mimeType ?? "application/octet-stream");
    }
    return { ...visibleAttachment, url, previewUrl };
  }

  return {
    async list(target: AttachmentTarget) {
      return Promise.all((await repository.list(target)).map(presentAttachment));
    },
    async createUpload(input: AttachmentUploadInput) {
      await repository.validateTarget(input);
      const storage = createObjectStorageAdapter();
      const key = createStorageKey(context, input.fileName);
      const upload = await storage.createUploadUrl(key, input.mimeType);
      const attachment = await repository.create({
        ...input,
        storageReference: storage.toStorageReference(key),
      });
      await logActivity({
        organizationId: context.organizationId,
        workspaceId: context.workspaceId,
        actorId: input.uploaderId,
        action: "attachment.upload.requested",
        entityType: "taskId" in input ? "task" : "project",
        entityId: "taskId" in input && input.taskId ? input.taskId : input.projectId!,
        newValues: {
          attachmentId: attachment.id,
          fileName: input.fileName,
          fileSize: input.fileSize,
          mimeType: input.mimeType,
        },
      });
      return { ...(await presentAttachment(attachment)), upload };
    },
    async completeUpload(attachmentId: string) {
      const attachment = await repository.get(attachmentId);
      if (attachment.scanStatus === "infected" || attachment.scanStatus === "failed") {
        return presentAttachment(attachment);
      }
      if (!attachment.url.startsWith("s3://")) throw new BadRequestException("Attachment storage reference is invalid");

      const storage = createObjectStorageAdapter();
      const key = storage.readStorageKey(attachment.url);
      if (!key) throw new BadRequestException("Attachment storage reference is invalid");
      if (attachment.scanStatus === "clean") {
        if (attachment.previewStatus !== "pending" && attachment.previewStatus !== "failed") {
          return presentAttachment(attachment);
        }
        try {
          return presentAttachment(
            await repository.setPreviewResult(
              attachment.id,
              await createAttachmentPreview(storage, {
                key,
                mimeType: attachment.mimeType ?? "application/octet-stream",
              }),
            ),
          );
        } catch {
          return presentAttachment(await repository.setPreviewResult(attachment.id, { status: "failed" }));
        }
      }
      const object = await storage.inspectObject(key);
      if (
        object.fileSize !== attachment.fileSize ||
        object.mimeType?.toLowerCase() !== attachment.mimeType?.toLowerCase()
      ) {
        await storage.deleteObject(key);
        return presentAttachment(
          await repository.setScanResult(attachment.id, { status: "failed", engine: "object-metadata" }),
        );
      }

      let verdict;
      try {
        verdict = await createAttachmentScanner().scan({
          attachmentId: attachment.id,
          fileName: attachment.fileName,
          fileSize: attachment.fileSize,
          mimeType: attachment.mimeType ?? "application/octet-stream",
          downloadUrl: await storage.createDownloadUrl(key, attachment.fileName),
        });
      } catch {
        return presentAttachment(
          await repository.setScanResult(attachment.id, { status: "failed", engine: "scanner-unavailable" }),
        );
      }
      let scanned = await repository.setScanResult(attachment.id, verdict);
      await logActivity({
        organizationId: context.organizationId,
        workspaceId: context.workspaceId,
        actorId: context.actorId ?? attachment.uploaderId,
        action: verdict.status === "clean" ? "attachment.scan.clean" : "attachment.scan.infected",
        entityType: attachment.taskId ? "task" : "project",
        entityId: attachment.taskId ?? attachment.projectId!,
        newValues: { attachmentId: attachment.id, engine: verdict.engine, signature: verdict.signature },
      });
      if (verdict.status === "infected") {
        await storage.deleteObject(key);
        return presentAttachment(scanned);
      }
      try {
        scanned = await repository.setPreviewResult(
          attachment.id,
          await createAttachmentPreview(storage, {
            key,
            mimeType: attachment.mimeType ?? "application/octet-stream",
          }),
        );
      } catch {
        scanned = await repository.setPreviewResult(attachment.id, { status: "failed" });
      }
      return presentAttachment(scanned);
    },
    async delete(attachmentId: string) {
      const attachment = await repository.delete(attachmentId);
      if (!attachment.url.startsWith("s3://")) return;
      const storage = createObjectStorageAdapter();
      const key = storage.readStorageKey(attachment.url);
      if (key) await storage.deleteObject(key);
      if (attachment.previewReference) {
        const previewKey = storage.readStorageKey(attachment.previewReference);
        if (previewKey) await storage.deleteObject(previewKey);
      }
    },
  };
}
