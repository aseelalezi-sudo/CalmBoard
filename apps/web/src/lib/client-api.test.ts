import assert from "node:assert/strict";
import { afterEach, it } from "node:test";
import { apiServiceUrl, jsonRequest, requestJson } from "./client-api";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  Reflect.deleteProperty(globalThis, "window");
});

it("bootstraps a CSRF cookie and sends the matching header on API mutations", async () => {
  Object.defineProperty(globalThis, "window", { value: {}, configurable: true });
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), init });
    if (String(url).endsWith("/auth/csrf")) {
      return new Response(JSON.stringify({ token: "signed-csrf-token" }), {
        status: 200,
        headers: { "Content-Type": "application/json", "Set-Cookie": "calmboard_csrf=signed-csrf-token" },
      });
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  await requestJson<{ ok: true }>(apiServiceUrl("/tasks"), jsonRequest("POST", { title: "Protected" }));

  assert.equal(requests.length, 2);
  assert.match(requests[0]?.url ?? "", /\/auth\/csrf$/);
  assert.equal(new Headers(requests[1]?.init?.headers).get("x-csrf-token"), "signed-csrf-token");
  assert.equal(requests[1]?.init?.credentials, "include");
});
