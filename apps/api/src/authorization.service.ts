import { Injectable } from "@nestjs/common";
import { createAuthorizationRepository, type AuthorizationScope } from "@calmboard/database";

@Injectable()
export class AuthorizationService {
  private readonly repository = createAuthorizationRepository();

  resolve(userId: string, scope: AuthorizationScope, permission?: string) {
    return this.repository.resolve(userId, scope, permission);
  }
}
