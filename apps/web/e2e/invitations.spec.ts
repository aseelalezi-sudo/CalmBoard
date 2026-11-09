import { expect, test, type Page } from "@playwright/test";
import { db, invitationEmailOutbox, invitations, memberships } from "@calmboard/database";
import { and, desc, eq } from "drizzle-orm";
import { decryptInvitationEmailPayload } from "../../../packages/notifications/src/index";
import { registerIsolatedOwner } from "./auth";
import { api, fixture } from "./api";

// Read only this test's encrypted outbox entry. This exercises link generation
// without sending mail or requiring a worker/external provider in the E2E gate.
async function invitationLink(invitationId: string, recipient: string, page: Page) {
  const [entry] = await db
    .select()
    .from(invitationEmailOutbox)
    .where(eq(invitationEmailOutbox.invitationId, invitationId))
    .orderBy(desc(invitationEmailOutbox.tokenVersion))
    .limit(1);
  if (!entry) throw new Error("Test invitation email was not queued");
  const { encryptedPayload, initializationVector, authenticationTag, encryptionAlgorithm, encryptionKeyVersion } =
    entry;
  if (
    !encryptedPayload ||
    !initializationVector ||
    !authenticationTag ||
    encryptionAlgorithm !== "aes-256-gcm" ||
    !encryptionKeyVersion
  ) {
    throw new Error("Test invitation email has no supported encrypted payload");
  }
  const payload = decryptInvitationEmailPayload(entry, {
    encryptedPayload,
    initializationVector,
    authenticationTag,
    encryptionAlgorithm,
    encryptionKeyVersion,
  });
  expect(payload.to).toBe(recipient);
  const href = /href="([^"]+)"/.exec(payload.html)?.[1];
  if (!href) throw new Error("Invitation email has no acceptance link");
  const url = new URL(href.replaceAll("&amp;", "&"));
  expect(url.origin).toBe(new URL(page.url()).origin);
  expect(url.pathname).toBe("/accept-invitation");
  const token = url.searchParams.get("token");
  if (!token) throw new Error("Invitation email has no token");
  return { url: url.toString(), token };
}

for (const width of [1440, 360]) {
  test(`invitation acceptance at ${width}px rejects another identity and joins the intended workspace`, async ({
    page,
    browser,
  }) => {
    test.setTimeout(120_000);
    const ownerIdentity = await registerIsolatedOwner(page);
    const owner = await fixture(ownerIdentity);
    const scope = { organizationId: owner.organizationId, workspaceId: owner.workspaceId };
    const otherContext = await browser.newContext({
      baseURL: new URL(page.url()).origin,
      viewport: { width, height: 900 },
    });
    try {
      const invitedPage = await otherContext.newPage();
      const invitedIdentity = await registerIsolatedOwner(invitedPage);
      const invited = await fixture(invitedIdentity);
      const created = await api(page, "/members", "POST", { ...scope, email: invitedIdentity.email, role: "viewer" });
      expect(created.status, JSON.stringify(created.data)).toBe(201);
      const id = (created.data as { invitation: { id: string } }).invitation.id;
      const link = await invitationLink(id, invitedIdentity.email, page);

      const forged = await api(page, "/invitations/accept", "POST", { token: link.token, userId: invited.userId });
      expect(forged.status).toBe(403);
      expect(forged.data).toMatchObject({ error: "Invitation is not intended for the authenticated identity" });
      await page.goto(link.url);
      await expect(page.getByRole("alert").filter({ hasText: ownerIdentity.email })).toBeVisible();
      await expect(page.getByRole("button", { name: /^(Accept invitation|قبول الدعوة)$/ })).toHaveCount(0);

      // The directory has no guaranteed order. Keep the invited workspace last
      // so accepting the link must select its ID rather than the first entry.
      await invitedPage.route("**/workspaces?**", async (route) => {
        const response = await route.fetch();
        const directory = (await response.json()) as { workspaces?: Array<{ id: string }> };
        if (Array.isArray(directory.workspaces)) {
          directory.workspaces.sort(
            (left, right) => Number(left.id === owner.workspaceId) - Number(right.id === owner.workspaceId),
          );
        }
        await route.fulfill({ response, json: directory });
      });
      await invitedPage.goto(link.url);
      const accepted = invitedPage.waitForResponse(
        (response) => response.url().endsWith("/invitations/accept") && response.request().method() === "POST",
      );
      await invitedPage.getByRole("button", { name: /^(Accept invitation|قبول الدعوة)$/ }).click();
      expect((await accepted).status()).toBe(201);
      await expect(invitedPage).toHaveURL(new RegExp(`workspaceId=${owner.workspaceId}`));
      await expect(invitedPage.getByText(ownerIdentity.workspace, { exact: true }).first()).toBeVisible();
      // Membership must survive a document reload and retain the invited role.
      await invitedPage.reload();
      await expect(invitedPage.getByText(ownerIdentity.workspace, { exact: true }).first()).toBeVisible();
      const saved = await db
        .select()
        .from(memberships)
        .where(and(eq(memberships.userId, invited.userId), eq(memberships.workspaceId, owner.workspaceId)));
      expect(saved).toHaveLength(1);
      expect(saved[0]).toMatchObject({ role: "viewer", status: "active" });
      expect((await api(invitedPage, "/invitations/accept", "POST", { token: link.token })).status).toBe(409);
      const deniedInvite = await api(invitedPage, "/members", "POST", {
        ...scope,
        email: "viewer-cannot-invite@example.test",
      });
      expect(deniedInvite.status).toBe(403);
      expect(deniedInvite.data).toMatchObject({ error: "Permission 'members.invite' is required" });
      // Inspect is IP-limited across the whole browser matrix. The UI already
      // inspects the link; verify persistence without a redundant public probe.
      const [savedInvitation] = await db.select().from(invitations).where(eq(invitations.id, id));
      expect(savedInvitation).toMatchObject({ status: "accepted", acceptedBy: invited.userId });
    } finally {
      await otherContext.close();
    }
  });
}

