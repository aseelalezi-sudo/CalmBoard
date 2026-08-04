import assert from "node:assert/strict";
import test from "node:test";
import { searchWorkspace } from "./api";

test("command search uses the protected workspace Search API", async (t) => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), init });
    return Response.json({ tasks: [], projects: [], docs: [], comments: [], users: [], teams: [], attachments: [] });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const controller = new AbortController();
  const result = await searchWorkspace(
    { organizationId: "organization/a", workspaceId: "workspace/a" },
    "budget & planning",
    controller.signal,
  );

  const requestUrl = new URL(requests[0]!.url);
  assert.equal(requestUrl.origin, "http://localhost:5500");
  assert.equal(requestUrl.pathname, "/search");
  assert.equal(requestUrl.searchParams.get("q"), "budget & planning");
  assert.equal(requestUrl.searchParams.get("organizationId"), "organization/a");
  assert.equal(requestUrl.searchParams.get("workspaceId"), "workspace/a");
  assert.equal(requestUrl.searchParams.has("actorId"), false);
  assert.equal(requests[0]!.init?.signal, controller.signal);
  assert.deepEqual(result, {
    tasks: [],
    projects: [],
    docs: [],
    comments: [],
    users: [],
    teams: [],
    attachments: [],
  });
});
