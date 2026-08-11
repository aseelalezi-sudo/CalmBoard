import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  cancelAccountDeletion,
  cancelOrganizationDeletion,
  scheduleAccountDeletion,
  scheduleOrganizationDeletion,
} from "./api";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("data lifecycle requests use authenticated self/tenant routes without a target user id", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    if (String(url).endsWith("/auth/csrf")) return Response.json({ token: "csrf-lifecycle-test" });
    return Response.json({ id: "request-1", status: "scheduled" });
  };

  await scheduleAccountDeletion({ password: "current-password" });
  await scheduleOrganizationDeletion("organization/a", { confirmedName: "Acme", code: "123456" });
  await cancelAccountDeletion();
  await cancelOrganizationDeletion("organization/a");

  const mutations = requests.filter((entry) => !entry.url.endsWith("/auth/csrf"));
  assert.equal(new URL(mutations[0]!.url).pathname, "/profile/deletion");
  assert.deepEqual(JSON.parse(String(mutations[0]!.init?.body)), { password: "current-password" });
  assert.equal(new URL(mutations[1]!.url).pathname, "/organizations/organization%2Fa/deletion");
  assert.deepEqual(JSON.parse(String(mutations[1]!.init?.body)), { confirmedName: "Acme", code: "123456" });
  assert.equal(mutations[2]!.init?.method, "DELETE");
  assert.equal(mutations[3]!.init?.method, "DELETE");
  assert.equal(
    mutations.some((entry) => String(entry.init?.body).includes("userId")),
    false,
  );
});
