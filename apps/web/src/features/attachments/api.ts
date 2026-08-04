import type { Attachment } from "@/lib/types";
import { apiServiceUrl, jsonRequest, request, requestJson } from "@/lib/client-api";

type UploadDescriptor = {
  url: string;
  method: string;
  headers: Record<string, string>;
};

type PreparedAttachment = Attachment & {
  upload?: UploadDescriptor;
  error?: string;
};

type UploadTaskAttachmentInput = {
  organizationId: string;
  workspaceId: string;
  taskId: string;
  uploaderId: string;
  file: File;
};

async function removePreparedAttachment(id: string, organizationId: string, workspaceId: string) {
  const query = new URLSearchParams({ id, organizationId, workspaceId });
  await request(`${apiServiceUrl("/attachments")}?${query.toString()}`, { method: "DELETE" }).catch(() => undefined);
}

export async function uploadTaskAttachment(input: UploadTaskAttachmentInput): Promise<Attachment> {
  const prepared = await requestJson<PreparedAttachment>(
    apiServiceUrl("/attachments"),
    jsonRequest("POST", {
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      taskId: input.taskId,
      uploaderId: input.uploaderId,
      fileName: input.file.name,
      fileSize: input.file.size,
      mimeType: input.file.type || "application/octet-stream",
    }),
  );

  if (!prepared.id || !prepared.upload?.url) {
    throw new Error(prepared.error || "Could not prepare attachment upload");
  }

  const uploadResponse = await fetch(prepared.upload.url, {
    method: prepared.upload.method,
    headers: prepared.upload.headers,
    body: input.file,
  });

  if (!uploadResponse.ok) {
    await removePreparedAttachment(prepared.id, input.organizationId, input.workspaceId);
    throw new Error("Object storage upload failed");
  }

  try {
    const attachment = await requestJson<Attachment>(
      apiServiceUrl("/attachments/complete"),
      jsonRequest("POST", {
        id: prepared.id,
        organizationId: input.organizationId,
        workspaceId: input.workspaceId,
      }),
    );
    if (attachment.scanStatus !== "clean") {
      throw new Error(
        attachment.scanStatus === "infected" ? "Attachment was rejected as infected" : "Attachment scanning failed",
      );
    }
    return attachment;
  } catch (error) {
    await removePreparedAttachment(prepared.id, input.organizationId, input.workspaceId);
    throw error;
  }
}
