import type { Page } from "@playwright/test";
import { db, users, workspaces } from "@calmboard/database";
import { eq } from "drizzle-orm";
import type { registerIsolatedOwner } from "./auth";

const apiUrl = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/$/, "");

// Exercise the real browser's cookies, CORS, CSRF and HTTP guards. Database
// access below only provisions memberships; tested operations all use HTTP.
export async function api(page: Page, path: string, method = "GET", body?: Record<string, unknown>) {
  return page.evaluate(
    async ({ url, csrfUrl, method, body }) => {
      const headers: Record<string, string> = {};
      if (method !== "GET") {
        const csrf = await fetch(csrfUrl, {
          credentials: "include",
        });
        if (!csrf.ok) throw new Error(`CSRF setup failed: ${csrf.status}`);
        const payload = (await csrf.json()) as { token: string };
        headers["x-csrf-token"] = payload.token;
        if (body !== undefined) headers["Content-Type"] = "application/json";
        headers["idempotency-key"] = crypto.randomUUID();
      }
      const response = await fetch(url, {
        method,
        credentials: "include",
        headers,
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const data: unknown = await response.json();
      return { status: response.status, data };
    },
    { url: `${apiUrl}${path}`, csrfUrl: `${apiUrl}/auth/csrf`, method, body },
  );
}

export async function fixture(identity: Awaited<ReturnType<typeof registerIsolatedOwner>>) {
  const [user] = await db.select().from(users).where(eq(users.email, identity.email));
  const [workspace] = await db.select().from(workspaces).where(eq(workspaces.name, identity.workspace));
  if (!user || !workspace) throw new Error("Isolated registration fixture not found");
  return { userId: user.id, organizationId: workspace.organizationId, workspaceId: workspace.id };
}
