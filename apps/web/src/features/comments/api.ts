import type { Comment } from "@/lib/types";
import { apiServiceUrl, jsonRequest, request, requestJson } from "@/lib/client-api";

type CommentScope = {
  organizationId: string;
  workspaceId: string;
  actorId?: string;
};

type CreateCommentInput = CommentScope & {
  taskId: string;
  userId: string;
  content: string;
};

type UpdateCommentInput = CommentScope & {
  id: string;
  content?: string;
  isPinned?: boolean;
  reactions?: Record<string, string[]>;
};

export async function createCommentRecord(input: CreateCommentInput) {
  return requestJson<Comment>(apiServiceUrl("/comments"), jsonRequest("POST", input));
}

export async function updateCommentRecord(input: UpdateCommentInput) {
  await request(apiServiceUrl("/comments"), jsonRequest("PATCH", input));
}

export async function deleteCommentRecord(id: string, scope: CommentScope) {
  const query = new URLSearchParams({
    id,
    organizationId: scope.organizationId,
    workspaceId: scope.workspaceId,
  });
  if (scope.actorId) query.set("actorId", scope.actorId);
  await request(`${apiServiceUrl("/comments")}?${query.toString()}`, { method: "DELETE" });
}
