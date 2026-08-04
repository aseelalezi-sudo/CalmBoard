import { BadRequestException } from "@nestjs/common";
import type { AttachmentTarget } from "@calmboard/database";
import { requiredString, type JsonObject } from "./request-validation.js";

export const maxAttachmentSize = 50 * 1024 * 1024;
const allowedMimeTypes = new Set([
  "application/octet-stream",
  "application/pdf",
  "application/zip",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
  "text/csv",
  "text/plain",
]);
const allowedExtensions = new Set([
  "csv",
  "doc",
  "docx",
  "gif",
  "jpeg",
  "jpg",
  "md",
  "pdf",
  "png",
  "ppt",
  "pptx",
  "txt",
  "webp",
  "xls",
  "xlsx",
  "zip",
]);
const extensionsByMimeType: Record<string, Set<string>> = {
  "application/pdf": new Set(["pdf"]),
  "application/zip": new Set(["zip"]),
  "application/vnd.ms-excel": new Set(["xls"]),
  "application/vnd.ms-powerpoint": new Set(["ppt"]),
  "application/msword": new Set(["doc"]),
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": new Set(["xlsx"]),
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": new Set(["pptx"]),
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": new Set(["docx"]),
  "image/gif": new Set(["gif"]),
  "image/jpeg": new Set(["jpeg", "jpg"]),
  "image/png": new Set(["png"]),
  "image/webp": new Set(["webp"]),
  "text/csv": new Set(["csv"]),
  "text/plain": new Set(["md", "txt"]),
};

export type AttachmentUploadInput = AttachmentTarget & {
  uploaderId: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
};

export function parseAttachmentTarget(body: JsonObject): AttachmentTarget {
  const taskId = typeof body.taskId === "string" && body.taskId.trim() ? body.taskId.trim() : undefined;
  const projectId = typeof body.projectId === "string" && body.projectId.trim() ? body.projectId.trim() : undefined;
  if (Boolean(taskId) === Boolean(projectId)) {
    throw new BadRequestException("exactly one of taskId or projectId is required");
  }
  return taskId ? { taskId } : { projectId: projectId! };
}

export function parseAttachmentUploadInput(body: JsonObject): AttachmentUploadInput {
  const fileName = requiredString(body.fileName, "fileName");
  if (fileName.length > 255) throw new BadRequestException("fileName must not exceed 255 characters");
  const extension = fileName.split(".").pop()?.toLowerCase();
  if (!extension || !allowedExtensions.has(extension)) throw new BadRequestException("file extension is not allowed");
  if (
    typeof body.fileSize !== "number" ||
    !Number.isInteger(body.fileSize) ||
    body.fileSize <= 0 ||
    body.fileSize > maxAttachmentSize
  ) {
    throw new BadRequestException(`fileSize must be between 1 and ${maxAttachmentSize} bytes`);
  }
  const mimeType =
    typeof body.mimeType === "string" && body.mimeType ? body.mimeType.toLowerCase() : "application/octet-stream";
  if (!allowedMimeTypes.has(mimeType)) throw new BadRequestException("mimeType is not allowed");
  const matchingExtensions = extensionsByMimeType[mimeType];
  if (matchingExtensions && !matchingExtensions.has(extension)) {
    throw new BadRequestException("file extension does not match the declared mimeType");
  }
  return {
    ...parseAttachmentTarget(body),
    uploaderId: requiredString(body.uploaderId, "uploaderId"),
    fileName,
    fileSize: body.fileSize,
    mimeType,
  };
}
