import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Post,
  RawBodyRequest,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { ServiceUnavailableException } from "@nestjs/common";
import { createIdempotencyRepository, withTenantTransaction } from "@calmboard/database";
import {
  applyStripeEvent,
  createCheckoutSession,
  createCustomerPortalSession,
  parseBillingInterval,
  parseBillingPlan,
  parsePromotionCode,
  stripeEventOrganizationId,
  verifyStripeWebhookSignature,
} from "./billing.service.js";
import { requiredIdempotencyKey, requiredString, type JsonObject } from "./request-validation.js";
import { PublicRoute } from "./public-route.decorator.js";
import { SkipCsrf } from "./csrf.guard.js";
import { RequirePermission } from "./permission.guard.js";

const STRIPE_WEBHOOK_REPLAY_TTL_MS = 30 * 24 * 60 * 60 * 1_000;

@Controller("billing/checkout")
export class BillingCheckoutController {
  @RequirePermission("billing.manage")
  @Post()
  async create(@Body() body: JsonObject, @Headers("idempotency-key") idempotencyKeyHeader = "") {
    const idempotencyKey = requiredIdempotencyKey(idempotencyKeyHeader);
    const organizationId = requiredString(body.organizationId, "organizationId");
    const seats = Math.max(1, Math.round(Number(body.seats ?? 10)) || 10);
    const result = await createIdempotencyRepository({ organizationId }).execute({
      key: idempotencyKey,
      scope: "billing.checkout.create",
      request: body,
      operation: async () => ({
        body: await createCheckoutSession({
          organizationId,
          plan: parseBillingPlan(body.planId),
          billingInterval: parseBillingInterval(body.billingInterval),
          seats,
          returnUrl: typeof body.returnUrl === "string" && body.returnUrl ? body.returnUrl : "/",
          idempotencyKey,
          promotionCode: parsePromotionCode(body.promotionCode),
        }),
      }),
    });
    return result.body;
  }
}

@Controller("billing/portal")
export class BillingPortalController {
  @RequirePermission("billing.manage")
  @Post()
  async create(@Body() body: JsonObject, @Headers("idempotency-key") idempotencyKeyHeader = "") {
    const idempotencyKey = requiredIdempotencyKey(idempotencyKeyHeader);
    const organizationId = requiredString(body.organizationId, "organizationId");
    const result = await createIdempotencyRepository({ organizationId }).execute({
      key: idempotencyKey,
      scope: "billing.portal.create",
      request: body,
      operation: async () => ({
        body: await createCustomerPortalSession({
          organizationId,
          returnUrl: typeof body.returnUrl === "string" && body.returnUrl ? body.returnUrl : "/",
          idempotencyKey,
        }),
      }),
    });
    return result.body;
  }
}

@Controller("billing/webhook")
export class BillingWebhookController {
  @PublicRoute()
  @SkipCsrf()
  @Post()
  async receive(@Req() request: RawBodyRequest<FastifyRequest>, @Headers("stripe-signature") signature = "") {
    const rawBody = request.rawBody?.toString("utf8") ?? JSON.stringify(request.body ?? {});
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    const simulation =
      process.env.NODE_ENV !== "production" &&
      process.env.ALLOW_SIMULATED_STRIPE_WEBHOOKS === "true" &&
      rawBody.includes("simulated_test");
    if (!secret && !simulation) throw new ServiceUnavailableException("STRIPE_WEBHOOK_SECRET is required");
    if (secret && !verifyStripeWebhookSignature(rawBody, signature, secret) && !simulation) {
      throw new UnauthorizedException("Invalid webhook signature");
    }
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      throw new BadRequestException("Invalid JSON payload");
    }
    const organizationId = stripeEventOrganizationId(event);
    if (!organizationId) {
      const eventType = await applyStripeEvent(event);
      return { ok: true, received: true, eventType, verified: Boolean(secret) };
    }
    const eventId = requiredIdempotencyKey(event.id);
    return withTenantTransaction({ organizationId }, async () => {
      const result = await createIdempotencyRepository({ organizationId }).execute({
        key: eventId,
        scope: "billing.stripe.webhook",
        request: event,
        ttlMs: STRIPE_WEBHOOK_REPLAY_TTL_MS,
        operation: async () => ({
          body: {
            ok: true,
            received: true,
            eventType: await applyStripeEvent(event),
            verified: Boolean(secret),
          },
        }),
      });
      return result.body;
    });
  }
}
