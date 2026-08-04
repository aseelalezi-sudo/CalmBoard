import { Module } from "@nestjs/common";
import { LicensingController } from "./licensing.controller.js";
import { LicensingGuard } from "./licensing.guard.js";
import { LicensingService } from "./licensing.service.js";

@Module({
  controllers: [LicensingController],
  providers: [LicensingService, LicensingGuard],
  exports: [LicensingService, LicensingGuard],
})
export class LicensingModule {}
