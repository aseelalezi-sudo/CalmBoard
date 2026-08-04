import {
  applyDecorators,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { AuthenticatedRequest } from "./auth.guard.js";
import { AUTHORIZATION_POLICY } from "./permission.guard.js";
import { PlatformAdministrationService } from "./platform-administration.service.js";

export const PLATFORM_ADMIN_REQUIRED = "calmboard:platform-admin-required";

export function PlatformAdmin() {
  return applyDecorators(SetMetadata(PLATFORM_ADMIN_REQUIRED, true), SetMetadata(AUTHORIZATION_POLICY, true));
}

@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(PlatformAdministrationService) private readonly platformAdministration: PlatformAdministrationService,
  ) {}

  async canActivate(context: ExecutionContext) {
    if (typeof context.getType === "function" && context.getType() !== "http") return true;
    const required = this.reflector.getAllAndOverride<boolean>(PLATFORM_ADMIN_REQUIRED, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.auth || !(await this.platformAdministration.isPlatformAdmin(request.auth.userId))) {
      throw new ForbiddenException("Platform administrator access is required");
    }
    return true;
  }
}
