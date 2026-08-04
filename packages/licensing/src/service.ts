import { digestsEqual, hmacSha256, parseToken, verifySignature, type ParsedToken } from "./crypto.js";
import { createDeviceFingerprint } from "./device.js";
import { LicenseClient, type LicenseTransport, type ServerResponse } from "./http.js";
import {
  failedCheck,
  graceCheck,
  validCheck,
  type LicenseCheck,
  type LicenseClaims,
  type LicenseStatus,
} from "./status.js";
import {
  MemoryLicenseStore,
  FileLicenseStore,
  EncryptedFileLicenseStore,
  type LicenseStore,
  type StoredLicense,
} from "./store.js";

export type LicensingOptions = {
  enabled?: boolean;
  serverUrl: string;
  product: string;
  licenseKey?: string;
  issuer?: string;
  /** MUST equal LicenseHub's LICENSE_DEVICE_HASH_SECRET. */
  deviceHashSecret: string;
  clientName?: string;
  clientVersion?: string;
  timeoutMs?: number;
  /**
   * How many seconds a license may keep being honored offline AFTER its token
   * has expired, measured from the last successful online validation. During
   * that window `boot()` returns `grace_period` (still `valid: true`) when the
   * server is unreachable. Default: 7 days.
   */
  graceSeconds?: number;
  /**
   * Re-validate against the server at most this often even while a locally
   * valid token is cached, so revocations issued in LicenseHub are noticed
   * promptly. Default: 24h.
   */
  revalidationIntervalSeconds?: number;
  /** Path for a {@link FileLicenseStore} or a custom store (default: in-memory). */
  store?: LicenseStore;
  /** Provide a fake client for tests. Defaults to a real {@link LicenseClient}. */
  transport?: LicenseTransport;
  /** Injectable clock (seconds); tests use it to simulate expiry. */
  nowSecond?: () => number;
  /** Optional hardware fingerprint provider. Defaults to {@link createDeviceFingerprint}. */
  fingerprint?: () => Promise<string>;
  /** Path where the default fingerprint persists its machine salt. */
  fingerprintSaltPath?: string;
};

export type { ServerResponse };
export {
  LicenseClient,
  type LicenseTransport,
  MemoryLicenseStore,
  FileLicenseStore,
  EncryptedFileLicenseStore,
  type LicenseStore,
  type StoredLicense,
};

const DEFAULT_GRACE_SECONDS = 7 * 24 * 60 * 60;
const DEFAULT_REVALIDATION_INTERVAL_SECONDS = 24 * 60 * 60;

/**
 * Entry-point facade for the CalmBoard licensing SDK.
 *
 * Mirrors the PHP SDK: verifies the signed token fully offline within its
 * grace window, falls back to the network (validate -> activate), and exposes
 * the feature flags to the application. Framework-agnostic.
 *
 * Offline behaviour:
 *  - token unexpired + correctly signed  -> `valid` (no network needed)
 *  - token expired but inside grace since last online check and offline
 *    -> `grace_period` (valid, honoured)
 *  - token expired, offline past grace   -> `grace_expired` (needs network)
 *  - no cached token and offline         -> `offline`
 *  - tampered / other-device token       -> `invalid_token` (never honoured)
 */
export class LicenseService {
  private readonly enabled: boolean;
  private readonly product: string;
  private readonly issuer: string;
  private readonly licenseKey: string | undefined;
  private readonly deviceHashSecret: string;
  private readonly graceSeconds: number;
  private readonly revalidationIntervalSeconds: number;
  private readonly store: LicenseStore;
  private readonly transport: LicenseTransport;
  private readonly nowSecond: () => number;
  private readonly fingerprint: () => Promise<string>;

