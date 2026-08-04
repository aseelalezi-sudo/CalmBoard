import type { Doc } from "@/lib/types";
import { apiServiceUrl, jsonRequest, requestJson } from "@/lib/client-api";

export type DocumentVersion = {
  id: string;
  versionNumber: number;
  title: string;
  content?: string | null;
  createdAt: string | Date;
  savedBy?: { name?: string | null } | null;
};

export type DocumentPermission = {
  id: string;
  userId: string;
  accessLevel: "viewer" | "editor" | "manager";
  user?: { id: string; name: string; email: string } | null;
};

type DocumentScope = Pick<Doc, "id" | "organizationId" | "workspaceId">;

export function getDocumentVersions(document: DocumentScope) {
  const query = new URLSearchParams({
    organizationId: document.organizationId,
    workspaceId: document.workspaceId,
  });
  return requestJson<DocumentVersion[]>(
    `${apiServiceUrl(`/docs/${encodeURIComponent(document.id)}/versions`)}?${query.toString()}`,
  );
}

export function saveDocumentSnapshot(document: DocumentScope) {
  return requestJson<{ ok: boolean }>(
    apiServiceUrl(`/docs/${encodeURIComponent(document.id)}/versions`),
    jsonRequest("POST", {
      action: "save_snapshot",
      organizationId: document.organizationId,
      workspaceId: document.workspaceId,
    }),
  );
}

export function restoreDocumentVersion(document: DocumentScope, versionId: string) {
  return requestJson<{ ok: boolean; doc?: Pick<Doc, "title" | "content"> }>(
    apiServiceUrl(`/docs/${encodeURIComponent(document.id)}/versions`),
    jsonRequest("POST", {
      action: "restore",
      versionId,
      organizationId: document.organizationId,
      workspaceId: document.workspaceId,
    }),
  );
}

export function getDocumentPermissions(document: DocumentScope) {
  const query = new URLSearchParams({
    organizationId: document.organizationId,
    workspaceId: document.workspaceId,
  });
  return requestJson<DocumentPermission[]>(
    `${apiServiceUrl(`/docs/${encodeURIComponent(document.id)}/permissions`)}?${query.toString()}`,
  );
}

export function setDocumentPermission(
  document: DocumentScope,
  targetUserId: string,
  accessLevel: DocumentPermission["accessLevel"],
) {
  return requestJson<DocumentPermission>(
    apiServiceUrl(`/docs/${encodeURIComponent(document.id)}/permissions`),
    jsonRequest("POST", {
      organizationId: document.organizationId,
      workspaceId: document.workspaceId,
      targetUserId,
      accessLevel,
    }),
  );
}

export function removeDocumentPermission(document: DocumentScope, targetUserId: string) {
  const query = new URLSearchParams({
    organizationId: document.organizationId,
    workspaceId: document.workspaceId,
    targetUserId,
  });
  return requestJson<{ ok: boolean }>(
    `${apiServiceUrl(`/docs/${encodeURIComponent(document.id)}/permissions`)}?${query.toString()}`,
    { method: "DELETE" },
  );
}
