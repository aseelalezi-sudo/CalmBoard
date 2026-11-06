import type { Comment } from "@/lib/types";

// The server remains authoritative; a contract test keeps this client palette
// aligned without requiring a prebuilt shared package to start Next dev.
export const COMMENT_REACTION_EMOJIS = ["👍", "❤️", "🎉", "🚀", "👀"] as const;

export function commentReactionSummary(
  comment: Pick<Comment, "reactions" | "reactionUserIds">,
  emoji: string,
  userId?: string,
) {
  const identities = new Set(comment.reactionUserIds?.[emoji] ?? []);
  const legacyCount = comment.reactions?.[emoji]?.length ?? 0;
  return { count: identities.size + legacyCount, legacyCount, active: Boolean(userId && identities.has(userId)) };
}
