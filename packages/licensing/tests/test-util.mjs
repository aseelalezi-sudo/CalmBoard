import { generateKeyPairSync, sign as nodeSign } from "node:crypto";
import { hmacSha256 } from "../dist/crypto.js";

export function makeKeypair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const jwk = publicKey.export({ format: "jwk" });
  const raw = Buffer.from(jwk.x, "base64url");

  return { privateKey, publicKeyB64: raw.toString("base64") };
}

export function b64url(buffer) {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Build an EdDSA JWT exactly like LicenseHub (alg=EdDSA, kid header).
 */
export function signToken(keypair, claims, kid) {
  const header = { typ: "JWT", alg: "EdDSA", kid };
  const signingInput =
    `${b64url(Buffer.from(JSON.stringify(header)))}.` + `${b64url(Buffer.from(JSON.stringify(claims)))}`;
  const signature = nodeSign(null, Buffer.from(signingInput, "utf8"), keypair.privateKey);

  return `${signingInput}.${b64url(signature)}`;
}

export function licenseToken(keypair, { secret, fingerprint, product, exp }, extra = {}, kid = "kid-test") {
  return signTokenInternal(
    keypair,
    {
      sub: "lic-test-uuid",
      prd: product ?? "calmboard",
      devf: hmacSha256(fingerprint, secret),
      typ: "perpetual",
      fea: ["advanced-reports", "realtime-collab"],
      mxs: 100,
      issuer: "licensehub",
      iat: Math.floor(Date.now() / 1000),
      nbf: Math.floor(Date.now() / 1000),
      exp,
      jti: "test-jti",
      ...extra,
    },
    kid,
  );
}

function signTokenInternal(keypair, claims, kid) {
  const header = { typ: "JWT", alg: "EdDSA", kid };
  const signingInput =
    `${b64url(Buffer.from(JSON.stringify(header)))}.` + `${b64url(Buffer.from(JSON.stringify(claims)))}`;
  const signature = nodeSign(null, Buffer.from(signingInput, "utf8"), keypair.privateKey);

  return `${signingInput}.${b64url(signature)}`;
}
