import { Injectable } from "@nestjs/common";
import { createPlatformAdministrationRepository } from "@calmboard/database";

@Injectable()
export class PlatformAdministrationService {
  private readonly repository = createPlatformAdministrationRepository();

  isPlatformAdmin(userId: string) {
    return this.repository.isPlatformAdmin(userId);
  }
}
