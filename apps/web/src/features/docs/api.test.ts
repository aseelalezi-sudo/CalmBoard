import assert from "node:assert/strict";
import test from "node:test";
import { getDocumentPermissions, removeDocumentPermission, saveDocumentSnapshot, setDocumentPermission } from "./api";

test("document API keeps version authors trusted and scopes resource permissions", async (t) => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), init });
    return new Response(JSON.stringify(init?.method === "POST" ? { ok: true } : []), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const document = {
    id: "document/a",
    organizationId: "organization/a",
    workspaceId: "workspace/a",
  };
  await saveDocumentSnapshot(document);
  await getDocumentPermissions(document);
  await setDocumentPermission(document, "user/a", "editor");
  await removeDocumentPermission(document, "user/a");

  const snapshotBody = JSON.parse(String(requests[0]?.init?.body)) as Record<string, unknown>;
  assert.deepEqual(snapshotBody, {
    action: "save_snapshot",
    organizationId: "organization/a",
    workspaceId: "workspace/a",
  });
  assert.match(requests[1]?.url ?? "", /document%2Fa\/permissions/);
  const permissionBody = JSON.parse(String(requests[2]?.init?.body)) as Record<string, unknown>;
  assert.equal(permissionBody.targetUserId, "user/a");
  assert.equal(permissionBody.accessLevel, "editor");
  assert.equal(requests[3]?.init?.method, "DELETE");
  assert.match(requests[3]?.url ?? "", /targetUserId=user%2Fa/);
});
