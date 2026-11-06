import assert from "node:assert/strict";
import test from "node:test";
import { COMMENT_REACTION_EMOJIS, commentReactionSummary } from "./reactions";
import { COMMENT_REACTION_EMOJIS as serverEmojis } from "@calmboard/types";

test("the client reaction palette matches the server contract", () => {
  assert.deepEqual(COMMENT_REACTION_EMOJIS, serverEmojis);
});

test("identical display names never make a legacy reaction active for a user", () => {
  const comment = { reactions: { "👍": ["Sara", "user-a"] }, reactionUserIds: { "👍": ["user-b", "user-b"] } };
  assert.deepEqual(commentReactionSummary(comment, "👍", "user-a"), { count: 3, legacyCount: 2, active: false });
  assert.equal(commentReactionSummary(comment, "👍", "user-b").active, true);
  assert.deepEqual(commentReactionSummary({}, "👍"), { count: 0, legacyCount: 0, active: false });
});
