import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const DEFAULT_TOLERANCE_SECONDS = 300;

function constantTimeHexEqual(expected: string, received: string) {
  if (!/^[a-f0-9]{64}$/i.test(received)) return false;
  const expectedBytes = Buffer.from(expected.toLowerCase(), "hex");
  const receivedBytes = Buffer.from(received.toLowerCase(), "hex");
  return expectedBytes.length === receivedBytes.length && timingSafeEqual(expectedBytes, receivedBytes);
}

function timestampIsFresh(timestampText: string, nowMs: number, toleranceSeconds: number) {
  if (!/^\d{10}$/.test(timestampText)) return false;
  const timestamp = Number(timestampText);
  return Number.isSafeInteger(timestamp) && Math.abs(Math.floor(nowMs / 1_000) - timestamp) <= toleranceSeconds;
}

export function sha256Payload(payload: string | Buffer) {
  return createHash("sha256").update(payload).digest("hex");
}

export function verifyGitHubWebhookSignature(payload: string, signature: string, secret: string) {
  if (!secret || !signature.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(payload, "utf8").digest("hex");
  return constantTimeHexEqual(expected, signature.slice("sha256=".length));
}

export function verifySlackWebhookSignature(
  payload: string,
  signature: string,
  timestamp: string,
  secret: string,
  nowMs = Date.now(),
  toleranceSeconds = DEFAULT_TOLERANCE_SECONDS,
) {
  if (!secret || !signature.startsWith("v0=") || !timestampIsFresh(timestamp, nowMs, toleranceSeconds)) {
    return false;
  }
  const expected = createHmac("sha256", secret).update(`v0:${timestamp}:${payload}`, "utf8").digest("hex");
  return constantTimeHexEqual(expected, signature.slice("v0=".length));
}

export function verifyCalmBoardWebhookSignature(
  payload: string,
  signature: string,
  timestamp: string,
  secret: string,
  nowMs = Date.now(),
  toleranceSeconds = DEFAULT_TOLERANCE_SECONDS,
) {
  if (!secret || !signature.startsWith("v1=") || !timestampIsFresh(timestamp, nowMs, toleranceSeconds)) {
    return false;
  }
  const expected = createHmac("sha256", secret).update(`${timestamp}.${payload}`, "utf8").digest("hex");
  return constantTimeHexEqual(expected, signature.slice("v1=".length));
}

export function verifyStripeWebhookSignature(
  payload: string,
  signatureHeader: string,
  secret: string,
  nowMs = Date.now(),
  toleranceSeconds = DEFAULT_TOLERANCE_SECONDS,
) {
  if (!signatureHeader || !secret) return false;
  const parts = signatureHeader.split(",").map((part) => part.trim().split("=", 2));
  const timestamp = parts.find(([key]) => key === "t")?.[1] ?? "";
  const signatures = parts.filter(([key]) => key === "v1").map(([, value]) => value ?? "");
  if (!timestampIsFresh(timestamp, nowMs, toleranceSeconds) || !signatures.length) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${payload}`, "utf8").digest("hex");
  return signatures.some((signature) => constantTimeHexEqual(expected, signature));
}
