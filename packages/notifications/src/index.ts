import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export type AuthEmailPurpose = "email_verification" | "password_reset";

export type AuthEmailIdentity = {
  id: string;
  userId: string;
  authTokenId: string;
  purpose: AuthEmailPurpose;
};

export type AuthEmailPayload = {
  to: string;
  name: string;
  subject: string;
  html: string;
};

export type AuthEmailEncryptionEnvelope = {
  encryptedPayload: string;
  initializationVector: string;
  authenticationTag: string;
  encryptionAlgorithm: "aes-256-gcm";
  encryptionKeyVersion: number;
};

export type InvitationEmailIdentity = {
  id: string;
  organizationId: string;
  workspaceId: string | null;
  invitationId: string;
  tokenVersion: number;
};

export type InvitationEmailPayload = AuthEmailPayload;
export type InvitationEmailEncryptionEnvelope = AuthEmailEncryptionEnvelope;

export class AuthEmailEncryptionError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AuthEmailEncryptionError";
  }
}

function decodeKey(value: string) {
  const key = /^[a-f0-9]{64}$/i.test(value) ? Buffer.from(value, "hex") : Buffer.from(value, "base64");
  if (key.length !== 32) throw new AuthEmailEncryptionError("Auth email encryption keys must contain 32 bytes");
  return key;
}

function loadKeyring(env: NodeJS.ProcessEnv) {
  const keyring = new Map<number, Buffer>();
  const serialized = env.AUTH_EMAIL_ENCRYPTION_KEYS;
  if (serialized) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(serialized);
    } catch (error) {
      throw new AuthEmailEncryptionError("AUTH_EMAIL_ENCRYPTION_KEYS must be valid JSON", { cause: error });
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new AuthEmailEncryptionError("AUTH_EMAIL_ENCRYPTION_KEYS must be a version-to-key object");
    }
    for (const [versionText, value] of Object.entries(parsed)) {
      const version = Number(versionText);
      if (!Number.isSafeInteger(version) || version <= 0 || typeof value !== "string") {
        throw new AuthEmailEncryptionError("Auth email encryption key versions must be positive integers");
      }
      keyring.set(version, decodeKey(value));
    }
  } else if (env.AUTH_EMAIL_ENCRYPTION_KEY) {
    const version = Number(env.AUTH_EMAIL_ENCRYPTION_ACTIVE_KEY_VERSION ?? "1");
    if (!Number.isSafeInteger(version) || version <= 0) {
      throw new AuthEmailEncryptionError("AUTH_EMAIL_ENCRYPTION_ACTIVE_KEY_VERSION must be a positive integer");
    }
    keyring.set(version, decodeKey(env.AUTH_EMAIL_ENCRYPTION_KEY));
  }
  if (!keyring.size) {
    throw new AuthEmailEncryptionError("AUTH_EMAIL_ENCRYPTION_KEY or AUTH_EMAIL_ENCRYPTION_KEYS is required");
  }
  const requested = env.AUTH_EMAIL_ENCRYPTION_ACTIVE_KEY_VERSION;
  const activeVersion = requested ? Number(requested) : Math.max(...keyring.keys());
  if (!Number.isSafeInteger(activeVersion) || !keyring.has(activeVersion)) {
    throw new AuthEmailEncryptionError("The active auth email encryption key version is unavailable");
  }
  return { keyring, activeVersion };
}

function aad(identity: AuthEmailIdentity, keyVersion: number) {
  return Buffer.from(
    [identity.id, identity.userId, identity.authTokenId, identity.purpose, keyVersion].join("\u001f"),
    "utf8",
  );
}

function invitationAad(identity: InvitationEmailIdentity, keyVersion: number) {
  return Buffer.from(
    [
      identity.id,
      identity.organizationId,
      identity.workspaceId ?? "",
      identity.invitationId,
      identity.tokenVersion,
      keyVersion,
    ].join("\u001f"),
    "utf8",
  );
}

