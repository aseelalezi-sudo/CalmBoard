import assert from "node:assert/strict";
import test from "node:test";
import type { Attachment, Comment, Task } from "@/lib/types";
import { createTaskDetailLoader } from "./task-detail-loader";

type Bundle = Awaited<ReturnType<Parameters<typeof createTaskDetailLoader>[0]["load"]>>;
function deferred() {
  let resolve!: (value: Bundle) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<Bundle>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const task = (id: string) => ({ id, organizationId: "org", workspaceId: "workspace", title: id }) as Task;
const bundle = (id: string): Bundle => ({
  task: task(id),
  comments: [{ id: `comment-${id}`, content: id, userId: "user", createdAt: "2026-11-04" }],
  attachments: [{ id: `attachment-${id}` } as Attachment],
  subtasks: [task(`subtask-${id}`)],
  checklists: [],
  approvals: [],
});

function fixture() {
  const requests = new Map<string, ReturnType<typeof deferred>>();
  const state: { task: Task | null; comments: Comment[]; attachments: Attachment[]; subtasks: Task[] } = {
    task: null,
    comments: [],
    attachments: [],
    subtasks: [],
  };
  let errors = 0;
  const loader = createTaskDetailLoader({
    load: (value) => {
      const request = deferred();
      requests.set(value.id, request);
      return request.promise;
    },
    setTask: (update) => {
      state.task = typeof update === "function" ? update(state.task) : update;
    },
    setComments: (update) => {
      state.comments = typeof update === "function" ? update(state.comments) : update;
    },
    setAttachments: (update) => {
      state.attachments = typeof update === "function" ? update(state.attachments) : update;
    },
    setSubtasks: (update) => {
      state.subtasks = typeof update === "function" ? update(state.subtasks) : update;
    },
  });
  return {
    loader,
    state,
    requests,
    get errors() {
      return errors;
    },
    load(id: string, optimistic: Task | null = task(id)) {
      return loader.load(task(id), optimistic, "scope-a", () => {
        errors++;
      });
    },
  };
}

test("a late task-detail response cannot replace a newer task's comments or related data", async () => {
  const f = fixture();
  const first = f.load("a");
  const second = f.load("b");
  f.requests.get("b")!.resolve(bundle("b"));
  assert.equal(await second, true);
  f.requests.get("a")!.resolve(bundle("a"));
  assert.equal(await first, false);
  assert.equal(f.state.task?.id, "b");
  assert.equal(f.state.comments[0].id, "comment-b");
  assert.equal(f.state.attachments[0].id, "attachment-b");
  assert.equal(f.state.subtasks[0].id, "subtask-b");
});

test("closing the drawer invalidates the entire pending bundle", async () => {
  const f = fixture();
  const loading = f.load("a");
  f.state.task = null;
  f.loader.synchronize("scope-a", null);
  f.requests.get("a")!.resolve(bundle("a"));
  assert.equal(await loading, false);
  assert.equal(f.state.task, null);
  assert.deepEqual(f.state.comments, []);
  assert.deepEqual(f.state.attachments, []);
});

test("switching scope and returning cannot revive an old request", async () => {
  const f = fixture();
  const loading = f.load("a");
  f.loader.synchronize("scope-b", "a");
  f.loader.synchronize("scope-a", "a");
  f.requests.get("a")!.resolve(bundle("a"));
  assert.equal(await loading, false);
  assert.deepEqual(f.state.comments, []);
});

test("loading a task by ID works without an optimistic drawer", async () => {
  const f = fixture();
  const loading = f.load("a", null);
  f.loader.synchronize("scope-a", null);
  f.requests.get("a")!.resolve(bundle("a"));
  assert.equal(await loading, true);
  f.loader.synchronize("scope-a", "a");
  assert.equal(f.state.task?.id, "a");
  assert.equal(f.state.comments[0].id, "comment-a");
});

test("only current detail failures display an error and retry stays available", async () => {
  const f = fixture();
  const first = f.load("a");
  const second = f.load("b");
  f.requests.get("a")!.reject(new Error("old failure"));
  await first;
  assert.equal(f.errors, 0);
  f.requests.get("b")!.reject(new Error("current failure"));
  await second;
  assert.equal(f.errors, 1);
  const retry = f.load("b");
  f.requests.get("b")!.resolve(bundle("b"));
  assert.equal(await retry, true);
});

test("unmount ignores completion of a pending task load", async () => {
  const f = fixture();
  const loading = f.load("a");
  f.loader.dispose();
  f.requests.get("a")!.resolve(bundle("a"));
  assert.equal(await loading, false);
  assert.deepEqual(f.state.comments, []);
});
