import assert from "node:assert/strict";
import test from "node:test";
import { getQueueSnapshot } from "./api";

test("admin queue monitoring reads the protected Nest API instead of a local simulation", async (t) => {
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = async (input) => {
    requests.push(String(input));
    return new Response(
      JSON.stringify({
        jobs: [],
        counts: { active: 0, completed: 0, failed: 0, delayed: 0, total: 0 },
        redis: { available: true },
        durableDeadLetters: 0,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const snapshot = await getQueueSnapshot();
  assert.equal(requests[0], "http://localhost:5500/admin/queues");
  assert.equal(snapshot.redis.available, true);
  assert.equal(snapshot.jobs.length, 0);
});
