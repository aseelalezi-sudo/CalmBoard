"use client";

import { useEffect, useState } from "react";
import type { User } from "@/lib/types";
import { getEligibleMentionUsers } from "./api";

type MentionUser = Pick<User, "id" | "name" | "email" | "avatarUrl">;

export function useMentionUsers(input: {
  taskId?: string;
  organizationId?: string;
  workspaceId?: string;
  actorId?: string;
  query: string;
  enabled: boolean;
}) {
  const [users, setUsers] = useState<MentionUser[]>([]);
  const { taskId, organizationId, workspaceId, actorId, query, enabled } = input;

  useEffect(() => {
    if (!enabled || !taskId || !organizationId || !workspaceId) {
      setUsers([]);
      return;
    }
    let disposed = false;
    void getEligibleMentionUsers(taskId, { organizationId, workspaceId, actorId }, query)
      .then((result) => {
        if (!disposed) setUsers(result.filter((user) => user.id !== actorId));
      })
      .catch(() => {
        if (!disposed) setUsers([]);
      });
    return () => {
      disposed = true;
    };
  }, [taskId, organizationId, workspaceId, actorId, query, enabled]);

  return { users, clear: () => setUsers([]) };
}
