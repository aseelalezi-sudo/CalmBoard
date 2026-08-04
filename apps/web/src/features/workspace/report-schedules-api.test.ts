import assert from "node:assert/strict";
import test from "node:test";
import { createReportSchedule } from "./report-schedules-api";

test("scheduled report API sends tenant scope without a client actor identity", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  let requestBody: Record<string, unknown> | undefined;
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(
      JSON.stringify({
        id: "schedule-1",
        version: 1,
        recipientIds: requestBody.recipientIds,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };
  await createReportSchedule(
    { organizationId: "organization-1", workspaceId: "workspace-1" },
    {
      name: "Weekly report",
      format: "pdf",
      cadence: "weekly",
      timezone: "Asia/Riyadh",
      time: "08:00",
      dayOfWeek: 1,
      dayOfMonth: null,
      recipientIds: ["11111111-1111-4111-8111-111111111111"],
      isEnabled: true,
    },
  );
  assert.equal(requestBody?.organizationId, "organization-1");
  assert.equal(requestBody?.format, "pdf");
  assert.equal(requestBody?.actorId, undefined);
});
