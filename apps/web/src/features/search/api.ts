import type { Doc, Project, Task, Team, User } from "@/lib/types";
import { apiServiceUrl, requestJson } from "@/lib/client-api";

export type SearchScope = {
  organizationId: string;
  workspaceId: string;
};

export type SearchComment = {
  id: string;
  organizationId: string;
  workspaceId: string;
  taskId: string;
  userId: string;
  content: string;
  createdAt: string;
};

export type SearchTeam = Team & {
  organizationId: string;
  workspaceId: string;
  description?: string | null;
};

export type SearchAttachment = {
  id: string;
  organizationId: string;
  workspaceId: string;
  taskId?: string | null;
  projectId?: string | null;
  uploaderId: string;
  fileName: string;
  fileSize: number;
  mimeType?: string | null;
  scanStatus: "pending" | "clean" | "infected" | "failed";
  previewStatus: "pending" | "ready" | "source" | "unsupported" | "failed";
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceSearchResults = {
  tasks: Task[];
  projects: Project[];
  docs: Doc[];
  comments: SearchComment[];
  users: User[];
  teams: SearchTeam[];
  attachments: SearchAttachment[];
};

export function emptyWorkspaceSearchResults(): WorkspaceSearchResults {
  return { tasks: [], projects: [], docs: [], comments: [], users: [], teams: [], attachments: [] };
}

export function searchWorkspace(scope: SearchScope, query: string, signal?: AbortSignal) {
  const parameters = new URLSearchParams({
    q: query,
    organizationId: scope.organizationId,
    workspaceId: scope.workspaceId,
  });
  return requestJson<WorkspaceSearchResults>(`${apiServiceUrl("/search")}?${parameters.toString()}`, { signal });
}