function normalizePayload(payload: AuthEmailPayload): AuthEmailPayload {
  const normalized = {
    to: payload.to.trim().toLowerCase(),
    name: payload.name.trim(),
    subject: payload.subject.trim(),
    html: payload.html,
  };
  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized.to) ||
    normalized.to.length > 255 ||
    !normalized.name ||
    normalized.name.length > 255 ||
    !normalized.subject ||
    normalized.subject.length > 500 ||
    !normalized.html ||
    Buffer.byteLength(normalized.html, "utf8") > 131_072
  ) {
    throw new AuthEmailEncryptionError("Auth email payload is invalid");
  }
  return normalized;
}

export function encryptAuthEmailPayload(
  identity: AuthEmailIdentity,
  payload: AuthEmailPayload,
  env: NodeJS.ProcessEnv = process.env,
): AuthEmailEncryptionEnvelope {
  const normalized = normalizePayload(payload);
  const { keyring, activeVersion } = loadKeyring(env);
  const initializationVector = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyring.get(activeVersion)!, initializationVector);
  cipher.setAAD(aad(identity, activeVersion));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(normalized), "utf8"), cipher.final()]);
  return {
    encryptedPayload: encrypted.toString("base64"),
    initializationVector: initializationVector.toString("base64"),
    authenticationTag: cipher.getAuthTag().toString("base64"),
    encryptionAlgorithm: "aes-256-gcm",
    encryptionKeyVersion: activeVersion,
  };
}

export function decryptAuthEmailPayload(
  identity: AuthEmailIdentity,
  envelope: AuthEmailEncryptionEnvelope,
  env: NodeJS.ProcessEnv = process.env,
) {
  const { keyring } = loadKeyring(env);
  const key = keyring.get(envelope.encryptionKeyVersion);
  if (!key) throw new AuthEmailEncryptionError("The auth email encryption key version is unavailable");
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.initializationVector, "base64"));
    decipher.setAAD(aad(identity, envelope.encryptionKeyVersion));
    decipher.setAuthTag(Buffer.from(envelope.authenticationTag, "base64"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.encryptedPayload, "base64")),
      decipher.final(),
    ]).toString("utf8");
    return normalizePayload(JSON.parse(plaintext) as AuthEmailPayload);
  } catch (error) {
    if (error instanceof AuthEmailEncryptionError) throw error;
    throw new AuthEmailEncryptionError("Auth email payload authentication failed", { cause: error });
  }
}

export function encryptInvitationEmailPayload(
  identity: InvitationEmailIdentity,
  payload: InvitationEmailPayload,
  env: NodeJS.ProcessEnv = process.env,
): InvitationEmailEncryptionEnvelope {
  if (!Number.isSafeInteger(identity.tokenVersion) || identity.tokenVersion <= 0) {
    throw new AuthEmailEncryptionError("Invitation email token version must be a positive integer");
  }
  const normalized = normalizePayload(payload);
  const { keyring, activeVersion } = loadKeyring(env);
  const initializationVector = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyring.get(activeVersion)!, initializationVector);
  cipher.setAAD(invitationAad(identity, activeVersion));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(normalized), "utf8"), cipher.final()]);
  return {
    encryptedPayload: encrypted.toString("base64"),
    initializationVector: initializationVector.toString("base64"),
    authenticationTag: cipher.getAuthTag().toString("base64"),
    encryptionAlgorithm: "aes-256-gcm",
    encryptionKeyVersion: activeVersion,
  };
}

export function decryptInvitationEmailPayload(
  identity: InvitationEmailIdentity,
  envelope: InvitationEmailEncryptionEnvelope,
  env: NodeJS.ProcessEnv = process.env,
) {
  const { keyring } = loadKeyring(env);
  const key = keyring.get(envelope.encryptionKeyVersion);
  if (!key) throw new AuthEmailEncryptionError("The invitation email encryption key version is unavailable");
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.initializationVector, "base64"));
    decipher.setAAD(invitationAad(identity, envelope.encryptionKeyVersion));
    decipher.setAuthTag(Buffer.from(envelope.authenticationTag, "base64"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.encryptedPayload, "base64")),
      decipher.final(),
    ]).toString("utf8");
    return normalizePayload(JSON.parse(plaintext) as InvitationEmailPayload);
  } catch (error) {
    if (error instanceof AuthEmailEncryptionError) throw error;
    throw new AuthEmailEncryptionError("Invitation email payload authentication failed", { cause: error });
  }
}
