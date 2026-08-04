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
import { PUBLIC_ROUTE } from "./public-route.decorator.js";

export const REQUIRED_PERMISSION = "calmboard:required-permission";
export const AUTHORIZATION_POLICY = "calmboard:authorization-policy";
export const TENANT_MEMBER_REQUIRED = "calmboard:tenant-member-required";

export function RequirePermission(permission: string) {
  return applyDecorators(SetMetadata(REQUIRED_PERMISSION, permission), SetMetadata(AUTHORIZATION_POLICY, true));
}

export function SelfService() {
  return SetMetadata(AUTHORIZATION_POLICY, true);
}

export function TenantMember() {
  return applyDecorators(SetMetadata(TENANT_MEMBER_REQUIRED, true), SetMetadata(AUTHORIZATION_POLICY, true));
}

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext) {
    if (typeof context.getType === "function" && context.getType() !== "http") return true;
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [context.getHandler(), context.getClass()])) {
      return true;
    }
    const permission = this.reflector.getAllAndOverride<string>(REQUIRED_PERMISSION, [
      context.getHandler(),
      context.getClass(),
    ]);
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const policyConfigured = this.reflector.getAllAndOverride<boolean>(AUTHORIZATION_POLICY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const tenantMemberRequired = this.reflector.getAllAndOverride<boolean>(TENANT_MEMBER_REQUIRED, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!permission) {
      if (!policyConfigured) throw new ForbiddenException("Authorization policy is not configured");
      if (tenantMemberRequired && !request.authorization?.member) {
        throw new ForbiddenException("Active tenant membership is required");
      }
      return true;
    }
    if (!request.authorization?.permissions.includes(permission)) {
      throw new ForbiddenException(`Permission '${permission}' is required`);
    }
    return true;
  }
}
