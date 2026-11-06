// Strings are historical display names. New entries are explicitly tagged so
// even a legacy name resembling a UUID can never be mistaken for an identity.
export type StoredCommentReactions = Record<string, Array<string | { userId: string }>>;

export function commentReactionState(stored: unknown) {
  const legacy: Array<[string, string[]]> = [];
  const identities: Array<[string, string[]]> = [];
  if (stored && typeof stored === "object" && !Array.isArray(stored)) {
    for (const [emoji, values] of Object.entries(stored)) {
      if (!Array.isArray(values)) continue;
      const names: string[] = [];
      const ids = new Set<string>();
      for (const value of values) {
        if (typeof value === "string") names.push(value);
        else if (value && typeof value === "object" && typeof value.userId === "string" && value.userId)
          ids.add(value.userId);
      }
      if (names.length) legacy.push([emoji, names]);
      if (ids.size) identities.push([emoji, [...ids]]);
    }
  }
  return { reactions: Object.fromEntries(legacy), reactionUserIds: Object.fromEntries(identities) };
}
