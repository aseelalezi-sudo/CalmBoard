import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "../client.js";
import { mfaRecoveryCodes, userMfaFactors } from "../schema.js";

const TOTP_PERIOD_SECONDS = 30;
const TOTP_DIGITS = 6;
const RECOVERY_CODE_COUNT = 10;

type MfaEnvelope = Pick<
  typeof userMfaFactors.$inferSelect,
  "encryptedTotpSecret" | "initializationVector" | "authenticationTag" | "encryptionKeyVersion"
>;

export class MfaEncryptionError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "MfaEncryptionError";
  }
}

function decodeKey(value: string) {
  const key = /^[a-f0-9]{64}$/i.test(value) ? Buffer.from(value, "hex") : Buffer.from(value, "base64");
  if (key.length !== 32) throw new MfaEncryptionError("MFA encryption keys must contain exactly 32 bytes");
  return key;
}

function loadKeyring() {
  const keyring = new Map<number, Buffer>();
  if (process.env.MFA_ENCRYPTION_KEYS) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(process.env.MFA_ENCRYPTION_KEYS);
    } catch (error) {
      throw new MfaEncryptionError("MFA_ENCRYPTION_KEYS must be valid JSON", { cause: error });
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new MfaEncryptionError("MFA_ENCRYPTION_KEYS must be a version-to-key object");
    }
    for (const [versionText, value] of Object.entries(parsed)) {
      const version = Number(versionText);
      if (!Number.isSafeInteger(version) || version <= 0 || typeof value !== "string") {
        throw new MfaEncryptionError("MFA encryption key versions must be positive integers");
      }
      keyring.set(version, decodeKey(value));
    }
  } else if (process.env.MFA_ENCRYPTION_KEY) {
    const version = Number(process.env.MFA_ENCRYPTION_ACTIVE_KEY_VERSION ?? "1");
    if (!Number.isSafeInteger(version) || version <= 0) {
      throw new MfaEncryptionError("MFA_ENCRYPTION_ACTIVE_KEY_VERSION must be a positive integer");
    }
    keyring.set(version, decodeKey(process.env.MFA_ENCRYPTION_KEY));
  }
  if (!keyring.size) throw new MfaEncryptionError("MFA_ENCRYPTION_KEY or MFA_ENCRYPTION_KEYS is required");
  const requested = process.env.MFA_ENCRYPTION_ACTIVE_KEY_VERSION;
  const activeVersion = requested ? Number(requested) : Math.max(...keyring.keys());
  if (!Number.isSafeInteger(activeVersion) || !keyring.has(activeVersion)) {
    throw new MfaEncryptionError("The active MFA encryption key version is unavailable");
  }
  return { keyring, activeVersion };
}

function aad(userId: string, keyVersion: number) {
  return Buffer.from(`${userId}\u001ftotp\u001f${keyVersion}`, "utf8");
}

function encryptSecret(userId: string, secret: string) {
  const { keyring, activeVersion } = loadKeyring();
  const initializationVector = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyring.get(activeVersion)!, initializationVector);
  cipher.setAAD(aad(userId, activeVersion));
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return {
    encryptedTotpSecret: encrypted.toString("base64"),
    initializationVector: initializationVector.toString("base64"),
    authenticationTag: cipher.getAuthTag().toString("base64"),
    encryptionKeyVersion: activeVersion,
  };
}

