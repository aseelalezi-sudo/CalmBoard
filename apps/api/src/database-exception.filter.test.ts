import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException } from "@nestjs/common";
import {
  TenantConflictError,
  TenantPermissionDeniedError,
  TenantResourceNotFoundError,
  TenantUsageLimitExceededError,
} from "@calmboard/database";
import { DatabaseExceptionFilter } from "./database-exception.filter.js";

describe("unified API errors", () => {
  const filter = new DatabaseExceptionFilter();

  it("maps domain errors to stable codes and statuses", () => {
    assert.deepEqual(filter.toPayload(new TenantResourceNotFoundError("task")), {
      statusCode: 404,
      code: "resource_not_found",
      error: "task was not found in the current tenant",
    });
    assert.equal(filter.toPayload(new TenantPermissionDeniedError()).code, "permission_denied");
    assert.equal(filter.toPayload(new TenantConflictError("stale task")).code, "conflict");
  });

  it("normalizes framework validation and hides unexpected exceptions", () => {
    assert.deepEqual(filter.toPayload(new BadRequestException("title is required")), {
      statusCode: 400,
      code: "bad_request",
      error: "title is required",
    });
    assert.deepEqual(filter.toPayload(new Error("database password leaked")), {
      statusCode: 500,
      code: "internal_error",
      error: "Internal server error",
    });
  });

  it("returns a stable bounded payload for database usage-limit failures", () => {
    assert.deepEqual(filter.toPayload(new TenantUsageLimitExceededError("tasks", 101, 100)), {
      statusCode: 409,
      code: "usage_limit_exceeded",
      error: "The tasks usage limit has been reached",
      details: { resource: "tasks", current: 101, limit: 100 },
    });
    assert.equal(
      filter.toPayload({
        cause: {
          code: "P0001",
          constraint: "usage_limits_storage",
          detail: "resource=storage,current=1048577,limit=1048576",
        },
      }).code,
      "usage_limit_exceeded",
    );
  });
});
