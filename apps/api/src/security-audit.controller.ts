import { Controller, Get, Query, Req } from "@nestjs/common";
import { createSecurityEventsRepository } from "@calmboard/database";
import type { AuthenticatedRequest } from "./auth.guard.js";
import { RequirePermission } from "./permission.guard.js";
import { requiredString } from "./request-validation.js";

@Controller("audit/security")
export class SecurityAuditController {
  private readonly events = createSecurityEventsRepository();

  @Get()
  @RequirePermission("audit.view")
  list(
    @Query("organizationId") organizationId: string,
    @Query("limit") requestedLimit: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const limit = Number(requestedLimit ?? 100);
    return this.events.listForOrganization(
      request.auth!.userId,
      requiredString(organizationId, "organizationId"),
      Number.isFinite(limit) ? limit : 100,
    );
  }
}