function decryptSecret(userId: string, envelope: MfaEnvelope) {
  const { keyring } = loadKeyring();
  const key = keyring.get(envelope.encryptionKeyVersion);
  if (!key) throw new MfaEncryptionError("The MFA encryption key version is unavailable");
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.initializationVector, "base64"));
    decipher.setAAD(aad(userId, envelope.encryptionKeyVersion));
    decipher.setAuthTag(Buffer.from(envelope.authenticationTag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(envelope.encryptedTotpSecret, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch (error) {
    throw new MfaEncryptionError("MFA secret authentication failed", { cause: error });
  }
}

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function encodeBase32(input: Buffer) {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of input) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function decodeBase32(input: string) {
  let bits = 0;
  let value = 0;
  const output: number[] = [];
  for (const character of input.toUpperCase().replace(/=+$/g, "")) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index < 0) throw new Error("Invalid Base32 secret");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

export function generateTotpCode(secret: string, timestamp = Date.now(), digits = TOTP_DIGITS) {
  const step = Math.floor(timestamp / 1_000 / TOTP_PERIOD_SECONDS);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac("sha1", decodeBase32(secret)).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const value =
    (((digest[offset] & 0x7f) << 24) |
      ((digest[offset + 1] & 0xff) << 16) |
      ((digest[offset + 2] & 0xff) << 8) |
      (digest[offset + 3] & 0xff)) %
    10 ** digits;
  return value.toString().padStart(digits, "0");
}

function matchingStep(secret: string, code: string, timestamp: number) {
  if (!/^\d{6}$/.test(code)) return null;
  const supplied = Buffer.from(code, "utf8");
  const currentStep = Math.floor(timestamp / 1_000 / TOTP_PERIOD_SECONDS);
  for (const offset of [-1, 0, 1]) {
    const step = currentStep + offset;
    const expected = Buffer.from(generateTotpCode(secret, step * TOTP_PERIOD_SECONDS * 1_000), "utf8");
    if (timingSafeEqual(supplied, expected)) return step;
  }
  return null;
}

function recoveryCodeHash(code: string) {
  return createHash("sha256").update(code.replaceAll("-", "").toUpperCase(), "utf8").digest("hex");
}

function generateRecoveryCodes() {
  return Array.from({ length: RECOVERY_CODE_COUNT }, () =>
    randomBytes(16)
      .toString("hex")
      .toUpperCase()
      .match(/.{1,8}/g)!
      .join("-"),
  );
}

export function createMfaRepository() {
  async function verify(userId: string, code: string, timestamp = Date.now()) {
    return db.transaction(async (transaction) => {
      const [factor] = await transaction
        .select()
        .from(userMfaFactors)
        .where(and(eq(userMfaFactors.userId, userId), eq(userMfaFactors.status, "enabled")))
        .for("update")
        .limit(1);
      if (!factor) return false;
      if (/^\d{6}$/.test(code)) {
        const step = matchingStep(decryptSecret(userId, factor), code, timestamp);
        if (step === null || (factor.lastUsedStep !== null && step <= factor.lastUsedStep)) return false;
        await transaction
          .update(userMfaFactors)
          .set({ lastUsedStep: step, updatedAt: new Date(timestamp) })
          .where(eq(userMfaFactors.userId, userId));
        return true;
      }
      if (!/^[A-Fa-f0-9]{8}(?:-[A-Fa-f0-9]{8}){3}$/.test(code)) return false;
      const [consumed] = await transaction
        .update(mfaRecoveryCodes)
        .set({ usedAt: new Date(timestamp) })
        .where(
          and(
            eq(mfaRecoveryCodes.userId, userId),
            eq(mfaRecoveryCodes.codeHash, recoveryCodeHash(code)),
            isNull(mfaRecoveryCodes.usedAt),
          ),
        )
        .returning({ id: mfaRecoveryCodes.id });
      return Boolean(consumed);
    });
  }

  return {
    async status(userId: string) {
      const [factor] = await db
        .select({ status: userMfaFactors.status, enabledAt: userMfaFactors.enabledAt })
        .from(userMfaFactors)
        .where(eq(userMfaFactors.userId, userId))
        .limit(1);
      const [{ count }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(mfaRecoveryCodes)
        .where(and(eq(mfaRecoveryCodes.userId, userId), isNull(mfaRecoveryCodes.usedAt)));
      return {
        enabled: factor?.status === "enabled",
        enabledAt: factor?.enabledAt ?? null,
        recoveryCodesRemaining: count,
      };
    },

    async isEnabled(userId: string) {
      const [factor] = await db
        .select({ userId: userMfaFactors.userId })
        .from(userMfaFactors)
        .where(and(eq(userMfaFactors.userId, userId), eq(userMfaFactors.status, "enabled")))
        .limit(1);
      return Boolean(factor);
    },

    async beginSetup(userId: string, email: string) {
      const [enabled] = await db
        .select({ userId: userMfaFactors.userId })
        .from(userMfaFactors)
        .where(and(eq(userMfaFactors.userId, userId), eq(userMfaFactors.status, "enabled")))
        .limit(1);
      if (enabled) return null;
      const secret = encodeBase32(randomBytes(20));
      const envelope = encryptSecret(userId, secret);
      const now = new Date();
      await db.transaction(async (transaction) => {
        await transaction.delete(mfaRecoveryCodes).where(eq(mfaRecoveryCodes.userId, userId));
        await transaction
          .insert(userMfaFactors)
          .values({ userId, status: "pending", ...envelope, enabledAt: null, lastUsedStep: null, updatedAt: now })
          .onConflictDoUpdate({
            target: userMfaFactors.userId,
            set: { status: "pending", ...envelope, enabledAt: null, lastUsedStep: null, updatedAt: now },
          });
      });
      const issuer = "CalmBoard";
      const label = `${issuer}:${email}`;
      const uri = `otpauth://totp/${encodeURIComponent(label)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
      return { secret, uri };
    },

    async enable(userId: string, code: string, timestamp = Date.now()) {
      const recoveryCodes = generateRecoveryCodes();
      return db.transaction(async (transaction) => {
        const [factor] = await transaction
          .select()
          .from(userMfaFactors)
          .where(and(eq(userMfaFactors.userId, userId), eq(userMfaFactors.status, "pending")))
          .for("update")
          .limit(1);
        if (!factor) return null;
        const step = matchingStep(decryptSecret(userId, factor), code, timestamp);
        if (step === null) return null;
        const now = new Date(timestamp);
        await transaction
          .update(userMfaFactors)
          .set({ status: "enabled", enabledAt: now, lastUsedStep: step, updatedAt: now })
          .where(eq(userMfaFactors.userId, userId));
        await transaction.delete(mfaRecoveryCodes).where(eq(mfaRecoveryCodes.userId, userId));
        await transaction
          .insert(mfaRecoveryCodes)
          .values(
            recoveryCodes.map((recoveryCode) => ({ userId, codeHash: recoveryCodeHash(recoveryCode), createdAt: now })),
          );
        return { recoveryCodes, enabledAt: now };
      });
    },

    verify,

    async disable(userId: string, code: string) {
      if (!(await verify(userId, code))) return false;
      await db.transaction(async (transaction) => {
        await transaction.delete(mfaRecoveryCodes).where(eq(mfaRecoveryCodes.userId, userId));
        await transaction.delete(userMfaFactors).where(eq(userMfaFactors.userId, userId));
      });
      return true;
    },
  };
}
