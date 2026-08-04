import { createLicensing, EncryptedFileLicenseStore } from "../dist/index.js";
import { rm } from "node:fs/promises";

const STORE_SECRET = "live-test-secret-0123456789abcdef";
const STORE_FILE = "C:/Users/User/AppData/Local/Temp/opencode/live-lifecycle.enc";

await rm(STORE_FILE, { force: true });

const make = () =>
  createLicensing({
    enabled: true,
    serverUrl: "http://127.0.0.1:8080/api/v1",
    product: "calmboard",
    licenseKey: "LHB-GYBF-3TUR-DT2C-CYUE",
    issuer: "licensehub",
    deviceHashSecret: "0d56c87e3bbc1113b2ef3a8efc105ac2348d64bce3091a882b31dececff22bf6",
    store: new EncryptedFileLicenseStore(STORE_FILE, STORE_SECRET),
  });

let licensing = make();
console.log("boot (activate):", (await licensing.boot()).status);
console.log("boot (cached):", (await licensing.boot()).status);

await licensing.deactivate();
console.log("after deactivate -> state:", (await licensing.state())?.status);

licensing = make();
console.log("boot again (re-activate):", (await licensing.boot()).status);
console.log("final:", (await licensing.state())?.status);

const seats = await (await fetch("http://127.0.0.1:8080/api/v1/keys")).status;
console.log("server reachable:", seats === 200);
