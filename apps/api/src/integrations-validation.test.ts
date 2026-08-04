import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseIntegrationCredentialInput, parseIntegrationProvider } from "./integrations.controller.js";

describe("integration credential request validation", () => {
  it("accepts allow-listed providers and authentication-specific secret fields", () => {
    assert.equal(parseIntegrationProvider(" GitHub "), "github");
    assert.deepEqual(
      parseIntegrationCredentialInput({
        provider: "gitlab",
        displayName: "Engineering GitLab",
        authType: "oauth2",
        secrets: { accessToken: "access", refreshToken: "refresh" },
        scopes: ["repo"],
        organizationId: "attacker-controlled-value-is-not-mapped",
      }),
      {
        provider: "gitlab",
        credentialKey: undefined,
        displayName: "Engineering GitLab",
        authType: "oauth2",
        secrets: { accessToken: "access", refreshToken: "refresh" },
        externalAccountId: undefined,
        scopes: ["repo"],
        metadata: undefined,
        expiresAt: undefined,
      },
    );
  });

  it("rejects unknown providers and secret fields that do not belong to the auth type", () => {
    assert.throws(() => parseIntegrationProvider("shell"), /provider is not supported/);
    assert.throws(
      () =>
        parseIntegrationCredentialInput({
          provider: "gitlab",
          displayName: "Unsafe GitLab",
          authType: "oauth2",
          secrets: { accessToken: "access", execute: "whoami" },
        }),
      /secrets.execute is not supported/,
    );
    assert.throws(
      () =>
        parseIntegrationCredentialInput({
          provider: "github",
          displayName: "Manual GitHub token",
          authType: "oauth2",
          secrets: { accessToken: "access" },
        }),
      /server OAuth flow/,
    );
    assert.throws(
      () =>
        parseIntegrationCredentialInput({
          provider: "webhook",
          displayName: "Unsigned webhook",
          authType: "webhook_secret",
          secrets: {},
        }),
      /secrets.webhookSecret is required/,
    );
  });
});
