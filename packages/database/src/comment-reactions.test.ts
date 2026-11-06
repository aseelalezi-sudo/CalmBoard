import assert from "node:assert/strict";
import test from "node:test";
import { commentReactionState } from "./comment-reactions.js";

test("legacy names remain historical even when they look exactly like user IDs", () => {
  const id = "91ce5f4e-b2bb-4014-bd4d-afd36a7b9b53";
  assert.deepEqual(commentReactionState({ "👍": ["Sara", id, { userId: id }, { userId: id }] }), {
    reactions: { "👍": ["Sara", id] },
    reactionUserIds: { "👍": [id] },
  });
});

test("malformed historical values cannot become identities", () => {
  assert.deepEqual(commentReactionState({ "👍": [null, 1, {}, { userId: 4 }, "Sara"], "🚀": null }), {
    reactions: { "👍": ["Sara"] },
    reactionUserIds: {},
  });
  assert.deepEqual(commentReactionState(null), { reactions: {}, reactionUserIds: {} });
});
