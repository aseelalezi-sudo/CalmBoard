export {
  LicenseService,
  type LicensingOptions,
  type ServerResponse,
  LicenseClient,
  type LicenseTransport,
  MemoryLicenseStore,
  FileLicenseStore,
  EncryptedFileLicenseStore,
  type LicenseStore,
  type StoredLicense,
} from "./service.js";

export {
  validCheck,
  failedCheck,
  graceCheck,
  type LicenseCheck,
  type LicenseClaims,
  type LicenseStatus,
} from "./status.js";

export { describeLicense, isType, type LicenseType, type LicenseDescription } from "./license-type.js";

export {
  base64UrlEncode,
  base64UrlDecode,
  parseToken,
  verifySignature,
  publicKeyFromRaw,
  hmacSha256,
  digestsEqual,
  deriveEncryptionKey,
  encryptString,
  decryptString,
  encryptJson,
  decryptJson,
  type ParsedToken,
} from "./crypto.js";

export { createDeviceFingerprint, type DeviceFingerprintOptions } from "./device.js";

import { LicenseService, type LicensingOptions } from "./service.js";

/**
 * Convenience factory: build a configured {@link LicenseService} from env-like
 * options. Values fall back to typical CALMBOARD_LICENSE_* environment vars.
 */
export function createLicensing(options: LicensingOptions): LicenseService {
  return new LicenseService(options);
}