  constructor(options: LicensingOptions) {
    this.enabled = options.enabled ?? true;
    this.product = options.product;
    this.issuer = options.issuer ?? "licensehub";
    this.licenseKey = options.licenseKey;
    this.deviceHashSecret = options.deviceHashSecret;
    this.graceSeconds = options.graceSeconds ?? DEFAULT_GRACE_SECONDS;
    this.revalidationIntervalSeconds = options.revalidationIntervalSeconds ?? DEFAULT_REVALIDATION_INTERVAL_SECONDS;
    this.nowSecond = options.nowSecond ?? (() => Math.floor(Date.now() / 1000));
    this.store = options.store ?? new MemoryLicenseStore();
    this.fingerprint =
      options.fingerprint ?? (() => createDeviceFingerprint({ saltPath: options.fingerprintSaltPath }));
    this.transport =
      options.transport ??
      new LicenseClient({
        baseUrl: options.serverUrl,
        timeoutMs: options.timeoutMs ?? 5000,
        clientName: options.clientName ?? "calmboard-sdk",
        clientVersion: options.clientVersion ?? "1.0.0",
      });
  }

  async state(): Promise<StoredLicense | null> {
    return this.store.get();
  }

  /**
   * Check licensing. A valid, unexpired, correctly signed token serves fully
   * offline; otherwise validate -> activate -> grace; then a concrete failure.
   */
  async boot(): Promise<LicenseCheck> {
    if (!this.enabled) {
      return validCheck({}, "");
    }

    const state = await this.ensureFingerprint();
    const local = this.verifyLocally(state);

    if (local.valid) {
      if (this.revalidationDue(state)) {
        return this.revalidate(state, local);
      }
      return local;
    }

    // Everything except expiry / missing token is definitive (tampering,
    // wrong device, unknown key) and must never be graced.
    if (local.status !== "expired" && local.status !== "not_activated") {
      return local;
    }

    return this.onlinePath(state, local.status);
  }

  async activate(): Promise<LicenseCheck> {
    const state = await this.ensureFingerprint();
    const key = state.licenseKey ?? this.licenseKey;

    if (!key) {
      return failedCheck("not_activated", "No license key is configured for this installation.");
    }

    const response = await this.transport.activate({
      licenseKey: key,
      fingerprint: state.fingerprint ?? "",
      deviceName: "CalmBoard",
      platform: "web",
    });

    if (response.transportError) {
      return failedCheck("offline", "Cannot reach the license server.");
    }
    if (response.ok) {
      return this.applyIssued(state, response);
    }

    return this.mapFailure(state, response);
  }

  /**
   * One-off activation with a key supplied at runtime (e.g. typed by the user
   * in the UI). The key is persisted so later boots keep using it.
   */
  async activateKey(licenseKey: string): Promise<LicenseCheck> {
    const state = await this.ensureFingerprint();

    state.licenseKey = licenseKey;
    await this.save(state);

    const response = await this.transport.activate({
      licenseKey,
      fingerprint: state.fingerprint ?? "",
      deviceName: "CalmBoard",
      platform: "web",
    });

    if (response.transportError) {
      return failedCheck("offline", "Cannot reach the license server.");
    }
    if (response.ok) {
      return this.applyIssued(state, response);
    }

    return this.mapFailure(state, response);
  }

  async validate(): Promise<LicenseCheck> {
    const state = await this.ensureFingerprint();
    if (!this.hasLicenseKey(state)) {
      return failedCheck("not_activated", "No license key is configured for this installation.");
    }

    return this.onlinePath(state, "not_activated");
  }

  async heartbeat(): Promise<LicenseCheck> {
    const state = await this.ensureFingerprint();
    const key = state.licenseKey ?? this.licenseKey;

    if (!key) {
      return failedCheck("not_activated", "No license key is configured for this installation.");
    }

    const response = await this.transport.heartbeat({
      licenseKey: key,
      fingerprint: state.fingerprint ?? "",
    });

    if (response.transportError) {
      return this.offlineFallback(state);
    }
    if (response.ok) {
      state.lastHeartbeatAt = this.nowSecond();
      await this.save(state);

      const local = this.verifyLocally(state);
      if (local.status === "expired") {
        return this.offlineFallback(state);
      }
      return local;
    }

    if (response.status === 403 || response.code === "forbidden") {
      await this.mark(state, "revoked");

      return failedCheck("revoked", "The license has been revoked or suspended.");
    }

    return this.verifyLocally(state);
  }

