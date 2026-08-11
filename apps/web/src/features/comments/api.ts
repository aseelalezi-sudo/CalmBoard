import type { Comment, User } from "@/lib/types";
import { apiServiceUrl, createIdempotencyKey, jsonRequest, request, requestJson } from "@/lib/client-api";

type CommentScope = {
  organizationId: string;
  workspaceId: string;
  actorId?: string;
};

type CreateCommentInput = CommentScope & {
  taskId: string;
  userId: string;
  content: string;
  parentId?: string;
  mentionedUserIds?: string[];
};

type UpdateCommentInput = CommentScope & {
  id: string;
  content?: string;
  isPinned?: boolean;
  reactions?: Record<string, string[]>;
  mentionedUserIds?: string[];
};

export async function createCommentRecord(input: CreateCommentInput) {
  return requestJson<Comment>(
    apiServiceUrl("/comments"),
    jsonRequest("POST", input, { "Idempotency-Key": createIdempotencyKey() }),
  );
}

export async function updateCommentRecord(input: UpdateCommentInput) {
  await request(apiServiceUrl("/comments"), jsonRequest("PATCH", input, { "Idempotency-Key": createIdempotencyKey() }));
}

export function getEligibleMentionUsers(taskId: string, scope: CommentScope, search = "") {
  const query = new URLSearchParams({
    taskId,
    organizationId: scope.organizationId,
    workspaceId: scope.workspaceId,
    search,
  });
  if (scope.actorId) query.set("actorId", scope.actorId);
  return requestJson<Array<Pick<User, "id" | "name" | "email" | "avatarUrl">>>(
    `${apiServiceUrl("/comments/mentions")}?${query.toString()}`,
  );
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
