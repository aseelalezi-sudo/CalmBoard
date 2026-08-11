import assert from "node:assert/strict";
import test from "node:test";
import { getOrganizationAuthorization, requestOrganizationExport, requestWorkspaceExport } from "./export-api";

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

test("organization export API uses the persisted organization route and omits client identity and scope fields", async (t) => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), init });
    return new Response(
      JSON.stringify(
        requests.length === 1
          ? { userId: "user-1", permissions: ["data.export"] }
          : { id: "export-1", format: "json", status: "pending" },
      ),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  await getOrganizationAuthorization({ organizationId: "organization/a" });
  await requestOrganizationExport({ organizationId: "organization/a" });

  const authorizationUrl = new URL(requests[0]!.url);
  assert.equal(authorizationUrl.pathname, "/authorization/me");
  assert.equal(authorizationUrl.searchParams.get("organizationId"), "organization/a");
  assert.equal(authorizationUrl.searchParams.has("workspaceId"), false);
  assert.match(new URL(requests[1]!.url).pathname, /\/organizations\/organization%2Fa\/export$/);
  assert.deepEqual(JSON.parse(String(requests[1]!.init?.body)), {});
  assert.doesNotMatch(String(requests[1]!.init?.body), /actorId|workspaceId|exportScope/);
  assert.ok(requests[1]!.init?.headers && new Headers(requests[1]!.init?.headers).get("Idempotency-Key"));
});
