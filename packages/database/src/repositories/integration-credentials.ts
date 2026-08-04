import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "../client.js";
import { TenantConflictError, TenantPermissionDeniedError, TenantResourceNotFoundError } from "../errors.js";
import { integrationCredentials, memberships, workspaces } from "../schema.js";
import { assertWorkspaceTenantContext, type DatabaseTenantContext } from "../tenant-context.js";

export type IntegrationAuthType = "oauth2" | "api_key" | "bearer" | "basic" | "webhook_secret";
export type IntegrationSecretPayload = Record<string, string>;

export type SaveIntegrationCredentialInput = {
  provider: string;
  credentialKey?: string;
  displayName: string;
  authType: IntegrationAuthType;
  secrets: IntegrationSecretPayload;
  externalAccountId?: string | null;
  scopes?: string[];
  metadata?: Record<string, string>;
  expiresAt?: Date | null;
};

type CredentialIdentity = {
  id: string;
  organizationId: string;
  workspaceId: string;
  provider: string;
  credentialKey: string;
  authType: IntegrationAuthType;
};

type EncryptionEnvelope = {
  encryptedPayload: string;
  initializationVector: string;
  authenticationTag: string;
  encryptionAlgorithm: "aes-256-gcm";
  encryptionKeyVersion: number;
  secretFingerprint: string;
};

export class IntegrationCredentialEncryptionError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "IntegrationCredentialEncryptionError";
  }
}

function decodeEncryptionKey(value: string) {
  const key = /^[a-f0-9]{64}$/i.test(value) ? Buffer.from(value, "hex") : Buffer.from(value, "base64");
  if (key.length !== 32) {
    throw new IntegrationCredentialEncryptionError("Integration credential encryption keys must contain 32 bytes");
  }
  return key;
}

function loadKeyring() {
  const keyring = new Map<number, Buffer>();
  const serializedKeyring = process.env.INTEGRATION_CREDENTIALS_KEYS;
  if (serializedKeyring) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(serializedKeyring);
    } catch (error) {
      throw new IntegrationCredentialEncryptionError("INTEGRATION_CREDENTIALS_KEYS must be valid JSON", {
        cause: error,
      });
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new IntegrationCredentialEncryptionError("INTEGRATION_CREDENTIALS_KEYS must be a version-to-key object");
    }
    for (const [versionText, value] of Object.entries(parsed)) {
      const version = Number(versionText);
      if (!Number.isSafeInteger(version) || version <= 0 || typeof value !== "string") {
        throw new IntegrationCredentialEncryptionError("Integration credential key versions must be positive integers");
      }
      keyring.set(version, decodeEncryptionKey(value));
    }
  } else if (process.env.INTEGRATION_CREDENTIALS_KEY) {
    const version = Number(process.env.INTEGRATION_CREDENTIALS_ACTIVE_KEY_VERSION ?? "1");
    if (!Number.isSafeInteger(version) || version <= 0) {
      throw new IntegrationCredentialEncryptionError(
        "INTEGRATION_CREDENTIALS_ACTIVE_KEY_VERSION must be a positive integer",
      );
    }
    keyring.set(version, decodeEncryptionKey(process.env.INTEGRATION_CREDENTIALS_KEY));
  }
  if (!keyring.size) {
    throw new IntegrationCredentialEncryptionError(
      "INTEGRATION_CREDENTIALS_KEY or INTEGRATION_CREDENTIALS_KEYS is required",
    );
  }
  const requestedVersion = process.env.INTEGRATION_CREDENTIALS_ACTIVE_KEY_VERSION;
  const activeVersion = requestedVersion ? Number(requestedVersion) : Math.max(...keyring.keys());
  if (!Number.isSafeInteger(activeVersion) || !keyring.has(activeVersion)) {
    throw new IntegrationCredentialEncryptionError("The active integration credential key version is unavailable");
  }
  return { keyring, activeVersion };
}

function additionalAuthenticatedData(identity: CredentialIdentity, keyVersion: number) {
  return Buffer.from(
    [
      identity.id,
      identity.organizationId,
      identity.workspaceId,
      identity.provider,
      identity.credentialKey,
      identity.authType,
      keyVersion,
    ].join("\u001f"),
    "utf8",
  );
}

