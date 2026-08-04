import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";
import {
  sha256Payload,
  verifyCalmBoardWebhookSignature,
  verifyGitHubWebhookSignature,
  verifySlackWebhookSignature,
  verifyStripeWebhookSignature,
} from "./webhook-verification.js";

const payload = JSON.stringify({ action: "opened", id: 42 });
const nowMs = 1_800_000_000_000;
const timestamp = String(Math.floor(nowMs / 1_000));

function hmac(secret: string, value: string) {
  return createHmac("sha256", secret).update(value, "utf8").digest("hex");
}

describe("webhook signature verification", () => {
  it("validates GitHub's sha256-prefixed raw-body signature", () => {
    const secret = "github-test-secret";
    const signature = `sha256=${hmac(secret, payload)}`;
    assert.equal(verifyGitHubWebhookSignature(payload, signature, secret), true);
    assert.equal(verifyGitHubWebhookSignature(`${payload} `, signature, secret), false);
    assert.equal(verifyGitHubWebhookSignature(payload, "sha1=legacy", secret), false);
  });

  it("validates Slack's v0 base string and rejects stale timestamps", () => {
    const secret = "slack-test-secret";
    const signature = `v0=${hmac(secret, `v0:${timestamp}:${payload}`)}`;
    assert.equal(verifySlackWebhookSignature(payload, signature, timestamp, secret, nowMs), true);
    assert.equal(verifySlackWebhookSignature(payload, signature, timestamp, secret, nowMs + 301_000), false);
    assert.equal(verifySlackWebhookSignature(payload, `${signature}00`, timestamp, secret, nowMs), false);
  });

  it("validates the CalmBoard v1 timestamped contract and rejects future replay", () => {
    const secret = "custom-test-secret";
    const signature = `v1=${hmac(secret, `${timestamp}.${payload}`)}`;
    assert.equal(verifyCalmBoardWebhookSignature(payload, signature, timestamp, secret, nowMs), true);
    assert.equal(verifyCalmBoardWebhookSignature(payload, signature, timestamp, secret, nowMs - 301_000), false);
    assert.equal(verifyCalmBoardWebhookSignature(payload, "v1=not-hex", timestamp, secret, nowMs), false);
  });

  it("accepts any matching Stripe v1 signature during secret rotation", () => {
    const secret = "whsec_test";
    const valid = hmac(secret, `${timestamp}.${payload}`);
    const header = `t=${timestamp},v1=${"0".repeat(64)},v1=${valid}`;
    assert.equal(verifyStripeWebhookSignature(payload, header, secret, nowMs), true);
    assert.equal(verifyStripeWebhookSignature(payload, header, "wrong", nowMs), false);
    assert.equal(verifyStripeWebhookSignature(payload, header, secret, nowMs + 301_000), false);
  });

  it("hashes the exact raw payload without normalization", () => {
    assert.equal(sha256Payload(payload), sha256Payload(Buffer.from(payload, "utf8")));
    assert.notEqual(sha256Payload(payload), sha256Payload(`${payload}\n`));
  });
});
