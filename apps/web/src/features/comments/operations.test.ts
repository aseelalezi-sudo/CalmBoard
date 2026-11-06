import assert from "node:assert/strict";
import test from "node:test";
import type { Comment } from "@/lib/types";
import { createCommentOperations, type CommentOperationsInput } from "./operations";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

const comment = (id = "comment-1"): Comment => ({
  id,
  content: "Original",
  userId: "user-1",
  createdAt: "2026-11-04T00:00:00Z",
});

function fixture(overrides: Partial<Parameters<typeof createCommentOperations>[1]> = {}) {
  const messages: Array<{ message: string; kind?: string }> = [];
  const requests: unknown[] = [];
  let state = [comment(), comment("comment-2")];
  let operations!: ReturnType<typeof createCommentOperations>;
  let input: CommentOperationsInput = {
    taskDetail: { id: "task-a" },
    activeOrg: { id: "org-a" },
    activeWorkspace: { id: "workspace-a" },
    currentUser: { id: "user-1", name: "Sara", email: "sara@example.test" },
    comments: state,
    setComments: (update) => {
      state = typeof update === "function" ? update(state) : update;
      input = { ...input, comments: state };
      operations.synchronize(input);
    },
    t: (_arabic, english) => english,
    notify: (message, kind) => {
      messages.push({ message, kind });
    },
  };
  operations = createCommentOperations(input, {
    create: async (value) => {
      requests.push(value);
      return { ...comment("created"), content: value.content };
    },
    update: async (value) => {
      requests.push(value);
    },
    remove: async (id, scope) => {
      requests.push({ id, ...scope });
    },
    react: async (value) => {
      requests.push(value);
      const current = state.find((item) => item.id === value.id);
      return { id: value.id, reactions: current?.reactions ?? {}, reactionUserIds: current?.reactionUserIds ?? {} };
    },
    confirmDelete: async () => true,
    ...overrides,
  });
  return {
    operations,
    messages,
    requests,
    get comments() {
      return state;
    },
    change(patch: Partial<CommentOperationsInput>) {
      input = { ...input, ...patch };
      state = input.comments;
      operations.synchronize(input);
    },
  };
}

test("failed edits restore content and mentions and report an error without a success notice", async (t) => {
  for (const status of [0, 403, 409, 500]) {
    await t.test(`failure ${status}`, async () => {
      const pending = deferred<void>();
      const f = fixture({ update: () => pending.promise });
      const saving = f.operations.editComment("comment-1", "Changed", ["mentioned-user"]);
      assert.equal(f.comments[0].content, "Changed");
      assert.deepEqual(f.comments[0].mentionedUserIds, ["mentioned-user"]);
      pending.reject(Object.assign(new Error("private server detail"), { status }));
      assert.equal(await saving, false);
      assert.equal(f.comments[0].content, "Original");
      assert.equal(f.comments[0].mentionedUserIds, undefined);
      assert.equal(f.messages.length, 1);
      assert.equal(f.messages[0].kind, "error");
      assert.doesNotMatch(f.messages[0].message, /private/);
    });
  }
});

test("rollback preserves another comment and newer realtime fields", async () => {
  const pending = deferred<void>();
  const f = fixture({ update: () => pending.promise });
  const saving = f.operations.editComment("comment-1", "Optimistic");
  f.change({
    comments: f.comments.map((item) => ({
      ...item,
      content: item.id === "comment-1" ? "Realtime revision" : "Other change",
      isPinned: true,
    })),
  });
  pending.reject(new Error("offline"));
  assert.equal(await saving, false);
  assert.equal(f.comments[0].content, "Realtime revision");
  assert.equal(f.comments[0].isPinned, true);
  assert.equal(f.comments[1].content, "Other change");
});

test("failed pin and reaction changes restore their previous values", async () => {
  const f = fixture({
    update: async () => {
      throw new Error("offline");
    },
    react: async () => {
      throw new Error("offline");
    },
  });
  assert.equal(await f.operations.togglePinComment("comment-1", true), false);
  assert.equal(f.comments[0].isPinned, undefined);
  assert.equal(await f.operations.toggleReaction("comment-1", "👍"), false);
  assert.equal(f.comments[0].reactionUserIds, undefined);
});

