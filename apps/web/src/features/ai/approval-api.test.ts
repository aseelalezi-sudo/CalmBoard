import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { approveAIProposal, rejectAIProposal, runAiAction } from "@/features/workspace/actions-api";

test("AI proposals use distinct review and mutation endpoints", async (t) => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), init });
    return new Response(JSON.stringify({ status: "executed", importedCount: 2 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const scope = { organizationId: "org-1", workspaceId: "workspace-1", actorId: "untrusted-client-actor" };
  const proposal = { id: "proposal/1", projectId: "project-1", digest: "a".repeat(64) };
  await runAiAction({ ...scope, projectId: "project-1", action: "breakdown", text: "Release" });
  await approveAIProposal(scope, proposal);
  await rejectAIProposal(scope, proposal);

  assert.deepEqual(JSON.parse(String(requests[0]?.init?.body)), {
    ...scope,
    projectId: "project-1",
    action: "breakdown",
    text: "Release",
  });
  assert.match(requests[1]?.url ?? "", /ai\/proposals\/proposal%2F1\/approve$/);
  assert.deepEqual(JSON.parse(String(requests[1]?.init?.body)), {
    ...scope,
    projectId: proposal.projectId,
    digest: proposal.digest,
  });
  assert.match(requests[2]?.url ?? "", /ai\/proposals\/proposal%2F1\/reject$/);
});

test("AI panel cannot directly create tasks from raw model text", async () => {
  const panel = await readFile(new URL("./ai-panel.tsx", import.meta.url), "utf8");
  const shell = await readFile(new URL("../shell/calmboard-app.tsx", import.meta.url), "utf8");
  assert.equal(panel.includes("createFromAI"), false);
  assert.equal(panel.includes("result.split"), false);
  assert.equal(shell.includes("createFromAI"), false);
  assert.match(panel, /confirmed/);
  assert.match(panel, /canApprove/);
});
