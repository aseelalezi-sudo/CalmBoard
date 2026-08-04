import { Controller, ForbiddenException, Post } from "@nestjs/common";
import { runDevelopmentSeed } from "@calmboard/database";
import { PlatformAdmin } from "./platform-admin.guard.js";

@Controller("seed")
@PlatformAdmin()
export class SeedController {
  @Post()
  async run() {
    if (process.env.NODE_ENV === "production" || process.env.ALLOW_DEV_SEED !== "true") {
      throw new ForbiddenException("Seed is disabled. Set ALLOW_DEV_SEED=true outside production to run it.");
    }

    return runDevelopmentSeed();
  }
}
