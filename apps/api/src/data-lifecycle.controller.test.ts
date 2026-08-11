import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ServiceUnavailableException } from "@nestjs/common";
import { deletionRuntimeConfig } from "./data-lifecycle.controller.js";

describe("data lifecycle API configuration", () => {
  it("keeps destructive lifecycle disabled unless explicitly enabled", () => {
    assert.throws(() => deletionRuntimeConfig({}), ServiceUnavailableException);
  });

  it("requires an explicit grace setting and policy version", () => {
    assert.throws(() => deletionRuntimeConfig({ DATA_LIFECYCLE_ENABLED: "true" }), /DATA_DELETION_GRACE_HOURS/);
    assert.throws(
      () => deletionRuntimeConfig({ DATA_LIFECYCLE_ENABLED: "true", DATA_DELETION_GRACE_HOURS: "24" }),
      /DATA_LIFECYCLE_POLICY_VERSION/,
    );
    assert.deepEqual(
      deletionRuntimeConfig({
        DATA_LIFECYCLE_ENABLED: "true",
        DATA_DELETION_GRACE_HOURS: "72",
        DATA_LIFECYCLE_POLICY_VERSION: "privacy-v1",
      }),
      { graceHours: 72, policyVersion: "privacy-v1" },
    );
  });
});
