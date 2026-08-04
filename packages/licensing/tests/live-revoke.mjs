import { createLicensing, EncryptedFileLicenseStore } from "../dist/index.js";

const STORE_SECRET = "live-test-secret-0123456789abcdef";
const STORE_FILE = "C:/Users/User/AppData/Local/Temp/opencode/live-license.enc";

const licensing = createLicensing({
  enabled: true,
  serverUrl: "http://127.0.0.1:8080/api/v1",
  product: "calmboard",
  licenseKey: "LHB-GYBF-3TUR-DT2C-CYUE",
  issuer: "licensehub",
  deviceHashSecret: "0d56c87e3bbc1113b2ef3a8efc105ac2348d64bce3091a882b31dececff22bf6",
  store: new EncryptedFileLicenseStore(STORE_FILE, STORE_SECRET),
});

const before = await licensing.boot();
console.log("before (cached):", before.status);

const after = await licensing.validate();
console.log("after forced validate:", after.status, "| valid:", after.valid);

const state = await licensing.state();
console.log("persisted status:", state?.status);
