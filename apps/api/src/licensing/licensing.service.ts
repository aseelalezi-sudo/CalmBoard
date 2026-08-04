import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import {
  EncryptedFileLicenseStore,
  MemoryLicenseStore,
  createLicensing,
  type LicenseCheck,
  type LicenseStatus,
  type LicenseService as LicenseServiceClient,
} from "@calmboard/licensing";

/**
 * Application-facing license status. `disabled` means the instance was not
 * configured to enforce licensing (`CALMBOARD_LICENSE_ENFORCED != "true"`).
 */
export type AppLicenseStatus = LicenseStatus | "disabled" | "not_initialized";

export type AppLicenseCheck = Omit<LicenseCheck, "status"> & { status: AppLicenseStatus };

export const LICENSING_STATUS_TTL_MS = 30_000;

/**
 * Wraps the framework-agnostic {@link LicenseServiceClient} for NestJS:
 *  - builds it from `CALMBOARD_LICENSE_*` env vars,
 *  - checks the license once at startup,
 *  - caches the latest check for a short TTL so the guard stays cheap,
 *  - exposes `status()` / `refresh()` for the status controller.
 *
 * When enforcement is off the service is a harmless no-op: guards pass.
 */
@Injectable()
export class LicensingService implements OnModuleInit {
  private readonly logger = new Logger(LicensingService.name);
  private readonly enabled: boolean;
  private readonly client: LicenseServiceClient | null;
  private check: AppLicenseCheck;
  private checkedAt = 0;

  constructor() {
    this.enabled = process.env.CALMBOARD_LICENSE_ENFORCED === "true";

    if (!this.enabled) {
      this.client = null;
      this.check = {
        status: "disabled",
        reason: "Licensing enforcement is disabled for this instance.",
        claims: {},
        token: null,
        valid: false,
        grace: false,
      };
      return;
    }

    const serverUrl = process.env.CALMBOARD_LICENSE_SERVER_URL;
    const deviceHashSecret = process.env.CALMBOARD_LICENSE_DEVICE_HASH_SECRET;

    if (!serverUrl || !deviceHashSecret) {
      throw new Error(
        "CALMBOARD_LICENSE_ENFORCED=true requires CALMBOARD_LICENSE_SERVER_URL and CALMBOARD_LICENSE_DEVICE_HASH_SECRET.",
      );
    }

    const storeSecret = process.env.CALMBOARD_LICENSE_STORE_SECRET;
    const storeFile = process.env.CALMBOARD_LICENSE_STORE_FILE;
    const store =
      storeSecret && storeFile ? new EncryptedFileLicenseStore(storeFile, storeSecret) : new MemoryLicenseStore();

    this.client = createLicensing({
      enabled: true,
      serverUrl,
      product: process.env.CALMBOARD_LICENSE_PRODUCT ?? "calmboard",
      licenseKey: process.env.CALMBOARD_LICENSE_KEY,
      issuer: process.env.CALMBOARD_LICENSE_ISSUER ?? "licensehub",
      deviceHashSecret,
      store,
      graceSeconds: numberEnv("CALMBOARD_LICENSE_GRACE_SECONDS", 7 * 24 * 60 * 60),
      revalidationIntervalSeconds: numberEnv("CALMBOARD_LICENSE_REVALIDATION_SECONDS", 24 * 60 * 60),
      timeoutMs: numberEnv("CALMBOARD_LICENSE_TIMEOUT_MS", 5000),
    });

    this.check = {
      status: "not_initialized",
      reason: "Licensing check has not run yet.",
      claims: {},
      token: null,
      valid: false,
      grace: false,
    };
  }

  get enabledLicensing(): boolean {
    return this.enabled;
  }

  async onModuleInit(): Promise<void> {
    if (!this.client) return;
    try {
      await this.refresh();
      this.logger.log(`License status: ${this.check.status} (valid=${this.check.valid})`);
    } catch (error) {
      this.logger.warn(`Licensing boot failed: ${String(error)}`);
    }
  }

  /**
   * Latest cached check, refreshed at most every {@link LICENSING_STATUS_TTL_MS}.
   */
  async status(): Promise<AppLicenseCheck> {
    if (this.client && Date.now() - this.checkedAt >= LICENSING_STATUS_TTL_MS) {
      await this.refresh();
    }
    return this.check;
  }

  /** Force a fresh check (network + local verification). */
  async refresh(): Promise<AppLicenseCheck> {
    if (!this.client) return this.check;
    try {
      this.check = await this.client.boot();
    } catch (error) {
      this.logger.warn(`License refresh failed: ${String(error)}`);
    }
    this.checkedAt = Date.now();
    return this.check;
  }

  /**
   * Activate (or re-activate) the installation with a key typed by the user.
   * The key is persisted; later boots keep using it.
   */
  async activate(licenseKey: string): Promise<AppLicenseCheck> {
    if (!this.client) {
      return this.check;
    }
    const normalized = licenseKey.trim();
    if (!/^[A-Z0-9-]{5,128}$/.test(normalized)) {
      throw new Error("Invalid license key format.");
    }
    this.check = await this.client.activateKey(normalized);
    this.checkedAt = Date.now();
    return this.check;
  }

  /** Deactivate locally and free the server-side seat. */
  async deactivate(): Promise<AppLicenseCheck> {
    if (!this.client) {
      return this.check;
    }
    await this.client.deactivate();
    await this.refresh();
    return this.check;
  }
}

function numberEnv(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}