test("failed deletion restores the comment in order without losing concurrent changes", async () => {
  const pending = deferred<void>();
  const f = fixture({ remove: () => pending.promise });
  const deleting = f.operations.deleteComment("comment-1");
  await Promise.resolve();
  assert.deepEqual(
    f.comments.map((item) => item.id),
    ["comment-2"],
  );
  f.change({ comments: [comment("new"), { ...f.comments[0], content: "Concurrent edit" }] });
  pending.reject(new Error("offline"));
  assert.equal(await deleting, false);
  assert.deepEqual(
    f.comments.map((item) => item.id),
    ["new", "comment-1", "comment-2"],
  );
  assert.equal(f.comments[2].content, "Concurrent edit");
});

test("failed deletion does not duplicate a comment restored by realtime", async () => {
  const pending = deferred<void>();
  const f = fixture({ remove: () => pending.promise });
  const deleting = f.operations.deleteComment("comment-1");
  await Promise.resolve();
  f.change({ comments: [{ ...comment(), content: "Latest" }, ...f.comments] });
  pending.reject(new Error("offline"));
  await deleting;
  assert.equal(f.comments.filter((item) => item.id === "comment-1").length, 1);
  assert.equal(f.comments[0].content, "Latest");
});

test("same-comment requests are exclusive while other comments can save", async () => {
  const pending = deferred<void>();
  let requests = 0;
  const f = fixture({
    update: async (value) => {
      requests++;
      if (value.id === "comment-1") await pending.promise;
    },
  });
  const first = f.operations.editComment("comment-1", "First");
  assert.equal(await f.operations.editComment("comment-1", "Second"), false);
  assert.equal(await f.operations.togglePinComment("comment-1", true), false);
  assert.equal(await f.operations.editComment("comment-2", "Independent"), true);
  assert.equal(requests, 2);
  pending.reject(new Error("offline"));
  await first;
  assert.equal(f.comments[0].content, "Original");
  assert.equal(f.comments[1].content, "Independent");
});

test("creation is exclusive, deduplicates realtime delivery and keeps the authenticated scope", async () => {
  const pending = deferred<Comment>();
  const requests: unknown[] = [];
  const f = fixture({
    create: (value) => {
      requests.push(value);
      return pending.promise;
    },
  });
  const adding = f.operations.addComment(" Reply ", { parentId: "parent", mentionedUserIds: ["mentioned-user"] });
  assert.equal(await f.operations.addComment("Reply"), false);
  f.change({ comments: [comment("created"), ...f.comments] });
  pending.resolve(comment("created"));
  assert.equal(await adding, true);
  assert.equal(f.comments.filter((item) => item.id === "created").length, 1);
  assert.deepEqual(requests, [
    {
      organizationId: "org-a",
      workspaceId: "workspace-a",
      actorId: "user-1",
      userId: "user-1",
      taskId: "task-a",
      content: "Reply",
      parentId: "parent",
      mentionedUserIds: ["mentioned-user"],
    },
  ]);
});

test("creation failure returns false and releases the lock for retry", async () => {
  let attempt = 0;
  const f = fixture({
    create: async () => {
      if (attempt++ === 0) throw new Error("offline");
      return comment("created");
    },
  });
  assert.equal(await f.operations.addComment("Draft"), false);
  assert.equal(f.comments.length, 2);
  assert.equal(await f.operations.addComment("Draft"), true);
  assert.equal(f.comments[0].id, "created");
});

