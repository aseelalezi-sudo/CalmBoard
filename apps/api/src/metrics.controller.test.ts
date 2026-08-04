import assert from "node:assert/strict";
import test from "node:test";
import { validMetricsAuthorization } from "./metrics.controller.js";

test("metrics bearer authorization requires the exact configured token", () => {
  assert.equal(validMetricsAuthorization("Bearer metrics-secret", "metrics-secret"), true);
  assert.equal(validMetricsAuthorization("Bearer metrics-secret-extra", "metrics-secret"), false);
  assert.equal(validMetricsAuthorization("Basic metrics-secret", "metrics-secret"), false);
  assert.equal(validMetricsAuthorization(undefined, "metrics-secret"), false);
});
