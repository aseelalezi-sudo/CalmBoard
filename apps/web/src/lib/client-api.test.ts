import assert from "node:assert/strict";
import { afterEach, it } from "node:test";
import { ApiError, apiServiceUrl, jsonRequest, requestJson } from "./client-api";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  Reflect.deleteProperty(globalThis, "window");
  Reflect.deleteProperty(globalThis, "document");
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

it("uses the API validation message instead of exposing a technical URL", async () => {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ message: ["Title is required", "Due date is invalid"], error: "Bad Request" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    })) as typeof fetch;

  await assert.rejects(
    requestJson(apiServiceUrl("/tasks")),
    (error: unknown) =>
      error instanceof ApiError &&
      error.status === 400 &&
      error.message === "Title is required • Due date is invalid" &&
      !error.message.includes("localhost"),
  );
});

it("maps an empty server error to a friendly status message", async () => {
  globalThis.fetch = (async () => new Response(undefined, { status: 503 })) as typeof fetch;

  await assert.rejects(
    requestJson(apiServiceUrl("/health")),
    (error: unknown) =>
      error instanceof ApiError && error.status === 503 && /server error occurred/i.test(error.message),
  );
});

it("does not expose an English API error inside the Arabic interface", async () => {
  Object.defineProperty(globalThis, "document", {
    value: { documentElement: { lang: "ar" } },
    configurable: true,
  });
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ message: "Title is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    })) as typeof fetch;

  await assert.rejects(
    requestJson(apiServiceUrl("/tasks")),
    (error: unknown) =>
      error instanceof ApiError &&
      error.status === 400 &&
      /[\u0600-\u06ff]/u.test(error.message) &&
      !error.message.includes("Title is required"),
  );
});

it("normalizes a connection loss after session refresh instead of leaking Failed to fetch", async () => {
  let requestCount = 0;
  globalThis.fetch = (async (url: string | URL | Request) => {
    requestCount += 1;
    if (String(url).endsWith("/auth/refresh")) return Response.json({ ok: true });
    if (requestCount === 1) return Response.json({ error: "unauthorized" }, { status: 401 });
    throw new TypeError("Failed to fetch");
  }) as typeof fetch;

  await assert.rejects(
    requestJson(apiServiceUrl("/auth/session")),
    (error: unknown) =>
      error instanceof ApiError &&
      error.status === 0 &&
      /API service is running/i.test(error.message) &&
      !error.message.includes("Failed to fetch"),
  );
});

it("does not turn a refresh connection failure into an anonymous session response", async () => {
  let requestCount = 0;
  globalThis.fetch = (async () => {
    requestCount += 1;
    if (requestCount === 1) return Response.json({ error: "expired" }, { status: 401 });
    throw new TypeError("Failed to fetch");
  }) as typeof fetch;

  await assert.rejects(
    requestJson(apiServiceUrl("/auth/session")),
    (error: unknown) => error instanceof ApiError && error.status === 0 && !error.message.includes("Failed to fetch"),
  );
});
