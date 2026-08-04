import { test } from "node:test";
import assert from "node:assert/strict";

import {
  base64UrlEncode,
  base64UrlDecode,
  parseToken,
  verifySignature,
  hmacSha256,
  digestsEqual,
} from "../dist/crypto.js";
import { makeKeypair, signToken, b64url } from "./test-util.mjs";

test("base64url round trips without padding", () => {
  const raw = Buffer.from("hello world ünïcode 🌍");
  const encoded = base64UrlEncode(raw);
  assert.ok(!encoded.includes("="));
  assert.ok(/^[A-Za-z0-9_-]+$/.test(encoded));
  assert.deepEqual(base64UrlDecode(encoded), raw);
});

test("parseToken extracts header, payload and kid", () => {
  const keypair = makeKeypair();
  const token = signToken(
    keypair,
    { sub: "lic-1", prd: "calmboard", exp: Math.floor(Date.now() / 1000) + 3600 },
    "kid-1",
  );
  const parsed = parseToken(token);
  assert.equal(parsed.kid, "kid-1");
  assert.equal(parsed.payload.prd, "calmboard");
  assert.ok(parsed.signature.length > 0);
  assert.equal(parsed.signatureInput.split(".").length, 2);
});

test("parseToken rejects malformed tokens", () => {
  assert.throws(() => parseToken("only.two.segments.x"), TypeError);
  assert.throws(() => parseToken("@@.@@.@@"), TypeError);
});

test("verifySignature accepts a valid token", () => {
  const keypair = makeKeypair();
  const token = signToken(keypair, { sub: "lic-1" }, "kid-1");
  assert.equal(verifySignature(parseToken(token), keypair.publicKeyB64), true);
});

test("verifySignature rejects a tampered payload", () => {
  const keypair = makeKeypair();
  const good = signToken(keypair, { sub: "lic-1", fee: false }, "kid-1").split(".");
  const payload = JSON.parse(Buffer.from(good[1], "base64url").toString("utf8"));
  payload.fee = true;
  good[1] = b64url(Buffer.from(JSON.stringify(payload)));
  const tampered = good.join(".");
  assert.equal(verifySignature(parseToken(tampered), keypair.publicKeyB64), false);
});

test("verifySignature rejects a token signed by another key", () => {
  const keypairA = makeKeypair();
  const keypairB = makeKeypair();
  const token = signToken(keypairA, { sub: "lic-1" }, "kid-1");
  assert.equal(verifySignature(parseToken(token), keypairB.publicKeyB64), false);
});

test("verifySignature rejects non-EdDSA algorithm", () => {
  const keypair = makeKeypair();
  const header = b64url(Buffer.from(JSON.stringify({ typ: "JWT", alg: "HS256" })));
  const payload = b64url(Buffer.from(JSON.stringify({ sub: "x" })));
  const token = `${header}.${payload}.${b64url(Buffer.from("deadbeef", "hex"))}`;
  assert.throws(() => verifySignature(parseToken(token), keypair.publicKeyB64), /Unsupported/);
});

test("hmacSha256 is deterministic and hex", () => {
  const one = hmacSha256("fingerprint", "secret");
  assert.match(one, /^[0-9a-f]{64}$/);
  assert.equal(one, hmacSha256("fingerprint", "secret"));
  assert.notEqual(one, hmacSha256("fingerprint", "other"));
});

test("digestsEqual is constant-time and length-aware", () => {
  assert.equal(digestsEqual("abc", "abc"), true);
  assert.equal(digestsEqual("abc", "abd"), false);
  assert.equal(digestsEqual("abcdef", "abc"), false);
});
