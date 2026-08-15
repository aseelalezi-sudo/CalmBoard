import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  assignAuthorizationRole,
  getAuthorizationCatalog,
  removeAuthorizationBinding,
  setAuthorizationOverride,
} from "./api";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("permissions API service", () => {
  it("uses authenticated tenant endpoints without accepting an actor identity", async () => {
    const requests: Array<{ url: string; method: string; body?: unknown }> = [];
    globalThis.fetch = async (input, init) => {
      requests.push({
        url: String(input),
        method: init?.method ?? "GET",
        ...(typeof init?.body === "string" ? { body: JSON.parse(init.body) } : {}),
      });
      const payload = String(input).includes("/catalog")
        ? { permissions: [], roles: [], bindings: [], overrides: [] }
        : String(input).includes("/overrides")
          ? { id: "override-1" }
          : { id: "binding-1" };
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    await getAuthorizationCatalog("org/a");
    await assignAuthorizationRole({
      organizationId: "org/a",
      workspaceId: "workspace/a",
      membershipId: "membership/a",
      roleId: "role/a",
      scope: "workspace",
    });
    await setAuthorizationOverride({
      organizationId: "org/a",
      workspaceId: "workspace/a",
      projectId: "project/a",
      membershipId: "membership/a",
      permissionKey: "tasks.update",
      scope: "project",
      effect: "deny",
      reason: "Temporary restriction",
    });
    await removeAuthorizationBinding("binding/a", "org/a");

    assert.equal(new URL(requests[0]!.url).searchParams.get("organizationId"), "org/a");
    assert.deepEqual(
      requests.map((request) => request.method),
      ["GET", "POST", "POST", "DELETE"],
    );
    assert.deepEqual(requests[1]!.body, {
      organizationId: "org/a",
      workspaceId: "workspace/a",
      membershipId: "membership/a",
      roleId: "role/a",
      scope: "workspace",
    });
    assert.equal("userId" in (requests[1]!.body as object), false);
    assert.match(requests[3]!.url, /authorization\/bindings\/binding%2Fa\?organizationId=org%2Fa$/);
  });
});
