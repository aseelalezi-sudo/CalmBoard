import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import {
  createActivitiesRepository,
  createIdempotencyRepository,
  createIntegrationCredentialsRepository,
  type IntegrationAuthType,
  type IntegrationSecretPayload,
} from "@calmboard/database";
import {
  isJsonObject,
  optionalString,
  requiredIdempotencyKey,
  requiredString,
  tenantContext,
  tenantContextFromBody,
  type JsonObject,
} from "./request-validation.js";
import { RequirePermission, SelfService } from "./permission.guard.js";
import { PublicRoute } from "./public-route.decorator.js";
import {
  IntegrationOAuthService,
  integrationOAuthAppUrl,
  integrationOAuthProviderAvailability,
  parseIntegrationOAuthProvider,
} from "./integration-oauth.service.js";

const supportedProviders = new Set([
  "gcal",
  "outlook",
  "microsoft",
  "gdrive",
  "onedrive",
  "dropbox",
  "slack",
  "teams",
  "github",
  "gitlab",
  "zoom",
  "webhook",
  "zapier",
  "email",
]);
const supportedAuthTypes = new Set<IntegrationAuthType>(["oauth2", "api_key", "bearer", "basic", "webhook_secret"]);
const secretKeysByAuthType: Record<IntegrationAuthType, ReadonlySet<string>> = {
  oauth2: new Set(["accessToken", "refreshToken", "clientSecret"]),
  api_key: new Set(["apiKey"]),
  bearer: new Set(["token"]),
  basic: new Set(["username", "password"]),
  webhook_secret: new Set(["webhookSecret"]),
};
const requiredSecretKeyByAuthType: Record<IntegrationAuthType, string> = {
  oauth2: "accessToken",
  api_key: "apiKey",
  bearer: "token",
  basic: "password",
  webhook_secret: "webhookSecret",
};

export function parseIntegrationProvider(value: unknown) {
  const provider = requiredString(value, "provider").toLowerCase();
  if (!supportedProviders.has(provider)) throw new BadRequestException("provider is not supported");
  return provider;
}

function parseAuthType(value: unknown): IntegrationAuthType {
  const authType = requiredString(value, "authType") as IntegrationAuthType;
  if (!supportedAuthTypes.has(authType)) throw new BadRequestException("authType is invalid");
  return authType;
}

function parseSecrets(value: unknown, authType: IntegrationAuthType) {
  if (!isJsonObject(value)) throw new BadRequestException("secrets must be an object");
  const allowedKeys = secretKeysByAuthType[authType];
  const secrets: IntegrationSecretPayload = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!allowedKeys.has(key)) throw new BadRequestException(`secrets.${key} is not supported for ${authType}`);
    secrets[key] = requiredString(entry, `secrets.${key}`);
  }
  const requiredKey = requiredSecretKeyByAuthType[authType];
  if (!secrets[requiredKey]) throw new BadRequestException(`secrets.${requiredKey} is required for ${authType}`);
  if (authType === "basic" && !secrets.username) {
    throw new BadRequestException("secrets.username is required for basic authentication");
  }
  return secrets;
}

function parseStringArray(value: unknown, field: string) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 100) throw new BadRequestException(`${field} must be an array`);
  return value.map((entry, index) => requiredString(entry, `${field}.${index}`));
}

function parseStringMetadata(value: unknown) {
  if (value === undefined) return undefined;
  if (!isJsonObject(value) || Object.keys(value).length > 20) {
    throw new BadRequestException("metadata must be an object");
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, requiredString(entry, `metadata.${key}`)]),
  );
}

export function parseIntegrationCredentialInput(body: JsonObject) {
  const authType = parseAuthType(body.authType);
  const provider = parseIntegrationProvider(body.provider);
  if (authType === "oauth2" && ["github", "slack", "gcal", "microsoft"].includes(provider)) {
    throw new BadRequestException(`Use the server OAuth flow to connect ${provider}`);
  }
  const expiresAtText = optionalString(body.expiresAt, "expiresAt");
  const expiresAt = expiresAtText ? new Date(expiresAtText) : undefined;
  if (expiresAt && Number.isNaN(expiresAt.getTime())) throw new BadRequestException("expiresAt is invalid");
  return {
    provider,
    credentialKey: optionalString(body.credentialKey, "credentialKey"),
    displayName: requiredString(body.displayName, "displayName"),
    authType,
    secrets: parseSecrets(body.secrets, authType),
    externalAccountId: optionalString(body.externalAccountId, "externalAccountId"),
    scopes: parseStringArray(body.scopes, "scopes"),
    metadata: parseStringMetadata(body.metadata),
    expiresAt,
  };
}

