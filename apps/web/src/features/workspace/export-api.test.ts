import assert from "node:assert/strict";
import test from "node:test";
import { requestWorkspaceExport } from "./export-api";

test("workspace export API sends an allow-listed server format without a client actor identity", async (t) => {
  const originalFetch = globalThis.fetch;
  let request: { url: string; init?: RequestInit } | undefined;
  globalThis.fetch = async (input, init) => {
    request = { url: String(input), init };
    return new Response(JSON.stringify({ id: "export-1", format: "xlsx", status: "pending" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  await requestWorkspaceExport({ organizationId: "organization-1", workspaceId: "workspace-1" }, "xlsx");
  assert.equal(request?.init?.method, "POST");
  assert.deepEqual(JSON.parse(String(request?.init?.body)), {
    organizationId: "organization-1",
    workspaceId: "workspace-1",
    format: "xlsx",
  });
  assert.doesNotMatch(String(request?.init?.body), /actorId/);
  assert.ok(request?.init?.headers && new Headers(request.init.headers).get("Idempotency-Key"));
});