  async deactivate(): Promise<void> {
    const state = await this.store.get();
    if (!state?.licenseKey || !state.fingerprint) return;

    await this.transport.deactivate({
      licenseKey: state.licenseKey,
      fingerprint: state.fingerprint,
    });

    await this.save({
      product: this.product,
      status: "not_activated",
      fingerprint: state.fingerprint,
      publicKeys: state.publicKeys,
    });
  }

  async refreshKeys(): Promise<boolean> {
    const state = await this.ensureFingerprint();
    const response = await this.transport.keys();

    if (!response.ok) return false;

    const keyring: Record<string, string> = {};
    for (const entry of response.data.keys ?? []) {
      const kid = entry.kid;
      const pub = entry.public_key;
      if (typeof kid === "string" && typeof pub === "string" && pub) {
        keyring[kid] = pub;
      }
    }

    if (Object.keys(keyring).length === 0) return false;

    state.publicKeys = keyring;
    await this.save(state);

    return true;
  }

  private async ensureFingerprint(): Promise<StoredLicense> {
    const state = (await this.store.get()) ?? this.emptyState();

    if (!state.fingerprint) {
      state.fingerprint = await this.fingerprint();
    }

    state.product = this.product;
    await this.save(state);

    return state;
  }

  private emptyState(): StoredLicense {
    return { product: this.product, status: "not_activated" };
  }

  private async save(state: StoredLicense): Promise<void> {
    await this.store.put(state);
  }

  private hasLicenseKey(state: StoredLicense): boolean {
    return Boolean(state.licenseKey ?? this.licenseKey);
  }

  private verifyLocally(state: StoredLicense): LicenseCheck {
    const tokenValue = state.token;
    if (!tokenValue) {
      return failedCheck("not_activated", "This installation is not activated yet.");
    }

    let token: ParsedToken;
    try {
      token = parseToken(tokenValue);
    } catch {
      return failedCheck("invalid_token", "Stored token is malformed.");
    }

    if (token.payload.prd !== this.product) {
      return failedCheck("invalid", "Token product does not match this installation.");
    }

    if (token.payload.iss !== undefined && token.payload.iss !== this.issuer) {
      return failedCheck("invalid_token", "Token issuer does not match.");
    }

    const publicKey = token.kid ? state.publicKeys?.[token.kid] : undefined;
    if (!publicKey) {
      return failedCheck("invalid_token", "Unknown signing key (kid).");
    }

    try {
      if (!verifySignature(token, publicKey)) {
        return failedCheck("invalid_token", "Token signature is invalid.");
      }
    } catch {
      return failedCheck("invalid_token", "Token signature is invalid.");
    }

    const exp = token.payload.exp;
    if (typeof exp !== "number" || !Number.isFinite(exp)) {
      return failedCheck("invalid_token", "Token is missing an expiration claim.");
    }

    if (this.nowSecond() >= exp) {
      return failedCheck("expired", "The token has expired.");
    }

    const devf = token.payload.devf;
    if (typeof devf !== "string" || !digestsEqual(devf, hmacSha256(state.fingerprint ?? "", this.deviceHashSecret))) {
      return failedCheck("invalid_token", "Token is bound to a different device.");
    }

    return validCheck(token.payload as LicenseClaims, tokenValue);
  }

  /**
   * The network branch: validate online, fall back to activate for unknown
   * devices, then honour the offline grace window if the server is unreachable.
   */
  private async onlinePath(state: StoredLicense, requested: LicenseStatus): Promise<LicenseCheck> {
    if (!this.hasLicenseKey(state)) {
      return failedCheck(
        requested === "not_activated" ? "not_activated" : "grace_expired",
        requested === "not_activated"
          ? "No license key is configured for this installation."
          : "License expired and no license key is configured to revalidate.",
      );
    }

    state.licenseKey = state.licenseKey ?? this.licenseKey;
    await this.save(state);

    const response = await this.transport.validate({
      licenseKey: state.licenseKey as string,
      fingerprint: state.fingerprint ?? "",
    });

    if (response.transportError) {
      return this.offlineFallback(state);
    }
    if (response.ok) {
      return this.applyIssued(state, response);
    }
    if (response.status === 404 || response.code === "not_found") {
      return this.activate();
    }

    return this.mapFailure(state, response);
  }