@Controller("integrations/credentials")
@RequirePermission("integrations.manage")
export class IntegrationCredentialsController {
  @Get()
  list(
    @Query("organizationId") organizationId: string,
    @Query("workspaceId") workspaceId: string,
    @Query("actorId") actorId: string,
  ) {
    return createIntegrationCredentialsRepository(tenantContext(organizationId, workspaceId, actorId)).list();
  }

  @Post()
  async save(@Body() body: JsonObject, @Headers("idempotency-key") idempotencyKeyHeader = "") {
    const context = tenantContextFromBody(body);
    const input = parseIntegrationCredentialInput(body);
    const result = await createIdempotencyRepository(context).execute({
      key: requiredIdempotencyKey(idempotencyKeyHeader),
      scope: "integrations.credentials.save",
      request: body,
      operation: async () => {
        const credential = await createIntegrationCredentialsRepository(context).save(input);
        await createActivitiesRepository(context).create({
          actorId: context.actorId!,
          action: "integration.credential.saved",
          entityType: "integration_credential",
          entityId: credential.id,
          newValues: {
            provider: input.provider,
            credentialKey: credential.credentialKey,
            authType: input.authType,
            hasSecret: true,
          },
        });
        return { body: credential };
      },
    });
    return result.body;
  }

  @Delete(":id")
  async revoke(
    @Param("id") id: string,
    @Query("organizationId") organizationId: string,
    @Query("workspaceId") workspaceId: string,
    @Query("actorId") actorId: string,
  ) {
    const context = tenantContext(organizationId, workspaceId, actorId);
    const credential = await createIntegrationCredentialsRepository(context).revoke(requiredString(id, "id"));
    await createActivitiesRepository(context).create({
      actorId: context.actorId!,
      action: "integration.credential.revoked",
      entityType: "integration_credential",
      entityId: credential.id,
      oldValues: { provider: credential.provider, credentialKey: credential.credentialKey, hasSecret: true },
    });
    return credential;
  }
}

@Controller("integrations/oauth")
export class IntegrationOAuthController {
  constructor(@Inject(IntegrationOAuthService) private readonly oauth: IntegrationOAuthService) {}

  @Get("providers")
  @SelfService()
  providers() {
    return integrationOAuthProviderAvailability();
  }

  @Get(":provider/start")
  @RequirePermission("integrations.manage")
  async begin(
    @Param("provider") providerValue: string,
    @Query("organizationId") organizationId: string,
    @Query("workspaceId") workspaceId: string,
    @Query("actorId") actorId: string,
    @Req() request: FastifyRequest,
    @Res() response: FastifyReply,
  ) {
    const provider = parseIntegrationOAuthProvider(providerValue);
    const destination = await this.oauth.begin(
      provider,
      tenantContext(organizationId, workspaceId, actorId),
      request.ip,
    );
    return response.redirect(destination);
  }

  @Get(":provider/callback")
  @PublicRoute()
  async complete(
    @Param("provider") providerValue: string,
    @Query("state") stateValue: string | undefined,
    @Query("code") codeValue: string | undefined,
    @Query("error") providerError: string | undefined,
    @Res() response: FastifyReply,
  ) {
    const provider = parseIntegrationOAuthProvider(providerValue);
    if (providerError) return response.redirect(integrationOAuthAppUrl(provider, "error", "authorization_denied"));
    try {
      const state = requiredString(stateValue, "state");
      const code = requiredString(codeValue, "code");
      if (state.length > 4_096 || code.length > 2_048) throw new BadRequestException("OAuth callback is invalid");
      await this.oauth.complete(provider, state, code);
      return response.redirect(integrationOAuthAppUrl(provider, "success"));
    } catch {
      return response.redirect(integrationOAuthAppUrl(provider, "error", "connection_failed"));
    }
  }

  @Delete(":provider")
  @RequirePermission("integrations.manage")
  disconnect(
    @Param("provider") providerValue: string,
    @Query("organizationId") organizationId: string,
    @Query("workspaceId") workspaceId: string,
    @Query("actorId") actorId: string,
  ) {
    return this.oauth.disconnect(
      parseIntegrationOAuthProvider(providerValue),
      tenantContext(organizationId, workspaceId, actorId),
    );
  }
}
