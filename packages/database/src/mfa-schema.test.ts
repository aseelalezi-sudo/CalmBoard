import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getTableColumns } from "drizzle-orm";
import { mfaRecoveryCodes, userMfaFactors } from "./schema.js";
import { generateTotpCode } from "./repositories/mfa.js";

describe("TOTP and recovery code security", () => {
  it("matches the RFC 6238 SHA-1 test vector", () => {
    assert.equal(generateTotpCode("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", 59_000, 8), "94287082");
  });

  it("stores only an authenticated encryption envelope and recovery hashes", () => {
    const factor = getTableColumns(userMfaFactors);
    assert.ok(factor.encryptedTotpSecret);
    assert.ok(factor.initializationVector);
    assert.ok(factor.authenticationTag);
    assert.ok(factor.encryptionKeyVersion);
    assert.equal("totpSecret" in factor, false);
    const recovery = getTableColumns(mfaRecoveryCodes);
    assert.ok(recovery.codeHash);
    assert.equal("code" in recovery, false);
  });
});
