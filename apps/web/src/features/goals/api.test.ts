import assert from "node:assert/strict";
import test from "node:test";
import { checkInGoalRecord, linkGoalTaskRecord, unlinkGoalTaskRecord } from "./api";

test("OKR API keeps check-ins and task links tenant scoped", async (t) => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), init });
    return new Response(JSON.stringify({ id: "goal-1" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const scope = {
    organizationId: "organization/a",
    workspaceId: "workspace/a",
    actorId: "user/a",
  };
  await checkInGoalRecord("goal/a", { note: "Measured", currentValue: 72 }, scope);
  await linkGoalTaskRecord("goal/a", "task/a", 2.5, scope);
  await unlinkGoalTaskRecord("goal/a", "task/a", scope);

  assert.match(requests[0]?.url ?? "", /goals\/goal%2Fa\/checkins/);
  assert.deepEqual(JSON.parse(String(requests[0]?.init?.body)), {
    note: "Measured",
    currentValue: 72,
    ...scope,
  });
  assert.match(requests[1]?.url ?? "", /goals\/goal%2Fa\/tasks/);
  assert.deepEqual(JSON.parse(String(requests[1]?.init?.body)), {
    taskId: "task/a",
    weight: 2.5,
    ...scope,
  });
  assert.equal(requests[2]?.init?.method, "DELETE");
  assert.match(requests[2]?.url ?? "", /taskId=task%2Fa/);
  assert.match(requests[2]?.url ?? "", /organizationId=organization%2Fa/);
  assert.match(requests[2]?.url ?? "", /workspaceId=workspace%2Fa/);
});
