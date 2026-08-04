import { apiServiceUrl, createIdempotencyKey, jsonRequest, requestJson } from "@/lib/client-api";

export type WorkspaceExportScope = {
  organizationId: string;
  workspaceId: string;
};

export type WorkspaceExportFormat = "json" | "pdf" | "xlsx";

export type WorkspaceExportJob = {
  id: string;
  format: WorkspaceExportFormat;
  status: "pending" | "processing" | "completed" | "dead" | "expired";
  attempts: number;
  maxAttempts: number;
  fileName: string | null;
  fileSize: number | null;
  checksumSha256: string | null;
  completedAt: string | null;
  expiresAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  downloadReady: boolean;
};

type WorkspaceExportDownload = {
  url: string;
  fileName: string;
  contentType: string;
};

function scopedUrl(path: string, scope: WorkspaceExportScope) {
  const query = new URLSearchParams({
    organizationId: scope.organizationId,
    workspaceId: scope.workspaceId,
  });
  return `${apiServiceUrl(path)}?${query.toString()}`;
}

export function requestWorkspaceExport(scope: WorkspaceExportScope, format: WorkspaceExportFormat = "json") {
  return requestJson<WorkspaceExportJob>(
    apiServiceUrl("/workspaces/export"),
    jsonRequest("POST", { ...scope, format }, { "Idempotency-Key": createIdempotencyKey() }),
  );
}

export function getWorkspaceExport(scope: WorkspaceExportScope, jobId: string) {
  return requestJson<WorkspaceExportJob>(scopedUrl(`/workspaces/export/${encodeURIComponent(jobId)}`, scope));
}

export function getWorkspaceExportDownload(scope: WorkspaceExportScope, jobId: string) {
  return requestJson<WorkspaceExportDownload>(
    scopedUrl(`/workspaces/export/${encodeURIComponent(jobId)}/download`, scope),
  );
}

export async function prepareWorkspaceExport(
  scope: WorkspaceExportScope,
  options: {
    format?: WorkspaceExportFormat;
    timeoutMs?: number;
    pollIntervalMs?: number;
    onStatus?: (job: WorkspaceExportJob) => void;
  } = {},
) {
  const timeoutAt = Date.now() + (options.timeoutMs ?? 3 * 60_000);
  const pollIntervalMs = options.pollIntervalMs ?? 1_000;
  let job = await requestWorkspaceExport(scope, options.format);
  options.onStatus?.(job);

  while (job.status === "pending" || job.status === "processing") {
    if (Date.now() >= timeoutAt) {
      throw new Error("Workspace export is still processing. Please try again shortly.");
    }
    await new Promise((resolve) => globalThis.setTimeout(resolve, pollIntervalMs));
    job = await getWorkspaceExport(scope, job.id);
    options.onStatus?.(job);
  }

  if (job.status !== "completed" || !job.downloadReady) {
    throw new Error(job.lastError || `Workspace export ended with status ${job.status}.`);
  }
  return getWorkspaceExportDownload(scope, job.id);
}

export function downloadPreparedWorkspaceExport(download: WorkspaceExportDownload) {
  const anchor = document.createElement("a");
  anchor.href = download.url;
  anchor.download = download.fileName;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}
