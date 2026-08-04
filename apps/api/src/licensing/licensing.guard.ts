import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PUBLIC_ROUTE } from "../public-route.decorator.js";
import { LicensingService } from "./licensing.service.js";

/**
 * Global license gate.
 *
 * Passes when:
 *  - licensing is not enforced for this instance, or
 *  - the request is a non-HTTP transport (WebSocket, etc.), or
 *  - the route is marked `@PublicRoute()`, or
 *  - the current license is `valid` or inside its offline `grace_period`.
 *
 * Otherwise it fails fast: 402 (no/past license), 403 (revoked) or
 * 503 (offline with no usable cached license).
 */
@Injectable()
export class LicensingGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly licensing: LicensingService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.licensing.enabledLicensing) return true;
    if (typeof context.getType === "function" && context.getType() !== "http") return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const check = await this.licensing.status();

    if (check.valid && (check.status === "valid" || check.status === "grace_period")) return true;

    switch (check.status) {
      case "revoked":
        throw new ForbiddenException("The license has been revoked or suspended.");
      case "grace_expired":
        throw new ServiceUnavailableException("The license expired and its offline grace period has elapsed.");
      case "offline":
        throw new ServiceUnavailableException("The license server is unreachable and no cached license is available.");
      default:
        throw new HttpException("A valid license key is required to use CalmBoard.", HttpStatus.PAYMENT_REQUIRED);
    }
  }
}
