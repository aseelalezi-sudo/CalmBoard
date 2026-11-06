import assert from "node:assert/strict";
import test from "node:test";
import { getQueueSnapshot } from "./api";

test("admin queue monitoring reads the protected Nest API instead of a local simulation", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalApiUrl = process.env.NEXT_PUBLIC_API_URL;
  process.env.NEXT_PUBLIC_API_URL = "https://api.example.test";
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
    if (originalApiUrl === undefined) delete process.env.NEXT_PUBLIC_API_URL;
    else process.env.NEXT_PUBLIC_API_URL = originalApiUrl;
  });

  const snapshot = await getQueueSnapshot();
  assert.equal(requests[0], "https://api.example.test/admin/queues");
  assert.equal(snapshot.redis.available, true);
  assert.equal(snapshot.jobs.length, 0);
});