  /**
   * Decide what to report when the server cannot be reached:
   *  - a cached token inside the grace window  -> `grace_period` (valid)
   *  - a cached token past its grace window    -> `grace_expired`
   *  - nothing cached at all                   -> `offline`
   */
  private offlineFallback(state: StoredLicense): LicenseCheck {
    if (state.token) {
      if (this.withinGracePeriod(state)) {
        return graceCheck((state.payload ?? {}) as LicenseClaims, state.token);
      }
      return failedCheck(
        "grace_expired",
        "License expired and the offline grace period has elapsed; revalidation requires a network connection.",
      );
    }
    return failedCheck("offline", "Cannot reach the license server; no cached license is available.");
  }

  private withinGracePeriod(state: StoredLicense): boolean {
    if (!(this.graceSeconds > 0)) return false;
    const anchor = state.lastValidatedAt ?? state.lastHeartbeatAt ?? state.activatedAt;
    if (!anchor) return false;

    return this.nowSecond() - anchor <= this.graceSeconds;
  }

  private revalidationDue(state: StoredLicense): boolean {
    if (!(this.revalidationIntervalSeconds > 0)) return false;
    const anchor = state.lastValidatedAt ?? state.lastHeartbeatAt ?? state.activatedAt;
    if (!anchor) return false;

    return this.nowSecond() - anchor >= this.revalidationIntervalSeconds;
  }

  /**
   * Refresh a locally-valid license against the server to catch revocations.
   * Stays valid (offline-tolerant) if the server is unreachable.
   */
  private async revalidate(state: StoredLicense, current: LicenseCheck): Promise<LicenseCheck> {
    if (!this.hasLicenseKey(state)) return current;

    const response = await this.transport.validate({
      licenseKey: (state.licenseKey ?? this.licenseKey) as string,
      fingerprint: state.fingerprint ?? "",
    });

    if (response.transportError) {
      return current;
    }
    if (response.ok) {
      state.lastValidatedAt = this.nowSecond();
      await this.save(state);
      return this.verifyLocally(state);
    }
    if (response.status === 403 || response.code === "forbidden") {
      await this.mark(state, "revoked");
      return failedCheck("revoked", "The license has been revoked or suspended.");
    }

    return current;
  }

  private async applyIssued(state: StoredLicense, response: ServerResponse): Promise<LicenseCheck> {
    const tokenValue = response.data.token;
    if (typeof tokenValue !== "string" || tokenValue === "") {
      return failedCheck("error", "Server returned a success without a token.");
    }

    state.licenseKey = state.licenseKey ?? this.licenseKey;
    state.token = tokenValue;

    try {
      const token = parseToken(tokenValue);
      state.payload = token.payload;
      state.tokenExpiresAt = typeof token.payload.exp === "number" ? token.payload.exp : undefined;
    } catch {
      // stored and re-verified below; a bad token will be rejected there
    }

    state.status = "valid";
    state.activatedAt ??= this.nowSecond();
    state.lastValidatedAt = this.nowSecond();
    await this.save(state);

    await this.refreshKeys();

    // File-backed stores re-read from disk, so the mutated in-memory copy may
    // be stale. Re-read the persisted state before the final local verify so
    // the freshly fetched public keys are actually present.
    const final = (await this.store.get()) ?? state;

    return this.verifyLocally(final);
  }

  private async mapFailure(state: StoredLicense, response: ServerResponse): Promise<LicenseCheck> {
    if (response.status === 403 || response.code === "forbidden") {
      await this.mark(state, "revoked");

      return failedCheck("revoked", "The license has been revoked or suspended.");
    }
    if (response.status === 429) {
      return failedCheck("activation_failed", "The license seat limit has been reached.");
    }

    return failedCheck("activation_failed", response.message ?? "The license server rejected the request.");
  }

  private async mark(state: StoredLicense, status: LicenseStatus): Promise<void> {
    state.status = status;
    await this.save(state);
  }
}
