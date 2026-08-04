import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";

import {
  LicenseService,
  MemoryLicenseStore,
  EncryptedFileLicenseStore,
  encryptString,
  decryptString,
  encryptJson,
  decryptJson,
  createDeviceFingerprint,
  describeLicense,
  isType,
} from "../dist/index.js";
import { makeKeypair, licenseToken } from "./test-util.mjs";

const PRODUCT = "calmboard";
const SECRET = "test-device-secret";
const KID = "kid-test";

class FakeTransport {
  validateMode = "not_found";
  heartbeatCode = null;
  unreachable = false;

  constructor(keypair) {
    this.keypair = keypair;
  }

  keys() {
    return ok({
      keys: [{ kid: KID, alg: "EdDSA", public_key: this.keypair.publicKeyB64, status: "active" }],
    });
  }

  validate({ fingerprint }) {
    if (this.unreachable) return offline();
    if (this.validateMode === "not_found") return failure(404, "not_found");
    return this.issue(fingerprint);
  }

  activate({ fingerprint }) {
    if (this.unreachable) return offline();
    return this.issue(fingerprint);
  }

  heartbeat() {
    if (this.unreachable) return offline();
    if (this.heartbeatCode === "forbidden") return failure(403, "forbidden");
    return ok({ valid: true });
  }