test("reaction commands use IDs, preserve historical names and accept canonical concurrent actors", async () => {
  const pending = deferred<{
    id: string;
    reactions: Record<string, string[]>;
    reactionUserIds: Record<string, string[]>;
  }>();
  const requests: Array<{ emoji: string; active: boolean; actorId?: string }> = [];
  const f = fixture({
    react: async (value) => {
      requests.push(value);
      if (requests.length === 1) return pending.promise;
      return { id: value.id, reactions: { "👍": ["Sara"] }, reactionUserIds: { "👍": ["user-2", "user-3"] } };
    },
  });
  f.change({ comments: [{ ...comment(), reactions: { "👍": ["Sara"] }, reactionUserIds: { "👍": ["user-2"] } }] });
  const saving = f.operations.toggleReaction("comment-1", "👍");
  assert.deepEqual(f.comments[0].reactionUserIds?.["👍"], ["user-2", "user-1"]);
  assert.deepEqual(f.comments[0].reactions?.["👍"], ["Sara"]);
  assert.equal(await f.operations.toggleReaction("comment-1", "👍"), false);
  pending.resolve({
    id: "comment-1",
    reactions: { "👍": ["Sara"] },
    reactionUserIds: { "👍": ["user-1", "user-2", "user-3"] },
  });
  assert.equal(await saving, true);
  assert.equal(requests[0].actorId, "user-1");
  assert.equal(requests[0].active, true);
  assert.equal("reactions" in requests[0], false);
  assert.deepEqual(f.comments[0].reactionUserIds?.["👍"], ["user-1", "user-2", "user-3"]);
  f.change({ currentUser: { id: "user-1", name: "New name", email: "sara@example.test" } });
  assert.equal(await f.operations.toggleReaction("comment-1", "👍"), true);
  assert.equal(requests[1].active, false);
  assert.deepEqual(f.comments[0].reactionUserIds?.["👍"], ["user-2", "user-3"]);
});

test("old create responses do not appear in another task, even after returning A -> B -> A", async () => {
  const pending = deferred<Comment>();
  const f = fixture({ create: () => pending.promise });
  const adding = f.operations.addComment("Old draft");
  f.change({ taskDetail: { id: "task-b" }, comments: [comment("b")] });
  f.change({ taskDetail: { id: "task-a" }, comments: [comment("fresh-a")] });
  pending.resolve(comment("late"));
  assert.equal(await adding, false);
  assert.deepEqual(
    f.comments.map((item) => item.id),
    ["fresh-a"],
  );
  assert.deepEqual(f.messages, []);
});

test("old failures cannot restore data or notify a new workspace or user", async (t) => {
  for (const change of [
    { activeWorkspace: { id: "workspace-b" } },
    { currentUser: { id: "other", name: "Other", email: "other@example.test" } },
  ]) {
    await t.test(Object.keys(change)[0], async () => {
      const pending = deferred<void>();
      const f = fixture({ update: () => pending.promise });
      const saving = f.operations.editComment("comment-1", "Old edit");
      f.change({ ...change, comments: [{ ...comment(), content: "New context" }] });
      pending.reject(new Error("offline"));
      assert.equal(await saving, false);
      assert.equal(f.comments[0].content, "New context");
      assert.deepEqual(f.messages, []);
    });
  }
});

test("delete confirmation cannot issue a request after navigation and cancellation is harmless", async () => {
  const pending = deferred<boolean>();
  const f = fixture({ confirmDelete: () => pending.promise });
  const deleting = f.operations.deleteComment("comment-1");
  f.change({ taskDetail: { id: "task-b" }, comments: [comment("b")] });
  pending.resolve(true);
  assert.equal(await deleting, false);
  assert.deepEqual(f.requests, []);
  assert.equal(f.comments[0].id, "b");
  const cancelled = fixture({ confirmDelete: async () => false });
  assert.equal(await cancelled.operations.deleteComment("comment-1"), false);
  assert.equal(cancelled.comments.length, 2);
  assert.deepEqual(cancelled.requests, []);
});

test("unmount invalidates queued state updates and remount cannot revive them", async () => {
  const pending = deferred<void>();
  const f = fixture({ update: () => pending.promise });
  const queued: Array<(comments: Comment[]) => Comment[]> = [];
  f.change({
    setComments: (update) => {
      if (typeof update === "function") queued.push(update);
    },
  });
  const saving = f.operations.editComment("comment-1", "Old edit");
  f.operations.dispose();
  f.change({});
  const fresh = [comment("fresh")];
  assert.strictEqual(queued[0](fresh), fresh);
  pending.reject(new Error("offline"));
  assert.equal(await saving, false);
  assert.deepEqual(f.messages, []);
});
