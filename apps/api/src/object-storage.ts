import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { DatabaseTenantContext } from "@calmboard/database";
import { ServiceUnavailableException } from "@nestjs/common";
import { randomUUID } from "node:crypto";

const uploadExpiresInSeconds = 15 * 60;
const downloadExpiresInSeconds = 5 * 60;

type StorageConfig = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
};

function readStorageConfig(): StorageConfig {
  const config = {
    endpoint: process.env.S3_PUBLIC_ENDPOINT ?? process.env.S3_ENDPOINT,
    region: process.env.S3_REGION ?? "us-east-1",
    bucket: process.env.S3_BUCKET,
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  };
  const missing = Object.entries(config)
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length) throw new ServiceUnavailableException(`Object storage is not configured: ${missing.join(", ")}`);
  return config as StorageConfig;
}

function sanitizeFileName(fileName: string) {
  const baseName = fileName.split(/[\\/]/).pop() ?? "file";
  return (
    baseName
      .normalize("NFKC")
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .replace(/[^a-zA-Z0-9._\-\u0600-\u06ff]/g, "_")
      .slice(0, 180) || "file"
  );
}

export function createStorageKey(context: DatabaseTenantContext, fileName: string) {
  const now = new Date();
  return [
    "organizations",
    context.organizationId,
    "workspaces",
    context.workspaceId,
    String(now.getUTCFullYear()),
    String(now.getUTCMonth() + 1).padStart(2, "0"),
    `${randomUUID()}-${sanitizeFileName(fileName)}`,
  ].join("/");
}

export function createObjectStorageAdapter() {
  const config = readStorageConfig();
  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: true,
    requestChecksumCalculation: "WHEN_REQUIRED",
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });
  const toStorageReference = (key: string) => `s3://${config.bucket}/${key}`;
  const readStorageKey = (reference: string) => {
    const prefix = `s3://${config.bucket}/`;
    return reference.startsWith(prefix) ? reference.slice(prefix.length) : null;
  };
  return {
    toStorageReference,
    readStorageKey,
    async createUploadUrl(key: string, contentType: string) {
      const url = await getSignedUrl(
        client,
        new PutObjectCommand({ Bucket: config.bucket, Key: key, ContentType: contentType }),
        { expiresIn: uploadExpiresInSeconds },
      );
      return {
        url,
        method: "PUT" as const,
        headers: { "Content-Type": contentType },
        expiresAt: new Date(Date.now() + uploadExpiresInSeconds * 1000).toISOString(),
      };
    },
    createDownloadUrl(key: string, fileName: string) {
      return getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: config.bucket,
          Key: key,
          ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        }),
        { expiresIn: downloadExpiresInSeconds },
      );
    },
    createPreviewUrl(key: string, contentType: string) {
      return getSignedUrl(
        client,
        new GetObjectCommand({ Bucket: config.bucket, Key: key, ResponseContentType: contentType }),
        { expiresIn: downloadExpiresInSeconds },
      );
    },
    async readObject(key: string) {
      const object = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }));
      if (!object.Body) throw new Error("Object storage returned an empty body");
      return Buffer.from(await object.Body.transformToByteArray());
    },
    async putObject(key: string, body: Uint8Array, contentType: string) {
      await client.send(
        new PutObjectCommand({ Bucket: config.bucket, Key: key, Body: body, ContentType: contentType }),
      );
      return toStorageReference(key);
    },
    async inspectObject(key: string) {
      const object = await client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: key }));
      return { fileSize: object.ContentLength, mimeType: object.ContentType };
    },
    async deleteObject(key: string) {
      await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
    },
  };
}
