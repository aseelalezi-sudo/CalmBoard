import assert from "node:assert/strict";
import test from "node:test";
import { createCommentRecord, deleteCommentRecord, updateCommentRecord } from "./api";

test("comments API service keeps tenant scope on every mutation", async (t) => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; init?: RequestInit }> = [];

  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), init });
    return new Response(JSON.stringify({ id: "comment-1" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const scope = {
    organizationId: "organization/a",
    workspaceId: "workspace/a",
    actorId: "user/a",
  };

  await createCommentRecord({ ...scope, taskId: "task-1", userId: "user/a", content: "Hello" });
  await updateCommentRecord({ ...scope, id: "comment-1", isPinned: true });
  await deleteCommentRecord("comment/a", scope);

  assert.equal(requests[0]?.init?.method, "POST");
  assert.equal(requests[1]?.init?.method, "PATCH");
  assert.equal(requests[2]?.init?.method, "DELETE");
  assert.match(requests[2]?.url ?? "", /id=comment%2Fa/);
  assert.match(requests[2]?.url ?? "", /organizationId=organization%2Fa/);
  assert.match(requests[2]?.url ?? "", /workspaceId=workspace%2Fa/);
  assert.match(requests[2]?.url ?? "", /actorId=user%2Fa/);
});