test("expired, rotated, revoked and declined invitations cannot create membership", async ({ page, browser }) => {
  test.setTimeout(120_000);
  const owner = await fixture(await registerIsolatedOwner(page));
  const scope = { organizationId: owner.organizationId, workspaceId: owner.workspaceId };
  const otherContext = await browser.newContext({ baseURL: new URL(page.url()).origin });
  try {
    const invitedPage = await otherContext.newPage();
    const identity = await registerIsolatedOwner(invitedPage);
    const invited = await fixture(identity);
    const create = async () => {
      const response = await api(page, "/members", "POST", { ...scope, email: identity.email, role: "member" });
      expect(response.status, JSON.stringify(response.data)).toBe(201);
      return (response.data as { invitation: { id: string } }).invitation.id;
    };
    const id = await create();
    const original = await invitationLink(id, identity.email, page);
    // Expiry is a clock fixture; creation, resend, revoke and acceptance use HTTP.
    await db
      .update(invitations)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(invitations.id, id));
    expect((await api(invitedPage, "/invitations/accept", "POST", { token: original.token })).status).toBe(409);
    await invitedPage.goto(original.url);
    await expect(
      invitedPage.getByRole("heading", { name: /This invitation expired|انتهت صلاحية الدعوة/ }),
    ).toBeVisible();
    expect((await api(page, `/members/${id}/resend`, "POST", scope)).status).toBe(201);
    const rotated = await invitationLink(id, identity.email, page);
    expect(rotated.token === original.token).toBe(false);
    const invalid = await api(invitedPage, "/invitations/inspect", "POST", { token: original.token });
    expect(invalid.status).toBe(201);
    expect(invalid.data).toMatchObject({ status: "invalid" });
    expect((await api(invitedPage, "/invitations/accept", "POST", { token: original.token })).status).toBe(404);
    const pending = await api(invitedPage, "/invitations/inspect", "POST", { token: rotated.token });
    expect(pending.status).toBe(201);
    expect(pending.data).toMatchObject({ status: "pending" });
    expect((await api(page, `/members/${id}`, "DELETE", scope)).status).toBe(200);
    expect((await api(invitedPage, "/invitations/accept", "POST", { token: rotated.token })).status).toBe(409);
    await invitedPage.goto(rotated.url);
    await expect(
      invitedPage.getByRole("heading", { name: /This invitation was revoked|أُلغيت هذه الدعوة/ }),
    ).toBeVisible();

    const declinedId = await create();
    const declined = await invitationLink(declinedId, identity.email, page);
    expect((await api(invitedPage, "/invitations/decline", "POST", { token: declined.token })).status).toBe(201);
    expect((await api(invitedPage, "/invitations/accept", "POST", { token: declined.token })).status).toBe(409);
    await invitedPage.goto(declined.url);
    await expect(
      invitedPage.getByRole("heading", { name: /This invitation was declined|تم رفض هذه الدعوة/ }),
    ).toBeVisible();
    const remaining = await db
      .select()
      .from(memberships)
      .where(and(eq(memberships.userId, invited.userId), eq(memberships.workspaceId, owner.workspaceId)));
    expect(remaining).toEqual([]);
  } finally {
    await otherContext.close();
  }
});