function normalizeSecrets(secrets: IntegrationSecretPayload) {
  const entries = Object.entries(secrets).sort(([left], [right]) => left.localeCompare(right));
  if (!entries.length || entries.length > 20) {
    throw new TenantConflictError("integration credentials require between 1 and 20 secret fields");
  }
  const normalized: IntegrationSecretPayload = {};
  for (const [key, value] of entries) {
    if (!/^[a-z][A-Za-z0-9_]{0,63}$/.test(key) || typeof value !== "string" || !value || value.length > 65_536) {
      throw new TenantConflictError("integration credential secret fields are invalid");
    }
    normalized[key] = value;
  }
  if (Buffer.byteLength(JSON.stringify(normalized), "utf8") > 131_072) {
    throw new TenantConflictError("integration credential payload is too large");
  }
  return normalized;
}

export function encryptIntegrationCredential(
  identity: CredentialIdentity,
  secrets: IntegrationSecretPayload,
): EncryptionEnvelope {
  const normalized = normalizeSecrets(secrets);
  const { keyring, activeVersion } = loadKeyring();
  const key = keyring.get(activeVersion)!;
  const initializationVector = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, initializationVector);
  cipher.setAAD(additionalAuthenticatedData(identity, activeVersion));
  const serialized = JSON.stringify(normalized);
  const encrypted = Buffer.concat([cipher.update(serialized, "utf8"), cipher.final()]);
  return {
    encryptedPayload: encrypted.toString("base64"),
    initializationVector: initializationVector.toString("base64"),
    authenticationTag: cipher.getAuthTag().toString("base64"),
    encryptionAlgorithm: "aes-256-gcm",
    encryptionKeyVersion: activeVersion,
    secretFingerprint: createHmac("sha256", key).update(serialized, "utf8").digest("hex"),
  };
}

export function decryptIntegrationCredential(identity: CredentialIdentity, envelope: EncryptionEnvelope) {
  const { keyring } = loadKeyring();
  const key = keyring.get(envelope.encryptionKeyVersion);
  if (!key) throw new IntegrationCredentialEncryptionError("The credential encryption key version is unavailable");
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.initializationVector, "base64"));
    decipher.setAAD(additionalAuthenticatedData(identity, envelope.encryptionKeyVersion));
    decipher.setAuthTag(Buffer.from(envelope.authenticationTag, "base64"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(envelope.encryptedPayload, "base64")),
      decipher.final(),
    ]).toString("utf8");
    return normalizeSecrets(JSON.parse(decrypted) as IntegrationSecretPayload);
  } catch (error) {
    if (error instanceof TenantConflictError) throw error;
    throw new IntegrationCredentialEncryptionError("Integration credential authentication failed", { cause: error });
  }
}

function normalizeProvider(value: string) {
  const provider = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{1,49}$/.test(provider)) throw new TenantConflictError("provider is invalid");
  return provider;
}

function normalizeCredentialKey(value = "default") {
  const credentialKey = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_.-]{0,79}$/.test(credentialKey)) {
    throw new TenantConflictError("credentialKey is invalid");
  }
  return credentialKey;
}

function toSummary(row: typeof integrationCredentials.$inferSelect) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    workspaceId: row.workspaceId,
    provider: row.provider,
    credentialKey: row.credentialKey,
    displayName: row.displayName,
    authType: row.authType,
    externalAccountId: row.externalAccountId,
    scopes: row.scopes,
    metadata: row.metadata,
    status: row.status,
    expiresAt: row.expiresAt,
    lastUsedAt: row.lastUsedAt,
    lastRotatedAt: row.lastRotatedAt,
    revokedAt: row.revokedAt,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    hasSecret: true as const,
  };
}

