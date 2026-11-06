import assert from "node:assert/strict";
import test from "node:test";
import { searchWorkspace } from "./api";

test("command search uses the protected workspace Search API", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalApiUrl = process.env.NEXT_PUBLIC_API_URL;
  process.env.NEXT_PUBLIC_API_URL = "https://api.example.test";
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), init });
    return Response.json({ tasks: [], projects: [], docs: [], comments: [], users: [], teams: [], attachments: [] });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalApiUrl === undefined) delete process.env.NEXT_PUBLIC_API_URL;
    else process.env.NEXT_PUBLIC_API_URL = originalApiUrl;
  });

  const controller = new AbortController();
  const result = await searchWorkspace(
    { organizationId: "organization/a", workspaceId: "workspace/a" },
    "budget & planning",
    controller.signal,
  );

  const requestUrl = new URL(requests[0]!.url);
  assert.equal(requestUrl.origin, "https://api.example.test");
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
