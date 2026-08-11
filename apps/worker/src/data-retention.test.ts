import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { organizationPurgeDomains, readOrganizationPurgePolicy } from "./data-retention.js";

describe("technical data retention classifications", () => {
  it("keeps Organization purge disabled by default", () => {
    assert.deepEqual(readOrganizationPurgePolicy({}), { enabled: false });
  });

  it("requires every closed domain and blocks unresolved policy", () => {
    assert.throws(() => readOrganizationPurgePolicy({ ORGANIZATION_PURGE_ENABLED: "true" }), /is required/);
    const unresolved = Object.fromEntries(organizationPurgeDomains.map((domain) => [domain, "PURGE"]));
    unresolved.billing_provider = "RETAIN_UNTIL_POLICY";
    assert.throws(
      () =>
        readOrganizationPurgePolicy({
          ORGANIZATION_PURGE_ENABLED: "true",
          DATA_RETENTION_CLASSIFICATIONS_JSON: JSON.stringify(unresolved),
        }),
      /blocked by unresolved retention policy: billing_provider/,
    );
  });

  it("accepts only a complete approved technical matrix", () => {
    const matrix = Object.fromEntries(organizationPurgeDomains.map((domain) => [domain, "PURGE"]));
    matrix.integration_oauth = "EXTERNAL_REVOCATION";
    assert.deepEqual(
      readOrganizationPurgePolicy({
        ORGANIZATION_PURGE_ENABLED: "true",
        DATA_RETENTION_CLASSIFICATIONS_JSON: JSON.stringify(matrix),
      }),
      { enabled: true, classifications: matrix },
    );
  });
});
