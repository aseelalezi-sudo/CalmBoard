import assert from "node:assert/strict";
import test from "node:test";
import { ForbiddenException } from "@nestjs/common";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@127.0.0.1:5432/calmboard_test";
const { SeedController } = await import("./seed.controller.js");

test("development seed stays disabled unless explicitly enabled", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousAllowDevSeed = process.env.ALLOW_DEV_SEED;
  process.env.NODE_ENV = "development";
  delete process.env.ALLOW_DEV_SEED;

  try {
    await assert.rejects(() => new SeedController().run(), ForbiddenException);
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousAllowDevSeed === undefined) delete process.env.ALLOW_DEV_SEED;
    else process.env.ALLOW_DEV_SEED = previousAllowDevSeed;
  }
});

test("development seed cannot run in production even when its flag is enabled", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousAllowDevSeed = process.env.ALLOW_DEV_SEED;
  process.env.NODE_ENV = "production";
  process.env.ALLOW_DEV_SEED = "true";

  try {
    await assert.rejects(() => new SeedController().run(), ForbiddenException);
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousAllowDevSeed === undefined) delete process.env.ALLOW_DEV_SEED;
    else process.env.ALLOW_DEV_SEED = previousAllowDevSeed;
  }
});
