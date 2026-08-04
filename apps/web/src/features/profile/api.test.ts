import assert from "node:assert/strict";
import test from "node:test";
import { deleteProfileSessions, getProfileSecurityData, updateProfilePreferences } from "./api";

test("profile account API derives ownership from the authenticated cookie", async (t) => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    requests.push({ url, init });
    const pathname = new URL(url).pathname;
    const payload = pathname === "/profile/sessions" ? [] : pathname === "/branches" ? [] : { emailEnabled: true };
    return new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  await getProfileSecurityData("organization/a");
  await deleteProfileSessions({ id: "session/a" });
  await deleteProfileSessions({ allExceptCurrent: true });
  await deleteProfileSessions({ all: true });
  await updateProfilePreferences({ dndEnabled: true });

  const sessionList = requests.find(
    (request) => request.init?.method === undefined && new URL(request.url).pathname === "/profile/sessions",
  );
  assert.equal(new URL(sessionList?.url ?? "http://invalid").search, "");
  const preferences = requests.find(
    (request) => request.init?.method === undefined && new URL(request.url).pathname === "/profile/preferences",
  );
  assert.equal(new URL(preferences?.url ?? "http://invalid").search, "");
  const mutations = requests.filter((request) => request.init?.method === "DELETE");
  assert.equal(mutations.length, 3);
  assert.deepEqual(JSON.parse(String(mutations[0]?.init?.body)), { id: "session/a" });
  assert.deepEqual(JSON.parse(String(mutations[1]?.init?.body)), { allExceptCurrent: true });
  assert.deepEqual(JSON.parse(String(mutations[2]?.init?.body)), { all: true });
  assert.ok(mutations.every((request) => !String(request.init?.body).includes("user/a")));
  const preferenceMutation = requests.find((request) => request.init?.method === "PATCH");
  assert.deepEqual(JSON.parse(String(preferenceMutation?.init?.body)), { dndEnabled: true });
});
