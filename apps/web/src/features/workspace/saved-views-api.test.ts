import assert from "node:assert/strict";
import test from "node:test";
import { deleteSavedViewRecord, updateSavedViewRecord } from "./saved-views-api";

test("saved view API service keeps tenant scope and stored view type on mutations", async (t) => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), init });
    return new Response(JSON.stringify({ id: "view-1", viewType: "table" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const scope = { organizationId: "organization/a", workspaceId: "workspace/a", actorId: "user/a" };
  await updateSavedViewRecord(scope, { id: "view-1", viewType: "table" }, { isShared: true });
  await deleteSavedViewRecord(scope, "view/1");

  assert.equal(requests[0]?.init?.method, "PATCH");
  assert.deepEqual(JSON.parse(String(requests[0]?.init?.body)), {
    ...scope,
    id: "view-1",
    viewType: "table",
    isShared: true,
  });
  assert.equal(requests[1]?.init?.method, "DELETE");
  assert.match(requests[1]?.url ?? "", /organizationId=organization%2Fa/);
  assert.match(requests[1]?.url ?? "", /workspaceId=workspace%2Fa/);
  assert.match(requests[1]?.url ?? "", /actorId=user%2Fa/);
  assert.match(requests[1]?.url ?? "", /id=view%2F1/);
});
