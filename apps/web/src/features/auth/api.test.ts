import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { oauthProviders, oauthStartUrl } from "./api";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("OAuth login UI reads server-side feature flags and uses API-owned authorization routes", async (t) => {
  const originalApiUrl = process.env.NEXT_PUBLIC_API_URL;
  process.env.NEXT_PUBLIC_API_URL = "https://api.example.test";
  t.after(() => {
    if (originalApiUrl === undefined) delete process.env.NEXT_PUBLIC_API_URL;
    else process.env.NEXT_PUBLIC_API_URL = originalApiUrl;
  });
  let requestedUrl = "";
  globalThis.fetch = async (input) => {
    requestedUrl = String(input);
    return Response.json({ google: true, microsoft: false });
  };
  assert.deepEqual(await oauthProviders(), { google: true, microsoft: false });
  assert.equal(requestedUrl, "https://api.example.test/auth/oauth/providers");
  assert.equal(oauthStartUrl("google"), "https://api.example.test/auth/oauth/google/start");
  assert.equal(oauthStartUrl("microsoft"), "https://api.example.test/auth/oauth/microsoft/start");
});
