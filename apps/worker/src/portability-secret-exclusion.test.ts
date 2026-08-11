import assert from "node:assert/strict";
import test from "node:test";
import { assertPortabilitySecretExclusion, sanitizeNested } from "./portability-export.js";

const forbiddenKeys = [
  "password_hash",
  "session_id",
  "auth_token",
  "refresh_token",
  "mfa_secret",
  "oauth_client_secret",
  "integration_credentials",
  "invitation_encrypted_token",
  "encryption_key",
  "signed_source_url",
  "worker_payload",
  "outbox_payload",
] as const;

test("portability secret guard rejects every approved secret category", () => {
  for (const key of forbiddenKeys) {
    assert.throws(
      () => assertPortabilitySecretExclusion({ safe: { [key]: "must-not-export" } }),
      /PORTABILITY_SECRET_FIELD/,
      key,
    );
  }
});

test("portability sanitizer removes every approved secret category and strips URL credentials", () => {
  const input = Object.fromEntries(forbiddenKeys.map((key) => [key, "must-not-export"]));
  const sanitized = sanitizeNested({
    ...input,
    publicDocumentationUrl: "https://example.test/path?X-Amz-Signature=secret#fragment",
    displayName: "Safe integration",
  }) as Record<string, unknown>;

  for (const key of forbiddenKeys) assert.equal(key in sanitized, false, key);
  assert.equal(sanitized.publicDocumentationUrl, "https://example.test/path");
  assert.equal(sanitized.displayName, "Safe integration");
  assert.doesNotThrow(() => assertPortabilitySecretExclusion(sanitized));
});
