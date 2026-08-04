import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { decryptJson, encryptJson } from "./crypto.js";
import type { LicenseStatus } from "./status.js";

/**
 * Persistent licensing state for one installation + product. The SDK treats
 * the payload/publicKeys as opaque; the caller may encrypt them at rest.
 */
export type StoredLicense = {
  product: string;
  status: LicenseStatus;
  licenseKey?: string;
  fingerprint?: string;
  token?: string;
  payload?: Record<string, unknown>;
  publicKeys?: Record<string, string>;
  tokenExpiresAt?: number;
  activatedAt?: number;
  lastHeartbeatAt?: number;
  lastValidatedAt?: number;
};

export interface LicenseStore {
  get(): Promise<StoredLicense | null>;
  put(state: StoredLicense): Promise<void>;
}

export class MemoryLicenseStore implements LicenseStore {
  constructor(private state: StoredLicense | null = null) {}

  get(): Promise<StoredLicense | null> {
    return Promise.resolve(this.state);
  }

  put(state: StoredLicense): Promise<void> {
    this.state = state;
    return Promise.resolve();
  }
}

/**
 * JSON-file backed store. Writes are atomic (temp file + rename) so a crash
 * mid-write cannot corrupt the license that enabled a running installation.
 */
export class FileLicenseStore implements LicenseStore {
  constructor(private readonly path: string) {}

  async get(): Promise<StoredLicense | null> {
    try {
      const raw = await readFile(this.path, "utf8");

      return JSON.parse(raw) as StoredLicense;
    } catch {
      return null;
    }
  }

  async put(state: StoredLicense): Promise<void> {
    const tmp = `${this.path}.tmp`;
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(tmp, JSON.stringify(state, null, 2), "utf8");
    await rename(tmp, this.path);
  }
}

/**
 * AES-256-GCM encrypted file store.
 *
 * The entire license state (including the signed token and keyring) is
 * encrypted at rest with a caller-supplied secret. Because GCM authenticates
 * the ciphertext, any manual edit or tampering of the file is detected and
 * results in `get()` returning null (the state is never trusted), so an
 * attacker cannot silently weaken or extend a license by editing the file.
 */
export class EncryptedFileLicenseStore implements LicenseStore {
  constructor(
    private readonly path: string,
    private readonly secret: string,
  ) {}

  async get(): Promise<StoredLicense | null> {
    try {
      const raw = await readFile(this.path, "utf8");
      return decryptJson<StoredLicense>(this.secret, raw);
    } catch {
      return null;
    }
  }

  async put(state: StoredLicense): Promise<void> {
    const tmp = `${this.path}.tmp`;
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(tmp, encryptJson(this.secret, state), "utf8");
    await rename(tmp, this.path);
  }
}
