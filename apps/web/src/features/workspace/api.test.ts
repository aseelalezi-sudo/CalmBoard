import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "@/lib/client-api";
import { getCurrentSession, getTaskPage, getTasks, getWorkspaceModules } from "./api";

test("workspace API service", async (t) => {
  const originalFetch = globalThis.fetch;

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  await t.test("collects workspace modules into one stable response", async () => {
    const requestedUrls: string[] = [];
    globalThis.fetch = async (input) => {
      const url = String(input);
      requestedUrls.push(url);
      const pathname = new URL(url, "http://web.test").pathname;

      const payload = pathname.startsWith("/docs")
        ? [{ id: "doc-1" }]
        : pathname.startsWith("/goals")
          ? [{ id: "goal-1" }]
          : pathname.startsWith("/automations")
            ? { automations: [{ id: "automation-1" }], runs: [{ id: "run-1" }] }
            : pathname.startsWith("/activities")
              ? [{ id: "activity-1" }]
              : pathname.startsWith("/saved-views")
                ? [{ id: "view-1" }]
                : pathname.startsWith("/time-logs")
                  ? { logs: [{ id: "log-1" }], totalMinutes: 75, billableMinutes: 60 }
                  : pathname.startsWith("/members")
                    ? { members: [{ id: "member-1" }], invitations: [{ id: "invitation-1" }] }
                    : pathname.startsWith("/forms")
                      ? [{ id: "form-1" }]
                      : pathname.startsWith("/invoices")
                        ? [{ id: "invoice-1" }]
                        : pathname.startsWith("/authorization/me")
                          ? {
                              userId: "user/a",
                              isPlatformAdmin: false,
                              member: true,
                              membershipId: "membership-1",
                              roles: ["manager"],
                              permissions: ["tasks.create", "audit.view", "billing.manage"],
                            }
                          : [{ id: "field-1" }];

      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const result = await getWorkspaceModules("workspace/a", "organization/a", "user/a");

    assert.equal(requestedUrls.length, 11);
    assert.ok(requestedUrls.every((url) => !url.includes("workspace/a")));
    assert.equal(result.docs[0]?.id, "doc-1");
    assert.equal(result.automations[0]?.id, "automation-1");
    assert.equal(result.automationRuns[0]?.id, "run-1");
    assert.deepEqual(result.timeTotals, { totalMinutes: 75, billableMinutes: 60 });
    assert.equal(result.members[0]?.id, "member-1");
    assert.equal(result.customFields[0]?.id, "field-1");
    assert.deepEqual(result.authorization?.permissions, ["tasks.create", "audit.view", "billing.manage"]);
  });

  await t.test("rejects unsuccessful required requests", async () => {
    globalThis.fetch = async () => new Response("not found", { status: 404 });

    await assert.rejects(
      () => getTasks({ id: "project-1", organizationId: "organization-1", workspaceId: "workspace-1" }),
      (error: unknown) =>
        (error instanceof ApiError && error.status === 404) ||
        /not found|could not be found|status 404/i.test(String(error)),
    );
  });

  await t.test("requests a bounded task page with tenant scope, filters, and a cursor", async () => {
    let requestedUrl = "";
    globalThis.fetch = async (input) => {
      requestedUrl = String(input);
      return new Response(JSON.stringify({ items: [{ id: "task-2" }], nextCursor: "next/page", total: 100_000 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const result = await getTaskPage(
      { id: "project/a", organizationId: "organization/a", workspaceId: "workspace/a" },
      {
        limit: 100,
        cursor: "current/page",
        search: "release plan",
        status: "todo",
        sortBy: "createdAt",
        sortDirection: "desc",
      },
    );
    const url = new URL(requestedUrl);

    assert.equal(url.pathname, "/tasks");
    assert.deepEqual(Object.fromEntries(url.searchParams), {
      projectId: "project/a",
      organizationId: "organization/a",
      workspaceId: "workspace/a",
      limit: "100",
      cursor: "current/page",
      search: "release plan",
      status: "todo",
      sortBy: "createdAt",
      sortDirection: "desc",
    });
    assert.equal(result.items[0]?.id, "task-2");
    assert.equal(result.nextCursor, "next/page");
    assert.equal(result.total, 100_000);
  });

  await t.test("treats an unauthenticated session as an anonymous visitor", async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ statusCode: 401, error: "Authentication is required" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });

    assert.deepEqual(await getCurrentSession(), {});
  });
});