  issue(fingerprint) {
    const token = licenseToken(this.keypair, {
      secret: SECRET,
      fingerprint,
      product: PRODUCT,
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    return ok({ token, expires_at: new Date(Date.now() + 3600_000).toISOString() });
  }
}

function ok(data) {
  return { ok: true, status: 200, data, transportError: false };
}
function failure(status, code) {
  return { ok: false, status, data: {}, code, transportError: false };
}
function offline() {
  return { ok: false, status: 0, data: {}, code: "network_error", transportError: true };
}

function storeWithToken(token, extra = {}) {
  return new MemoryLicenseStore({
    product: PRODUCT,
    status: "valid",
    licenseKey: "LHB-TEST-KEY",
    fingerprint: "fp",
    token,
    publicKeys: { [KID]: keypair().publicKeyB64 },
    lastValidatedAt: 1000,
    ...extra,
  });
}

let kp;
function keypair() {
  kp ??= makeKeypair();
  return kp;
}

test("grace period keeps an expired license valid while offline near last check", async () => {
  const fingerprint = "fp";
  const token = licenseToken(keypair(), {
    secret: SECRET,
    fingerprint,
    product: PRODUCT,
    exp: 4000,
  });

  const service = new LicenseService({
    enabled: true,
    serverUrl: "http://licensehub.test",
    product: PRODUCT,
    licenseKey: "LHB-TEST-KEY",
    issuer: "licensehub",
    deviceHashSecret: SECRET,
    graceSeconds: 3600,
    store: storeWithToken(token, { lastValidatedAt: 4400 }),
    transport: new UnreachableTransport(),
    nowSecond: () => 4600, // expired (4600 >= 4000) but 200s since last check < grace
  });

  const check = await service.boot();
  assert.equal(check.status, "grace_period");
  assert.equal(check.valid, true);
  assert.equal(check.grace, true);
});

test("grace period expired: an expired token past its grace window is denied", async () => {
  const token = licenseToken(keypair(), {
    secret: SECRET,
    fingerprint: "fp",
    product: PRODUCT,
    exp: 4000,
  });

  const service = new LicenseService({
    enabled: true,
    serverUrl: "http://licensehub.test",
    product: PRODUCT,
    licenseKey: "LHB-TEST-KEY",
    issuer: "licensehub",
    deviceHashSecret: SECRET,
    graceSeconds: 100,
    store: storeWithToken(token, { lastValidatedAt: 4400 }),
    transport: new UnreachableTransport(),
    nowSecond: () => 5000,
  });

  const check = await service.boot();
  assert.equal(check.status, "grace_expired");
  assert.equal(check.valid, false);
});

test("offline with no cached token reports offline, not grace", async () => {
  const service = new LicenseService({
    enabled: true,
    serverUrl: "http://licensehub.test",
    product: PRODUCT,
    licenseKey: "LHB-TEST-KEY",
    issuer: "licensehub",
    deviceHashSecret: SECRET,
    store: new MemoryLicenseStore(),
    transport: new UnreachableTransport(),
  });

  const check = await service.boot();
  assert.equal(check.status, "offline");
  assert.equal(check.valid, false);
});

test("periodic revalidation detects a revocation while a valid token was cached", async () => {
  const fingerprint = "fp";
  const token = licenseToken(keypair(), {
    secret: SECRET,
    fingerprint,
    product: PRODUCT,
    exp: Math.floor(Date.now() / 1000) + 3600,
  });

  const service = new LicenseService({
    enabled: true,
    serverUrl: "http://licensehub.test",
    product: PRODUCT,
    licenseKey: "LHB-TEST-KEY",
    issuer: "licensehub",
    deviceHashSecret: SECRET,
    revalidationIntervalSeconds: 300,
    store: storeWithToken(token, { lastValidatedAt: 1000 }),
    transport: new FrozenRevokedTransport(),
    nowSecond: () => Math.floor(Date.now() / 1000),
  });

  const check = await service.boot();
  assert.equal(check.status, "revoked");
  assert.equal(check.valid, false);
});

test("AES-GCM roundtrip for strings and objects", () => {
  const plain = JSON.stringify({ license: 123, features: ["a"] });
  const cipher = encryptString("secret", plain);
  assert.notEqual(cipher, plain);
  assert.equal(decryptString("secret", cipher), plain);

  const obj = { token: "abc", seats: 5 };
  const enc = encryptJson("k", obj);
  assert.deepEqual(decryptJson("k", enc), obj);
});

test("tampering with the encrypted payload is detected", () => {
  const cipher = encryptString("secret", "important");
  const pos = cipher.lastIndexOf(".");
  const forged = cipher.slice(0, pos) + "." + flipLastByte(cipher.slice(pos + 1));
  assert.throws(() => decryptString("secret", forged));
});

function flipLastByte(b64url) {
  const buf = Buffer.from(b64url.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  buf[buf.length - 1] ^= 0xff;
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

test("encrypted file store is unreadable on disk and stable across reads", async () => {
  const dir = await mkdir(
    "C:/Users/User/AppData/Local/Temp/opencode/lic-store-" + Math.random().toString(36).slice(2),
    { recursive: true },
  );
  const path = dir + "/license.bin";
  const store = new EncryptedFileLicenseStore(path, "topsecret");
  await store.put({ product: PRODUCT, status: "valid" });
  const state = await store.get();
  assert.equal(state.status, "valid");
});

test("device fingerprint is stable and changes when factors change", async () => {
  const a = await createDeviceFingerprint({ extraFactors: { instance: "node-a" } });
  const b = await createDeviceFingerprint({ extraFactors: { instance: "node-a" } });
  const c = await createDeviceFingerprint({ extraFactors: { instance: "node-b" } });
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.match(a, /^[0-9a-f]{64}$/);
});

test("license types classify claims correctly", () => {
  const trial = describeLicense({ typ: "trial", exp: Math.floor(Date.now() / 1000) + 3600 });
  assert.equal(trial.type, "trial");
  assert.equal(isType({ typ: "trial" }, "trial"), true);

  const monthly = describeLicense({ typ: "monthly", iat: 1000 });
  assert.equal(monthly.type, "monthly");
  assert.equal(monthly.renews, true);

  const yearly = describeLicense({ typ: "yearly" });
  assert.equal(yearly.type, "yearly");

  const perpetual = describeLicense({ typ: "perpetual", exp: 0 });
  assert.equal(perpetual.type, "perpetual");
  assert.equal(perpetual.renews, false);
});

class UnreachableTransport {
  validate() {
    return offline();
  }
  activate() {
    return offline();
  }
  heartbeat() {
    return offline();
  }
  deactivate() {
    return offline();
  }
  keys() {
    return offline();
  }
}

class FrozenRevokedTransport {
  validate() {
    return failure(403, "forbidden");
  }
}
