import assert from "node:assert/strict";
import test from "node:test";
import { getDashboardLayout, updateDashboardLayout } from "./api";

test("dashboard layout API scopes requests without accepting a client actor identity", async (t) => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), init });
    return new Response(JSON.stringify({ widgets: [], version: 1 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const scope = { organizationId: "organization/a", workspaceId: "workspace/a" };
  await getDashboardLayout(scope);
  await updateDashboardLayout(scope, [{ id: "goals", width: "wide" }], 3);

  assert.match(requests[0]?.url ?? "", /organizationId=organization%2Fa/);
  assert.match(requests[0]?.url ?? "", /workspaceId=workspace%2Fa/);
  assert.doesNotMatch(requests[0]?.url ?? "", /actorId/);
  assert.equal(requests[1]?.init?.method, "PATCH");
  assert.deepEqual(JSON.parse(String(requests[1]?.init?.body)), {
    ...scope,
    widgets: [{ id: "goals", width: "wide" }],
    expectedVersion: 3,
  });
  assert.doesNotMatch(String(requests[1]?.init?.body), /actorId/);
});
