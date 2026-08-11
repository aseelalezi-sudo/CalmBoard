import { Injectable, OnModuleDestroy } from "@nestjs/common";
import Redis from "ioredis";

export type RateLimitHit = { count: number; ttlMs: number };

export interface RateLimitStore {
  hit(key: string, windowMs: number): Promise<RateLimitHit>;
}

const HIT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('PTTL', KEYS[1])
return {count, ttl}
`;

@Injectable()
export class RedisRateLimitStore implements RateLimitStore, OnModuleDestroy {
  private client?: Redis;

  private redis() {
    if (!this.client) {
      const url = process.env.REDIS_URL;
      if (!url) throw new Error("REDIS_URL is required for distributed rate limiting");
      this.client = new Redis(url, {
        lazyConnect: true,
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1,
        connectTimeout: 2_000,
      });
      this.client.on("error", () => undefined);
    }
    return this.client;
  }

  async hit(key: string, windowMs: number) {
    const redis = this.redis();
    if (redis.status === "wait") await redis.connect();
    const result = (await redis.eval(HIT_SCRIPT, 1, key, windowMs)) as [number, number];
    return { count: Number(result[0]), ttlMs: Math.max(1, Number(result[1])) };
  }

  async ping() {
    const redis = this.redis();
    if (redis.status === "wait") await redis.connect();
    return redis.ping();
  }

  async onModuleDestroy() {
    if (this.client && this.client.status !== "end") this.client.disconnect();
  }
}
