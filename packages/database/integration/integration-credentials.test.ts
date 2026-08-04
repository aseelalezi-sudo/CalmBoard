import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  createIntegrationCredentialsRepository,
  db,
  integrationCredentials,
  memberships,
  organizations,
  pool,
  TenantPermissionDeniedError,
  TenantResourceNotFoundError,
  users,
  workspaces,
} from "../src/index";

process.env.INTEGRATION_CREDENTIALS_KEY = Buffer.alloc(32, 17).toString("base64");
process.env.INTEGRATION_CREDENTIALS_ACTIVE_KEY_VERSION = "1";

after(async () => {
  await pool.end();
});

describe("encrypted integration credentials", () => {
  it("encrypts, scopes, rotates, uses, and revokes credentials without exposing secrets", async () => {
    const organizationId = randomUUID();
    const otherOrganizationId = randomUUID();
    const workspaceId = randomUUID();
    const otherWorkspaceId = randomUUID();
    const ownerId = randomUUID();
    const memberId = randomUUID();
    const otherOwnerId = randomUUID();
    const accessToken = `access-${randomUUID()}`;
    const refreshToken = `refresh-${randomUUID()}`;

    try {
      await db.insert(users).values([
        { id: ownerId, email: `integration-owner-${ownerId}@example.test`, name: "Integration owner" },
        { id: memberId, email: `integration-member-${memberId}@example.test`, name: "Integration member" },
        { id: otherOwnerId, email: `integration-other-${otherOwnerId}@example.test`, name: "Other owner" },
      ]);
      await db.insert(organizations).values([
        { id: organizationId, name: "Credential tenant", slug: `credential-${organizationId}`, ownerId },
        {
          id: otherOrganizationId,
          name: "Other credential tenant",
          slug: `credential-${otherOrganizationId}`,
          ownerId: otherOwnerId,
        },
      ]);
      await db.insert(workspaces).values([
        { id: workspaceId, organizationId, name: "Credential workspace", slug: `credential-${workspaceId}` },
        {
          id: otherWorkspaceId,
          organizationId: otherOrganizationId,
          name: "Other credential workspace",
          slug: `credential-${otherWorkspaceId}`,
        },
      ]);
      await db.insert(memberships).values([
        { userId: ownerId, organizationId, role: "owner", status: "active" },
        { userId: memberId, organizationId, workspaceId, role: "member", status: "active" },
        { userId: otherOwnerId, organizationId: otherOrganizationId, role: "owner", status: "active" },
      ]);

      const ownerRepository = createIntegrationCredentialsRepository({
        organizationId,
        workspaceId,
        actorId: ownerId,
      });
      const saved = await ownerRepository.save({
        provider: "github",
        displayName: "Engineering GitHub",
        authType: "oauth2",
        secrets: { accessToken, refreshToken },
        externalAccountId: "calmboard-engineering",
        scopes: ["repo", "read:user", "repo"],
        metadata: { accountType: "organization" },
        expiresAt: new Date(Date.now() + 60 * 60 * 1_000),
      });
      assert.equal(saved.hasSecret, true);
      assert.equal("encryptedPayload" in saved, false);
      assert.equal(JSON.stringify(saved).includes(accessToken), false);

      const [stored] = await db.select().from(integrationCredentials).where(eq(integrationCredentials.id, saved.id));
      assert.notEqual(stored.encryptedPayload, accessToken);
      assert.equal(stored.encryptedPayload.includes(accessToken), false);
      assert.equal(stored.encryptedPayload.includes(refreshToken), false);
      assert.equal(stored.secretFingerprint.length, 64);
      assert.equal(stored.initializationVector.length, 16);
      assert.equal(stored.authenticationTag.length, 24);

      const memberRepository = createIntegrationCredentialsRepository({
        organizationId,
        workspaceId,
        actorId: memberId,
      });
      const visibleCredentials = await memberRepository.list();
      assert.deepEqual(
        visibleCredentials.map((credential) => credential.id),
        [saved.id],
      );
      assert.equal(JSON.stringify(visibleCredentials).includes("encryptedPayload"), false);
      assert.equal(JSON.stringify(visibleCredentials).includes(stored.encryptedPayload), false);
      const used = await memberRepository.getForUse("github");
      assert.deepEqual(used.secrets, { accessToken, refreshToken });
      assert.ok(used.credential.lastUsedAt);
      await assert.rejects(
        () =>
          memberRepository.save({
            provider: "slack",
            displayName: "Forbidden Slack",
            authType: "bearer",
            secrets: { token: "member-token" },
          }),
        (error: unknown) => error instanceof TenantPermissionDeniedError,
      );

      const otherRepository = createIntegrationCredentialsRepository({
        organizationId: otherOrganizationId,
        workspaceId: otherWorkspaceId,
        actorId: otherOwnerId,
      });
      assert.deepEqual(await otherRepository.list(), []);
      await assert.rejects(
        () => otherRepository.getForUse("github"),
        (error: unknown) => error instanceof TenantResourceNotFoundError,
      );

      const rotatedAccessToken = `rotated-${randomUUID()}`;
      const rotated = await ownerRepository.save({
        provider: "github",
        displayName: "Engineering GitHub",
        authType: "oauth2",
        secrets: { accessToken: rotatedAccessToken, refreshToken },
      });
      assert.equal(rotated.id, saved.id);
      const [storedAfterRotation] = await db
        .select()
        .from(integrationCredentials)
        .where(eq(integrationCredentials.id, saved.id));
      assert.notEqual(storedAfterRotation.encryptedPayload, stored.encryptedPayload);
      assert.notEqual(storedAfterRotation.initializationVector, stored.initializationVector);
      assert.ok(storedAfterRotation.lastRotatedAt > stored.lastRotatedAt);
      assert.deepEqual((await ownerRepository.getForUse("github")).secrets, {
        accessToken: rotatedAccessToken,
        refreshToken,
      });

      await assert.rejects(
        () =>
          db
            .update(integrationCredentials)
            .set({ encryptedPayload: Buffer.from("tampered").toString("base64") })
            .where(eq(integrationCredentials.id, saved.id)),
        (error: unknown) =>
          (error as { cause?: { message?: string } }).cause?.message ===
          "Credential rotation must replace the complete encryption envelope",
      );
      await assert.rejects(
        () =>
          db.insert(integrationCredentials).values({
            organizationId,
            workspaceId: otherWorkspaceId,
            provider: "slack",
            displayName: "Cross-tenant credential",
            authType: "bearer",
            encryptedPayload: "ciphertext",
            initializationVector: Buffer.alloc(12).toString("base64"),
            authenticationTag: Buffer.alloc(16).toString("base64"),
            secretFingerprint: "a".repeat(64),
            createdBy: ownerId,
          }),
        (error: unknown) =>
          (error as { cause?: { message?: string } }).cause?.message ===
          "Integration credential workspace does not belong to its organization",
      );

      await ownerRepository.revoke(saved.id);
      await assert.rejects(
        () => ownerRepository.getForUse("github"),
        (error: unknown) => error instanceof TenantResourceNotFoundError,
      );
      const replacement = await ownerRepository.save({
        provider: "github",
        displayName: "Replacement GitHub",
        authType: "oauth2",
        secrets: { accessToken: `replacement-${randomUUID()}` },
      });
      assert.notEqual(replacement.id, saved.id);
      assert.equal(
        (
          await db
            .select({ id: integrationCredentials.id })
            .from(integrationCredentials)
            .where(
              and(
                eq(integrationCredentials.organizationId, organizationId),
                eq(integrationCredentials.workspaceId, workspaceId),
                isNull(integrationCredentials.revokedAt),
              ),
            )
        ).length,
        1,
      );
    } finally {
      await db
        .delete(integrationCredentials)
        .where(inArray(integrationCredentials.organizationId, [organizationId, otherOrganizationId]))
        .catch(() => undefined);
      await db
        .delete(memberships)
        .where(inArray(memberships.organizationId, [organizationId, otherOrganizationId]))
        .catch(() => undefined);
      await db
        .delete(workspaces)
        .where(inArray(workspaces.id, [workspaceId, otherWorkspaceId]))
        .catch(() => undefined);
      await db
        .delete(organizations)
        .where(inArray(organizations.id, [organizationId, otherOrganizationId]))
        .catch(() => undefined);
      await db
        .delete(users)
        .where(inArray(users.id, [ownerId, memberId, otherOwnerId]))
        .catch(() => undefined);
    }
  });
});
