import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getTableColumns } from "drizzle-orm";
import { securityEvents } from "./schema.js";
import { hashSecurityEmail, sanitizeSecurityMetadata } from "./repositories/security-events.js";

describe("security event audit", () => {
  it("keeps authentication evidence without raw identity or secret fields", () => {
    const columns = getTableColumns(securityEvents);
    assert.ok(columns.emailHash);
    assert.ok(columns.eventType);
    assert.ok(columns.outcome);
    assert.ok(columns.ip);
    assert.equal("email" in columns, false);
    assert.equal("password" in columns, false);
    assert.equal("token" in columns, false);
    assert.match(hashSecurityEmail(" Person@Example.test "), /^[a-f0-9]{64}$/);
    assert.deepEqual(
      sanitizeSecurityMetadata({ reason: "invalid", password: "raw", nested: { refreshToken: "raw", count: 2 } }),
      { reason: "invalid", nested: { count: 2 } },
    );
  });
});
