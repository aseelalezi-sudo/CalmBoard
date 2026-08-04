import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { BadRequestException } from "@nestjs/common";
import {
  fetchIntegrationOAuthIdentity,
  integrationOAuthProviderAvailability,
  parseIntegrationOAuthProvider,
} from "./integration-oauth.service";

const flagNames = [
  "INTEGRATION_GITHUB_OAUTH_ENABLED",
  "INTEGRATION_SLACK_OAUTH_ENABLED",
  "INTEGRATION_GOOGLE_OAUTH_ENABLED",
  "INTEGRATION_MICROSOFT_OAUTH_ENABLED",
] as const;
const previousFlags = Object.fromEntries(flagNames.map((name) => [name, process.env[name]]));
const previousFetch = globalThis.fetch;

afterEach(() => {
  for (const name of flagNames) {
    const value = previousFlags[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  globalThis.fetch = previousFetch;
});

describe("integration OAuth providers", () => {
  it("exposes only explicitly enabled supported providers", () => {
    for (const name of flagNames) process.env[name] = "false";
    process.env.INTEGRATION_GITHUB_OAUTH_ENABLED = "TRUE";
    process.env.INTEGRATION_GOOGLE_OAUTH_ENABLED = "true";
    assert.deepEqual(integrationOAuthProviderAvailability(), {
      github: true,
      slack: false,
      gcal: true,
      microsoft: false,
    });
    assert.equal(parseIntegrationOAuthProvider("microsoft"), "microsoft");
    assert.throws(() => parseIntegrationOAuthProvider("outlook"), BadRequestException);
  });

  it("verifies GitHub identity with a bearer token without exposing it", async () => {
    globalThis.fetch = async (_input, init) => {
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer provider-access-token");
      return Response.json({ id: 42, login: "calmboard", name: "CalmBoard Engineering" });
    };
    assert.deepEqual(await fetchIntegrationOAuthIdentity("github", "provider-access-token"), {
      externalAccountId: "42",
      displayName: "CalmBoard Engineering",
      metadata: { login: "calmboard" },
    });
  });
});
