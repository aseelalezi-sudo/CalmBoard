import { IoAdapter } from "@nestjs/platform-socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import Redis from "ioredis";
import type { INestApplicationContext } from "@nestjs/common";
import type { ServerOptions } from "socket.io";

export class RedisIoAdapter extends IoAdapter {
  private publisher?: Redis;
  private subscriber?: Redis;

  constructor(app: INestApplicationContext) {
    super(app);
  }

  async connect() {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      if (process.env.NODE_ENV === "production") {
        throw new Error("REDIS_URL is required for distributed realtime delivery");
      }
      return false;
    }

    const publisher = new Redis(redisUrl, { maxRetriesPerRequest: null });
    const subscriber = publisher.duplicate();
    try {
      await Promise.all([publisher.ping(), subscriber.ping()]);
      this.publisher = publisher;
      this.subscriber = subscriber;
      return true;
    } catch (error) {
      publisher.disconnect();
      subscriber.disconnect();
      if (process.env.NODE_ENV === "production") throw error;
      console.warn("Redis is unavailable; realtime delivery is limited to this API process");
      return false;
    }
  }

  override createIOServer(port: number, options?: ServerOptions) {
    const server = super.createIOServer(port, {
      ...options,
      cors: {
        origin: process.env.APP_URL ?? "http://localhost:3000",
        credentials: true,
        methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
      },
    });
    if (this.publisher && this.subscriber) {
      server.adapter(createAdapter(this.publisher, this.subscriber));
    }
    return server;
  }

  async close() {
    await Promise.all([this.publisher?.quit(), this.subscriber?.quit()]);
  }
}
