import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  RawBodyRequest,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import {
  createActivitiesRepository,
  createIntegrationWebhookEndpointsRepository,
  createIntegrationWebhookReceiptsRepository,
  isIntegrationWebhookProvider,
  resolveIntegrationWebhookEndpoint,
  withTenantTransaction,
  type IntegrationWebhookProvider,
} from "@calmboard/database";
import type { FastifyRequest } from "fastify";
import { SkipCsrf } from "./csrf.guard.js";
import { RequirePermission } from "./permission.guard.js";
import { PublicRoute } from "./public-route.decorator.js";
import {
  isJsonObject,
  requiredString,
  tenantContext,
  tenantContextFromBody,
  type JsonObject,
} from "./request-validation.js";
import {
  sha256Payload,
  verifyCalmBoardWebhookSignature,
  verifyGitHubWebhookSignature,
  verifySlackWebhookSignature,
} from "./webhook-verification.js";

function parseProvider(value: string) {
  const provider = value.trim().toLowerCase();
  if (!isIntegrationWebhookProvider(provider)) throw new BadRequestException("Webhook provider is not supported");
  return provider;
}

function header(request: FastifyRequest, name: string) {
  const value = request.headers[name];
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

function boundedHeader(value: string, field: string, minimum: number, maximum: number) {
  const normalized = value.trim();
  if (normalized.length < minimum || normalized.length > maximum || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new BadRequestException(`${field} is invalid`);
  }
  return normalized;
}

function providerSecret(provider: IntegrationWebhookProvider) {
  const secret =
    provider === "github"
      ? process.env.INTEGRATION_GITHUB_WEBHOOK_SECRET
      : provider === "slack"
        ? process.env.INTEGRATION_SLACK_SIGNING_SECRET
        : process.env.WEBHOOK_SIGNING_SECRET;
  if (!secret) throw new ServiceUnavailableException(`Webhook signing secret for ${provider} is not configured`);
  return secret;
}

function parsePayload(rawBody: string) {
  try {
    const payload: unknown = JSON.parse(rawBody);
    if (!isJsonObject(payload)) throw new Error("payload must be an object");
    return payload;
  } catch {
    throw new BadRequestException("Invalid JSON webhook payload");
  }
}

function verifyAndDescribeWebhook(provider: IntegrationWebhookProvider, request: FastifyRequest, rawBody: string) {
  const secret = providerSecret(provider);
  if (provider === "github") {
    if (!verifyGitHubWebhookSignature(rawBody, header(request, "x-hub-signature-256"), secret)) {
      throw new UnauthorizedException("Invalid GitHub webhook signature");
    }
    return {
      deliveryId: boundedHeader(header(request, "x-github-delivery"), "x-github-delivery", 8, 255),
      eventType: boundedHeader(header(request, "x-github-event"), "x-github-event", 1, 100),
      providerTimestamp: null,
      payload: parsePayload(rawBody),
    };
  }

  if (provider === "slack") {
    const timestamp = header(request, "x-slack-request-timestamp");
    if (!verifySlackWebhookSignature(rawBody, header(request, "x-slack-signature"), timestamp, secret)) {
      throw new UnauthorizedException("Invalid or stale Slack webhook signature");
    }
    const payload = parsePayload(rawBody);
    const innerEvent = isJsonObject(payload.event) ? payload.event : {};
    const eventType =
      typeof innerEvent.type === "string" ? innerEvent.type : typeof payload.type === "string" ? payload.type : "event";
    return {
      deliveryId:
        typeof payload.event_id === "string"
          ? boundedHeader(payload.event_id, "event_id", 8, 255)
          : sha256Payload(rawBody),
      eventType: boundedHeader(eventType, "event type", 1, 100),
      providerTimestamp: new Date(Number(timestamp) * 1_000),
      payload,
    };
  }

  const timestamp = header(request, "x-calmboard-timestamp");
  if (!verifyCalmBoardWebhookSignature(rawBody, header(request, "x-calmboard-signature"), timestamp, secret)) {
    throw new UnauthorizedException("Invalid or stale CalmBoard webhook signature");
  }
  return {
    deliveryId: boundedHeader(header(request, "x-calmboard-delivery"), "x-calmboard-delivery", 8, 255),
    eventType: boundedHeader(header(request, "x-calmboard-event") || "event", "x-calmboard-event", 1, 100),
    providerTimestamp: new Date(Number(timestamp) * 1_000),
    payload: parsePayload(rawBody),
  };
}

@Controller("integrations/webhooks")
export class IntegrationWebhookEndpointsController {
  @Get()
  @RequirePermission("integrations.manage")
  list(
    @Query("organizationId") organizationId: string,
    @Query("workspaceId") workspaceId: string,
    @Query("actorId") actorId: string,
  ) {
    return createIntegrationWebhookEndpointsRepository(tenantContext(organizationId, workspaceId, actorId)).list();
  }

  @Post()
  @RequirePermission("integrations.manage")
  async create(@Body() body: JsonObject) {
    const context = tenantContextFromBody(body);
    const provider = parseProvider(requiredString(body.provider, "provider"));
    const created = await createIntegrationWebhookEndpointsRepository(context).create(
      provider,
      requiredString(body.displayName, "displayName"),
    );
    await createActivitiesRepository(context).create({
      actorId: context.actorId!,
      action: "integration.webhook.created",
      entityType: "integration_webhook",
      entityId: created.endpoint.id,
      newValues: { provider, displayName: created.endpoint.displayName },
    });
    return {
      ...created.endpoint,
      receiverPath: `/integrations/webhooks/receive/${provider}/${created.endpointToken}`,
      endpointToken: created.endpointToken,
    };
  }

  @Delete(":id")
  @RequirePermission("integrations.manage")
  async revoke(
    @Param("id") id: string,
    @Query("organizationId") organizationId: string,
    @Query("workspaceId") workspaceId: string,
    @Query("actorId") actorId: string,
  ) {
    const context = tenantContext(organizationId, workspaceId, actorId);
    const endpoint = await createIntegrationWebhookEndpointsRepository(context).revoke(requiredString(id, "id"));
    await createActivitiesRepository(context).create({
      actorId: context.actorId!,
      action: "integration.webhook.revoked",
      entityType: "integration_webhook",
      entityId: endpoint.id,
      oldValues: { provider: endpoint.provider, displayName: endpoint.displayName },
    });
    return endpoint;
  }
}

@Controller("integrations/webhooks/receive")
export class IntegrationWebhookReceiverController {
  @Post(":provider/:endpointToken")
  @PublicRoute()
  @SkipCsrf()
  async receive(
    @Param("provider") providerValue: string,
    @Param("endpointToken") endpointToken: string,
    @Req() request: RawBodyRequest<FastifyRequest>,
  ) {
    if (!request.rawBody) throw new BadRequestException("Raw webhook payload is required");
    const provider = parseProvider(providerValue);
    const rawBody = request.rawBody.toString("utf8");
    const described = verifyAndDescribeWebhook(provider, request, rawBody);
    const endpoint = await resolveIntegrationWebhookEndpoint(provider, endpointToken);
    if (!endpoint) throw new UnauthorizedException("Unknown or revoked webhook endpoint");

    const result = await withTenantTransaction(
      { organizationId: endpoint.organizationId, workspaceId: endpoint.workspaceId },
      () =>
        createIntegrationWebhookReceiptsRepository({
          organizationId: endpoint.organizationId,
          workspaceId: endpoint.workspaceId,
        }).record({
          endpointId: endpoint.endpointId,
          provider,
          deliveryId: described.deliveryId,
          payloadSha256: sha256Payload(rawBody),
          eventType: described.eventType,
          providerTimestamp: described.providerTimestamp,
        }),
    );

    return {
      ok: true,
      received: true,
      replayed: result.replayed,
      eventType: described.eventType,
      ...(provider === "slack" && described.payload.type === "url_verification"
        ? { challenge: described.payload.challenge }
        : {}),
    };
  }
}
