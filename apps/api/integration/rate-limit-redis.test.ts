import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import { RedisRateLimitStore } from "../src/rate-limit.service";

const store = new RedisRateLimitStore();

after(async () => {
  await store.onModuleDestroy();
});

describe("Redis rate limit store", () => {
  it("increments and expires a distributed counter atomically", { skip: !process.env.REDIS_URL }, async () => {
    const key = `calmboard:rate:integration:${randomUUID()}`;
    const first = await store.hit(key, 2_000);
    const second = await store.hit(key, 2_000);
    assert.equal(first.count, 1);
    assert.equal(second.count, 2);
    assert.ok(first.ttlMs > 0 && first.ttlMs <= 2_000);
    assert.ok(second.ttlMs > 0 && second.ttlMs <= first.ttlMs);
  });
});
