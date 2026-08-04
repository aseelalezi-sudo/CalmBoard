import { createLicensing, EncryptedFileLicenseStore, describeLicense } from "../dist/index.js";
import { rm } from "node:fs/promises";

const SERVER = "http://127.0.0.1:9000/api/v1";
const KEY = "LHB-GYBF-3TUR-DT2C-CYUE";
const SECRET = "0d56c87e3bbc1113b2ef3a8efc105ac2348d64bce3091a882b31dececff22bf6";
const STORE_SECRET = "live-test-secret-0123456789abcdef";
const STORE_FILE = "C:/Users/User/AppData/Local/Temp/opencode/live-license.enc";

await rm(STORE_FILE, { force: true });

const licensing = createLicensing({
  enabled: true,
  serverUrl: SERVER,
  product: "calmboard",
  licenseKey: KEY,
  issuer: "licensehub",
  deviceHashSecret: SECRET,
  graceSeconds: 7 * 24 * 3600,
  revalidationIntervalSeconds: 300,
  store: new EncryptedFileLicenseStore(STORE_FILE, STORE_SECRET),
});

console.log("=== boot (fresh, expect activation) ===");
const boot = await licensing.boot();
console.log("status:", boot.status, "| valid:", boot.valid, "| grace:", boot.grace);
console.log("reason:", boot.reason);
if (boot.valid) {
  console.log("type:", describeLicense(boot.claims).label);
  console.log("features:", boot.claims.fea);
  console.log("payload keys:", JSON.stringify(Object.keys(boot.claims)));
}

console.log("\n=== boot again (offline path, expect valid from cache) ===");
const boot2 = await licensing.boot();
console.log("status:", boot2.status, "| valid:", boot2.valid);

console.log("\n=== heartbeat (expect valid) ===");
const hb = await licensing.heartbeat();
console.log("status:", hb.status, "| valid:", hb.valid);

console.log("\n=== state stored (encrypted file) ===");
const state = await licensing.state();
console.log(
  "status:",
  state?.status,
  "| hasToken:",
  Boolean(state?.token),
  "| fingerprint:",
  state?.fingerprint?.slice(0, 16) + "...",
);
console.log("publicKeys kids:", Object.keys(state?.publicKeys ?? {}).length);

console.log("\nDONE");
