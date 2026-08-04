import assert from "node:assert/strict";
import test from "node:test";
import { uploadTaskAttachment } from "./api";

test("attachment upload service", async (t) => {
  const originalFetch = globalThis.fetch;

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  await t.test("prepares and uploads a task attachment", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = async (input, init) => {
      requests.push({ url: String(input), init });
      if (requests.length === 1) {
        return new Response(
          JSON.stringify({
            id: "attachment-1",
            fileName: "evidence.txt",
            upload: {
              url: "https://storage.example/upload",
              method: "PUT",
              headers: { "Content-Type": "text/plain" },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (requests.length === 3) {
        return new Response(JSON.stringify({ id: "attachment-1", fileName: "evidence.txt", scanStatus: "clean" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(null, { status: 200 });
    };

    const file = new File(["evidence"], "evidence.txt", { type: "text/plain" });
    const attachment = await uploadTaskAttachment({
      organizationId: "organization-1",
      workspaceId: "workspace-1",
      taskId: "task-1",
      uploaderId: "user-1",
      file,
    });

    assert.equal(requests.length, 3);
    assert.equal(requests[0]?.url, "http://localhost:5500/attachments");
    assert.equal(requests[1]?.url, "https://storage.example/upload");
    assert.equal(requests[1]?.init?.method, "PUT");
    assert.equal(requests[1]?.init?.body, file);
    assert.equal(requests[2]?.url, "http://localhost:5500/attachments/complete");
    assert.equal(requests[2]?.init?.method, "POST");
    assert.equal(attachment.id, "attachment-1");
    assert.ok(!("upload" in attachment));
  });

  await t.test("removes an uploaded object record when scanning fails", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = async (input, init) => {
      requests.push({ url: String(input), init });
      if (requests.length === 1) {
        return new Response(
          JSON.stringify({
            id: "attachment-2",
            upload: { url: "https://storage.example/upload", method: "PUT", headers: {} },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (requests.length === 3) {
        return new Response(JSON.stringify({ id: "attachment-2", scanStatus: "infected" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(null, { status: 204 });
    };

    await assert.rejects(
      () =>
        uploadTaskAttachment({
          organizationId: "organization-1",
          workspaceId: "workspace-1",
          taskId: "task-1",
          uploaderId: "user-1",
          file: new File(["x"], "x.txt", { type: "text/plain" }),
        }),
      /infected/,
    );
    assert.equal(requests.length, 4);
    assert.equal(requests[3]?.init?.method, "DELETE");
  });

  await t.test("removes the prepared record when object storage rejects the upload", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = async (input, init) => {
      requests.push({ url: String(input), init });
      if (requests.length === 1) {
        return new Response(
          JSON.stringify({
            id: "attachment/a",
            upload: { url: "https://storage.example/upload", method: "PUT", headers: {} },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (requests.length === 2) return new Response(null, { status: 500 });
      return new Response(null, { status: 204 });
    };

    await assert.rejects(
      () =>
        uploadTaskAttachment({
          organizationId: "organization/a",
          workspaceId: "workspace/a",
          taskId: "task-1",
          uploaderId: "user-1",
          file: new File(["x"], "x.txt", { type: "text/plain" }),
        }),
      /Object storage upload failed/,
    );

    assert.equal(requests.length, 3);
    assert.equal(requests[2]?.init?.method, "DELETE");
    assert.match(requests[2]?.url ?? "", /id=attachment%2Fa/);
    assert.match(requests[2]?.url ?? "", /organizationId=organization%2Fa/);
    assert.match(requests[2]?.url ?? "", /workspaceId=workspace%2Fa/);
  });
});
