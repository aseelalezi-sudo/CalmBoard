import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { CreateBucketCommand, HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { createObjectStorageAdapter } from "../src/object-storage.js";

const requiredEnvironment = [
  "S3_ENDPOINT",
  "S3_REGION",
  "S3_BUCKET",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
] as const;
const configured = requiredEnvironment.every((name) => Boolean(process.env[name]?.trim()));

function integrationClient() {
  return new S3Client({
    endpoint: process.env.S3_ENDPOINT!,
    region: process.env.S3_REGION!,
    forcePathStyle: true,
    requestChecksumCalculation: "WHEN_REQUIRED",
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID!,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
    },
  });
}

async function ensureBucket(client: S3Client) {
  const bucket = process.env.S3_BUCKET!;
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status !== 404) throw error;
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
  }
}

describe("MinIO-compatible object storage", () => {
  it("uploads, inspects, downloads, and deletes through the production adapter", { skip: !configured }, async () => {
    const client = integrationClient();
    await ensureBucket(client);
    const storage = createObjectStorageAdapter();
    const key = `integration/${randomUUID()}/round-trip.txt`;
    const body = Buffer.from(`CalmBoard MinIO integration ${randomUUID()}`, "utf8");

    try {
      const upload = await storage.createUploadUrl(key, "text/plain");
      assert.equal(upload.method, "PUT");
      assert.match(upload.url, /X-Amz-Signature=/i);
      const uploadResponse = await fetch(upload.url, { method: upload.method, headers: upload.headers, body });
      assert.equal(uploadResponse.ok, true);

      assert.deepEqual(await storage.inspectObject(key), { fileSize: body.length, mimeType: "text/plain" });
      assert.deepEqual(await storage.readObject(key), body);

      const downloadUrl = await storage.createDownloadUrl(key, "round-trip.txt");
      assert.match(downloadUrl, /X-Amz-Signature=/i);
      const downloadResponse = await fetch(downloadUrl);
      assert.equal(downloadResponse.ok, true);
      assert.deepEqual(Buffer.from(await downloadResponse.arrayBuffer()), body);
    } finally {
      await storage.deleteObject(key).catch(() => undefined);
      client.destroy();
    }

    await assert.rejects(
      () => storage.inspectObject(key),
      (error: unknown) => {
        return (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404;
      },
    );
  });
});
