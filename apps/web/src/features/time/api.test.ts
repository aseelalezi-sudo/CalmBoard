import assert from "node:assert/strict";
import test from "node:test";
import type { Timesheet } from "@/lib/types";
import { createTimeLog, reviewTimesheetRecord, submitTimesheetRecord } from "@/features/workspace/actions-api";

test("timesheet API keeps identity trusted and review mutations tenant scoped", async (t) => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), init });
    return new Response(JSON.stringify({ id: "timesheet-1", version: 2 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const scope = {
    organizationId: "organization/a",
    workspaceId: "workspace/a",
    actorId: "user/a",
  };
  const timesheet = {
    id: "timesheet/a",
    organizationId: scope.organizationId,
    workspaceId: scope.workspaceId,
    userId: "member/a",
    periodStart: "2026-07-27",
    periodEnd: "2026-08-02",
    status: "submitted",
    version: 4,
    totalMinutes: 480,
    billableMinutes: 420,
    entriesCount: 3,
    tasksCount: 2,
  } satisfies Timesheet;

  await createTimeLog({ ...scope, taskId: "task/a", durationMinutes: 45, description: "Work" });
  await submitTimesheetRecord(timesheet, scope);
  await reviewTimesheetRecord(timesheet, "rejected", "Missing reference", scope);

  const createBody = JSON.parse(String(requests[0]?.init?.body)) as Record<string, unknown>;
  assert.equal(createBody.userId, undefined);
  assert.deepEqual(createBody, {
    ...scope,
    taskId: "task/a",
    durationMinutes: 45,
    description: "Work",
  });
  assert.match(requests[1]?.url ?? "", /timesheets\/timesheet%2Fa\/submit/);
  assert.deepEqual(JSON.parse(String(requests[1]?.init?.body)), { ...scope, expectedVersion: 4 });
  assert.match(requests[2]?.url ?? "", /timesheets\/timesheet%2Fa\/review/);
  assert.deepEqual(JSON.parse(String(requests[2]?.init?.body)), {
    ...scope,
    expectedVersion: 4,
    decision: "rejected",
    reason: "Missing reference",
  });
});
