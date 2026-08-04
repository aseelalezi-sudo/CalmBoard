import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { oauthProviders, oauthStartUrl } from "./api";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("OAuth login UI reads server-side feature flags and uses API-owned authorization routes", async () => {
  let requestedUrl = "";
  globalThis.fetch = async (input) => {
    requestedUrl = String(input);
    return Response.json({ google: true, microsoft: false });
  };
  assert.deepEqual(await oauthProviders(), { google: true, microsoft: false });
  assert.equal(requestedUrl, "http://localhost:5500/auth/oauth/providers");
  assert.equal(oauthStartUrl("google"), "http://localhost:5500/auth/oauth/google/start");
  assert.equal(oauthStartUrl("microsoft"), "http://localhost:5500/auth/oauth/microsoft/start");
});
