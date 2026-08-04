import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  createPublicKey,
  randomBytes,
  timingSafeEqual,
  verify,
  type KeyObject,
} from "node:crypto";

/**
 * RFC 4648 base64url (no padding) helpers.
 */
export function base64UrlEncode(buffer: Buffer): string {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64UrlDecode(input: string): Buffer {
  return Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

/**
 * RFC 7519 JWT.
 */
export type ParsedToken = {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  signatureInput: string;
  signature: Buffer;
  kid?: string;
};

export function parseToken(token: string): ParsedToken {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new TypeError("Token must contain exactly three segments.");
  }
  const [headerB64, payloadB64, signatureB64] = parts;

  let header: Record<string, unknown>;
  let payload: Record<string, unknown>;
  try {
    header = JSON.parse(base64UrlDecode(headerB64).toString("utf8"));
    payload = JSON.parse(base64UrlDecode(payloadB64).toString("utf8"));
  } catch {
    throw new TypeError("Token segment is not valid JSON.");
  }

  const signature = base64UrlDecode(signatureB64);

  return {
    header,
    payload,
    signatureInput: `${headerB64}.${payloadB64}`,
    signature,
    kid: typeof header.kid === "string" ? header.kid : undefined,
  };
}

/**
 * Ed25519 (SPKI/DER) derivation.
 *
 * LicenseHub exposes the raw 32-byte Ed25519 public key as base64. Node's
 * crypto.verify needs a KeyObject, so we wrap the raw bytes in the standard
 * SPKI DER structure before importing it.
 */
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export function publicKeyFromRaw(publicKeyB64: string): KeyObject {
  const raw = Buffer.from(publicKeyB64, "base64");
  if (raw.length !== 32) {
    throw new Error(`Invalid Ed25519 public key length: ${raw.length}`);
  }
  const spki = Buffer.concat([ED25519_SPKI_PREFIX, raw]);

  return createPublicKey({ key: spki, format: "der", type: "spki" });
}

/**
 * Verify an EdDSA JWT signature over `header.payload`.
 */
export function verifySignature(parsed: ParsedToken, publicKeyB64: string, expectedAlgorithm = "EdDSA"): boolean {
  const algorithm = parsed.header.alg;
  if (algorithm !== expectedAlgorithm) {
    throw new TypeError(`Unsupported token algorithm: ${String(algorithm)}`);
  }

  try {
    const publicKey = publicKeyFromRaw(publicKeyB64);

    return verify(null, Buffer.from(parsed.signatureInput, "utf8"), publicKey, parsed.signature);
  } catch {
    return false;
  }
}

/**
 * HMAC-SHA256 binding used by LicenseHub to bind a token to an installation.
 */
export function hmacSha256(data: string, secret: string): string {
  return createHmac("sha256", secret).update(data, "utf8").digest("hex");
}

/**
 * Constant-time comparison of two hex/string digests.
 */
export function digestsEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;

  return timingSafeEqual(aBuf, bBuf);
}

/**
 * Derive a 32-byte symmetric key from a passphrase. SHA-256 is used as a
 * deliberately simple KDF; pass a high-entropy secret (>= 32 random bytes,
 * base64) in production for defense-in-depth.
 */
export function deriveEncryptionKey(secret: string): Buffer {
  return createHash("sha256").update(secret, "utf8").digest();
}

/**
 * AES-256-GCM encrypt a UTF-8 string. Every call uses a fresh 12-byte IV and a
 * random 16-byte auth tag, so identical plaintexts never share ciphertext and
 * any modification (tampering) fails authentication on decrypt.
 *
 * Output layout: `iv.tag.data` (all base64url, no padding).
 */
export function encryptString(secret: string, plaintext: string): string {
  const key = deriveEncryptionKey(secret);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [iv, tag, encrypted].map((buf) => base64UrlEncode(buf)).join(".");
}

/**
 * Decrypt a payload produced by {@link encryptString}. Throws if the auth tag
 * does not match (i.e. the ciphertext was modified or the secret differs).
 */
export function decryptString(secret: string, encoded: string): string {
  const [ivB64, tagB64, dataB64] = encoded.split(".");

  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error("Malformed encrypted payload.");
  }

  const key = deriveEncryptionKey(secret);
  const decipher = createDecipheriv("aes-256-gcm", key, base64UrlDecode(ivB64));
  decipher.setAuthTag(base64UrlDecode(tagB64));

  const plaintext = Buffer.concat([decipher.update(base64UrlDecode(dataB64)), decipher.final()]);

  return plaintext.toString("utf8");
}

/** Convenience: encrypt a JavaScript object to an AES-256-GCM JSON payload. */
export function encryptJson(secret: string, value: unknown): string {
  return encryptString(secret, JSON.stringify(value));
}

/** Convenience: decrypt + parse an AES-256-GCM JSON payload. */
export function decryptJson<T>(secret: string, encoded: string): T {
  return JSON.parse(decryptString(secret, encoded)) as T;
}
