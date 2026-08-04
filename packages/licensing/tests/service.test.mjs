import { test } from "node:test";
import assert from "node:assert/strict";

import { LicenseService, MemoryLicenseStore } from "../dist/index.js";
import { makeKeypair, licenseToken } from "./test-util.mjs";

const PRODUCT = "calmboard";
const SECRET = "test-device-secret";
const KID = "kid-test";

class FakeTransport {
  validateMode = "not_found"; // 'not_found' | 'ok'
  heartbeatCode = null; // null | 'forbidden'

  constructor(keypair) {
    this.keypair = keypair;
  }

  keys() {
    return ok({
      keys: [{ kid: KID, alg: "EdDSA", public_key: this.keypair.publicKeyB64, status: "active" }],
    });
  }

  validate({ licenseKey, fingerprint }) {
    if (this.validateMode === "not_found") return failure(404, "not_found");
    return this.issue(fingerprint);
  }

  activate({ licenseKey, fingerprint }) {
    return this.issue(fingerprint);
  }

  heartbeat({ licenseKey, fingerprint }) {
    if (this.heartbeatCode === "forbidden") return failure(403, "forbidden", "License revoked.");
    return ok({ valid: true, license: { status: "active" }, device: { status: "active" } });
  }

  deactivate() {
    return ok({ deactivated: true });
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

function failure(status, code, message) {
  return { ok: false, status, data: {}, code, message, transportError: false };
}

function makeService(store, transport) {
  return new LicenseService({
    enabled: true,
    serverUrl: "http://licensehub.test",
    product: PRODUCT,
    licenseKey: "LHB-TEST-KEY",
    issuer: "licensehub",
    deviceHashSecret: SECRET,
    store,
    transport,
  });
}

test("offline boot with a valid cached token requires no network", async () => {
  const keypair = makeKeypair();
  const fingerprint = "stable-install-id";
  const token = licenseToken(keypair, {
    secret: SECRET,
    fingerprint,
    product: PRODUCT,
    exp: Math.floor(Date.now() / 1000) + 3600,
  });

  const store = new MemoryLicenseStore({
    product: PRODUCT,
    status: "valid",
    licenseKey: "LHB-TEST-KEY",
    fingerprint,
    token,
    publicKeys: { [KID]: keypair.publicKeyB64 },
  });

  const service = makeService(store, new FakeTransport(keypair));
  const check = await service.boot();

  assert.equal(check.valid, true);
  assert.deepEqual(check.claims.fea, ["advanced-reports", "realtime-collab"]);
  assert.equal(check.claims.typ, "perpetual");
});

test("fresh installation activates online and persists state", async () => {
  const keypair = makeKeypair();
  const store = new MemoryLicenseStore();
  const transport = new FakeTransport(keypair);

  const service = makeService(store, transport);
  const check = await service.boot();

  assert.equal(check.valid, true);
  assert.ok(check.claims.fea.includes("realtime-collab"));

  const state = await store.get();
  assert.equal(state.status, "valid");
  assert.ok(state.token);
  assert.equal(state.fingerprint.length > 0, true);
});

test("no license key returns not_activated without network", async () => {
  const keypair = makeKeypair();
  const service = new LicenseService({
    enabled: true,
    serverUrl: "http://licensehub.test",
    product: PRODUCT,
    issuer: "licensehub",
    deviceHashSecret: SECRET,
    store: new MemoryLicenseStore(),
    transport: new FakeTransport(keypair),
  });

  const check = await service.boot();
  assert.equal(check.status, "not_activated");
});

test("expired cached token is refreshed online when the server replies", async () => {
  const keypair = makeKeypair();
  const fingerprint = "fp-refresh";
  const token = licenseToken(keypair, {
    secret: SECRET,
    fingerprint,
    product: PRODUCT,
    exp: Math.floor(Date.now() / 1000) - 10,
  });

  const store = new MemoryLicenseStore({
    product: PRODUCT,
    status: "valid",
    licenseKey: "LHB-TEST-KEY",
    fingerprint,
    token,
    publicKeys: { [KID]: keypair.publicKeyB64 },
  });

  const transport = new FakeTransport(keypair);
  transport.validateMode = "ok";

  const check = await makeService(store, transport).boot();
  assert.equal(check.valid, true);
});

test("revoked license is detected by heartbeat", async () => {
  const keypair = makeKeypair();
  const fingerprint = "fp-revoked";
  const token = licenseToken(keypair, {
    secret: SECRET,
    fingerprint,
    product: PRODUCT,
    exp: Math.floor(Date.now() / 1000) + 3600,
  });

  const store = new MemoryLicenseStore({
    product: PRODUCT,
    status: "valid",
    licenseKey: "LHB-TEST-KEY",
    fingerprint,
    token,
    publicKeys: { [KID]: keypair.publicKeyB64 },
  });

  const transport = new FakeTransport(keypair);
  transport.heartbeatCode = "forbidden";

  const check = await makeService(store, transport).heartbeat();
  assert.equal(check.status, "revoked");
  assert.equal((await store.get()).status, "revoked");
});

test("cached token bound to another device is never trusted", async () => {
  const keypair = makeKeypair();
  const token = licenseToken(keypair, {
    secret: SECRET,
    fingerprint: "another-device",
    product: PRODUCT,
    exp: Math.floor(Date.now() / 1000) + 3600,
  });

  const store = new MemoryLicenseStore({
    product: PRODUCT,
    status: "valid",
    licenseKey: "LHB-TEST-KEY",
    fingerprint: "this-installation",
    token,
    publicKeys: { [KID]: keypair.publicKeyB64 },
  });

  const service = new LicenseService({
    enabled: true,
    serverUrl: "http://127.0.0.1:9", // unreachable — the fake transport below is not wired
    product: PRODUCT,
    licenseKey: "LHB-TEST-KEY",
    issuer: "licensehub",
    deviceHashSecret: SECRET,
    store,
  });

  const check = await service.boot();
  assert.equal(check.valid, false);
  assert.notEqual(check.status, "valid");
});

test("deactivate frees the seat and clears local token", async () => {
  const keypair = makeKeypair();
  const fingerprint = "fp-deactivate";
  const store = new MemoryLicenseStore({
    product: PRODUCT,
    status: "valid",
    licenseKey: "LHB-TEST-KEY",
    fingerprint,
    token: licenseToken(keypair, { secret: SECRET, fingerprint, product: PRODUCT, exp: 1e12 }),
    publicKeys: { [KID]: keypair.publicKeyB64 },
  });

  const service = makeService(store, new FakeTransport(keypair));
  await service.deactivate();

  const state = await store.get();
  assert.equal(state.status, "not_activated");
  assert.equal(state.token, undefined);
});

test("feature flags are readable from a valid check", async () => {
  const keypair = makeKeypair();
  const token = licenseToken(keypair, {
    secret: SECRET,
    fingerprint: "fp",
    product: PRODUCT,
    exp: Math.floor(Date.now() / 1000) + 3600,
  });

  const service = makeService(
    new MemoryLicenseStore({
      product: PRODUCT,
      status: "valid",
      licenseKey: "LHB-TEST-KEY",
      fingerprint: "fp",
      token,
      publicKeys: { [KID]: keypair.publicKeyB64 },
    }),
    new FakeTransport(keypair),
  );

  const check = await service.boot();
  assert.ok(check.valid);
  assert.ok(Array.isArray(check.claims.fea) && check.claims.fea.includes("advanced-reports"));
});

test("activateKey persists a runtime-supplied key and activates", async () => {
  const keypair = makeKeypair();
  const store = new MemoryLicenseStore();
  const service = makeService(store, new FakeTransport(keypair));

  const check = await service.activateKey("LHB-RUNTIME-KEY");
  assert.equal(check.valid, true);

  const state = await store.get();
  assert.equal(state.licenseKey, "LHB-RUNTIME-KEY");
  assert.equal(state.status, "valid");
});