export function createIntegrationCredentialsRepository(context: DatabaseTenantContext) {
  assertWorkspaceTenantContext(context);
  const { organizationId, workspaceId, actorId } = context;
  const tenantScope = and(
    eq(integrationCredentials.organizationId, organizationId),
    eq(integrationCredentials.workspaceId, workspaceId),
  )!;

  async function requireWorkspace() {
    const [workspace] = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(
        and(
          eq(workspaces.id, workspaceId),
          eq(workspaces.organizationId, organizationId),
          isNull(workspaces.deletedAt),
        ),
      )
      .limit(1);
    if (!workspace) throw new TenantResourceNotFoundError("workspace");
  }

  async function requireMembership(manage = false) {
    if (!actorId) throw new TenantPermissionDeniedError("actorId is required for integration credential access");
    const [membership] = await db
      .select()
      .from(memberships)
      .where(
        and(
          eq(memberships.userId, actorId),
          eq(memberships.organizationId, organizationId),
          eq(memberships.status, "active"),
          or(isNull(memberships.workspaceId), eq(memberships.workspaceId, workspaceId)),
          manage ? inArray(memberships.role, ["owner", "admin"]) : undefined,
        ),
      )
      .limit(1);
    if (!membership) throw new TenantPermissionDeniedError();
    return membership;
  }

  return {
    async list() {
      await requireWorkspace();
      await requireMembership();
      const rows = await db
        .select({
          id: integrationCredentials.id,
          organizationId: integrationCredentials.organizationId,
          workspaceId: integrationCredentials.workspaceId,
          provider: integrationCredentials.provider,
          credentialKey: integrationCredentials.credentialKey,
          displayName: integrationCredentials.displayName,
          authType: integrationCredentials.authType,
          externalAccountId: integrationCredentials.externalAccountId,
          scopes: integrationCredentials.scopes,
          metadata: integrationCredentials.metadata,
          status: integrationCredentials.status,
          expiresAt: integrationCredentials.expiresAt,
          lastUsedAt: integrationCredentials.lastUsedAt,
          lastRotatedAt: integrationCredentials.lastRotatedAt,
          revokedAt: integrationCredentials.revokedAt,
          createdBy: integrationCredentials.createdBy,
          createdAt: integrationCredentials.createdAt,
          updatedAt: integrationCredentials.updatedAt,
        })
        .from(integrationCredentials)
        .where(and(tenantScope, isNull(integrationCredentials.revokedAt)))
        .orderBy(asc(integrationCredentials.provider), asc(integrationCredentials.credentialKey));
      return rows.map((row) => ({ ...row, hasSecret: true as const }));
    },

    async save(input: SaveIntegrationCredentialInput) {
      await requireWorkspace();
      await requireMembership(true);
      const provider = normalizeProvider(input.provider);
      const credentialKey = normalizeCredentialKey(input.credentialKey);
      const displayName = input.displayName.trim();
      if (!displayName || displayName.length > 160) throw new TenantConflictError("displayName is invalid");
      const expiresAt = input.expiresAt ?? null;
      if (expiresAt && expiresAt <= new Date()) throw new TenantConflictError("expiresAt must be in the future");

      return db.transaction(async (transaction) => {
        const [existing] = await transaction
          .select()
          .from(integrationCredentials)
          .where(
            and(
              tenantScope,
              eq(integrationCredentials.provider, provider),
              eq(integrationCredentials.credentialKey, credentialKey),
              isNull(integrationCredentials.revokedAt),
            ),
          )
          .limit(1);
        if (existing && existing.authType !== input.authType) {
          throw new TenantConflictError("authType cannot change; revoke the credential before replacing it");
        }
        const id = existing?.id ?? randomUUID();
        const envelope = encryptIntegrationCredential(
          { id, organizationId, workspaceId, provider, credentialKey, authType: input.authType },
          input.secrets,
        );
        const rotatedAt = existing ? new Date(Math.max(Date.now(), existing.lastRotatedAt.getTime() + 1)) : new Date();
        const values = {
          displayName,
          ...envelope,
          externalAccountId: input.externalAccountId ?? null,
          scopes: [...new Set(input.scopes ?? [])].sort(),
          metadata: input.metadata ?? {},
          status: "active" as const,
          expiresAt,
          lastRotatedAt: rotatedAt,
          updatedAt: new Date(),
        };
        const [saved] = existing
          ? await transaction
              .update(integrationCredentials)
              .set(values)
              .where(eq(integrationCredentials.id, existing.id))
              .returning()
          : await transaction
              .insert(integrationCredentials)
              .values({
                id,
                organizationId,
                workspaceId,
                provider,
                credentialKey,
                authType: input.authType,
                createdBy: actorId!,
                ...values,
              })
              .returning();
        return toSummary(saved);
      });
    },

    async getForUse(providerInput: string, credentialKeyInput = "default") {
      await requireWorkspace();
      await requireMembership();
      const provider = normalizeProvider(providerInput);
      const credentialKey = normalizeCredentialKey(credentialKeyInput);
      const [row] = await db
        .select()
        .from(integrationCredentials)
        .where(
          and(
            tenantScope,
            eq(integrationCredentials.provider, provider),
            eq(integrationCredentials.credentialKey, credentialKey),
            eq(integrationCredentials.status, "active"),
            isNull(integrationCredentials.revokedAt),
          ),
        )
        .limit(1);
      if (!row) throw new TenantResourceNotFoundError("integration credential");
      if (row.expiresAt && row.expiresAt <= new Date()) {
        await db
          .update(integrationCredentials)
          .set({ status: "expired", updatedAt: new Date() })
          .where(eq(integrationCredentials.id, row.id));
        throw new TenantResourceNotFoundError("active integration credential");
      }
      const identity: CredentialIdentity = {
        id: row.id,
        organizationId,
        workspaceId,
        provider: row.provider,
        credentialKey: row.credentialKey,
        authType: row.authType,
      };
      const secrets = decryptIntegrationCredential(identity, {
        encryptedPayload: row.encryptedPayload,
        initializationVector: row.initializationVector,
        authenticationTag: row.authenticationTag,
        encryptionAlgorithm: "aes-256-gcm",
        encryptionKeyVersion: row.encryptionKeyVersion,
        secretFingerprint: row.secretFingerprint,
      });
      const [used] = await db
        .update(integrationCredentials)
        .set({ lastUsedAt: new Date(), updatedAt: new Date() })
        .where(eq(integrationCredentials.id, row.id))
        .returning();
      return { credential: toSummary(used), secrets };
    },

    async getOAuthForRefresh(providerInput: string, credentialKeyInput = "default") {
      await requireWorkspace();
      await requireMembership(true);
      const provider = normalizeProvider(providerInput);
      const credentialKey = normalizeCredentialKey(credentialKeyInput);
      const [row] = await db
        .select()
        .from(integrationCredentials)
        .where(
          and(
            tenantScope,
            eq(integrationCredentials.provider, provider),
            eq(integrationCredentials.credentialKey, credentialKey),
            inArray(integrationCredentials.status, ["active", "expired"]),
            isNull(integrationCredentials.revokedAt),
          ),
        )
        .limit(1);
      if (!row || row.authType !== "oauth2") throw new TenantResourceNotFoundError("OAuth integration credential");
      const secrets = decryptIntegrationCredential(
        {
          id: row.id,
          organizationId,
          workspaceId,
          provider: row.provider,
          credentialKey: row.credentialKey,
          authType: row.authType,
        },
        {
          encryptedPayload: row.encryptedPayload,
          initializationVector: row.initializationVector,
          authenticationTag: row.authenticationTag,
          encryptionAlgorithm: "aes-256-gcm",
          encryptionKeyVersion: row.encryptionKeyVersion,
          secretFingerprint: row.secretFingerprint,
        },
      );
      return { credential: toSummary(row), secrets };
    },

    async revoke(id: string) {
      await requireWorkspace();
      await requireMembership(true);
      const now = new Date();
      const [revoked] = await db
        .update(integrationCredentials)
        .set({ status: "revoked", revokedAt: now, updatedAt: now })
        .where(and(eq(integrationCredentials.id, id), tenantScope, isNull(integrationCredentials.revokedAt)))
        .returning();
      if (!revoked) throw new TenantResourceNotFoundError("integration credential");
      return toSummary(revoked);
    },
  };
}
