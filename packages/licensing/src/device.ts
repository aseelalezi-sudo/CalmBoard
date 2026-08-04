import { createHash, randomUUID } from "node:crypto";
import { hostname as osHostname, networkInterfaces, arch, platform } from "node:os";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export type DeviceFingerprintOptions = {
  /**
   * Optional path to persist a random machine-specific salt. When set, the
   * fingerprint is stable across restarts even if the host report changes.
   */
  saltPath?: string;
  /** Extra stable factors to fold into the fingerprint (e.g. a container ID). */
  extraFactors?: Record<string, string>;
};

async function readFirstMac(): Promise<string | null> {
  const ifaces = networkInterfaces();
  for (const list of Object.values(ifaces)) {
    for (const entry of list ?? []) {
      if (!entry.internal && entry.mac && entry.mac !== "00:00:00:00:00:00") {
        return entry.mac;
      }
    }
  }
  return null;
}

async function readMachineId(): Promise<string | null> {
  if (platform() !== "linux") return null;
  try {
    const value = (await readFile("/etc/machine-id", "utf8")).trim();
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

async function loadOrCreateSalt(saltPath?: string): Promise<string> {
  if (!saltPath) return "";
  try {
    const existing = (await readFile(saltPath, "utf8")).trim();
    if (existing) return existing;
  } catch {
    // fall through and create a new salt
  }
  const salt = randomUUID();
  await mkdir(dirname(saltPath), { recursive: true });
  await writeFile(saltPath, salt, "utf8");
  return salt;
}

/**
 * Build a stable hardware/installation fingerprint (a hex SHA-256 digest).
 *
 * Factors: OS hostname, platform, architecture, primary MAC address, Linux
 * machine-id (when available) and an optional persisted random salt. Folding a
 * persisted salt keeps the fingerprint stable even when the host is a
 * container whose hostname changes between restarts.
 *
 * The fingerprint is what the SDK sends as the device `fingerprint`; LicenseHub
 * binds each activated seat to it (via `devf = HMAC(fingerprint, secret)`).
 */
export async function createDeviceFingerprint(options: DeviceFingerprintOptions = {}): Promise<string> {
  const [mac, machineId, salt] = await Promise.all([
    readFirstMac(),
    readMachineId(),
    loadOrCreateSalt(options.saltPath),
  ]);

  const factors: Record<string, string> = {
    hostname: osHostname(),
    platform: platform(),
    arch: arch(),
    ...(mac ? { mac } : {}),
    ...(machineId ? { machine_id: machineId } : {}),
    ...(salt ? { salt } : {}),
    ...options.extraFactors,
  };

  const canonical = Object.keys(factors)
    .sort()
    .map((key) => `${key}=${factors[key]}`)
    .join("\n");

  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
