import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { maxAttachmentSize, parseAttachmentTarget, parseAttachmentUploadInput } from "./attachment-validation.js";
import { createObjectStorageAdapter, createStorageKey } from "./object-storage.js";

describe("attachment request input", () => {
  it("requires exactly one tenant-owned target", () => {
    assert.throws(() => parseAttachmentTarget({}), /exactly one/);
    assert.throws(() => parseAttachmentTarget({ taskId: "task-1", projectId: "project-1" }), /exactly one/);
  });

  it("rejects oversized, unsafe, or mismatched files", () => {
    assert.throws(
      () =>
        parseAttachmentUploadInput({
          taskId: "task-1",
          uploaderId: "user-1",
          fileName: "large.pdf",
          fileSize: maxAttachmentSize + 1,
          mimeType: "application/pdf",
        }),
      /fileSize/,
    );
    assert.throws(
      () =>
        parseAttachmentUploadInput({
          taskId: "task-1",
          uploaderId: "user-1",
          fileName: "payload.exe",
          fileSize: 512,
          mimeType: "application/octet-stream",
        }),
      /extension is not allowed/,
    );
    assert.throws(
      () =>
        parseAttachmentUploadInput({
          taskId: "task-1",
          uploaderId: "user-1",
          fileName: "image.png",
          fileSize: 512,
          mimeType: "application/pdf",
        }),
      /does not match/,
    );
  });

  it("accepts a valid upload and builds a tenant-scoped key", () => {
    assert.deepEqual(
      parseAttachmentUploadInput({
        taskId: "task-1",
        uploaderId: "user-1",
        fileName: "release.pdf",
        fileSize: 2048,
        mimeType: "application/pdf",
      }),
      { taskId: "task-1", uploaderId: "user-1", fileName: "release.pdf", fileSize: 2048, mimeType: "application/pdf" },
    );
    const key = createStorageKey({ organizationId: "org-1", workspaceId: "workspace-1" }, "../../secret report.pdf");
    assert.match(key, /^organizations\/org-1\/workspaces\/workspace-1\//);
    assert.ok(!key.includes("../"));
    assert.match(key, /secret_report\.pdf$/);
  });

  it("creates signed S3 URLs without network access", async () => {
    const previous = Object.fromEntries(
      ["S3_ENDPOINT", "S3_PUBLIC_ENDPOINT", "S3_REGION", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"].map(
        (name) => [name, process.env[name]],
      ),
    );
    Object.assign(process.env, {
      S3_ENDPOINT: "http://127.0.0.1:9000",
      S3_PUBLIC_ENDPOINT: "http://127.0.0.1:9000",
      S3_REGION: "us-east-1",
      S3_BUCKET: "attachments-test",
      S3_ACCESS_KEY_ID: "test-access",
      S3_SECRET_ACCESS_KEY: "test-secret",
    });
    try {
      const storage = createObjectStorageAdapter();
      const upload = await storage.createUploadUrl("organizations/org-1/file.pdf", "application/pdf");
      const download = await storage.createDownloadUrl("organizations/org-1/file.pdf", "file.pdf");
      assert.equal(upload.method, "PUT");
      assert.match(upload.url, /X-Amz-Signature=/);
      assert.match(download, /X-Amz-Signature=/);
    } finally {
      for (const [name, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });
});
