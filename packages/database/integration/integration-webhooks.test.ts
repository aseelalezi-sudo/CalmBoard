import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import { eq, inArray } from "drizzle-orm";
import {
  createIntegrationWebhookEndpointsRepository,
  createIntegrationWebhookReceiptsRepository,
  db,
  hashIntegrationWebhookEndpointToken,
  integrationWebhookEndpoints,
  integrationWebhookReceipts,
  memberships,
  organizations,
  pool,
  resolveIntegrationWebhookEndpoint,
  TenantConflictError,
  TenantPermissionDeniedError,
  users,
  withTenantTransaction,
  workspaces,
} from "../src/index";

after(async () => {
  await pool.end();
});

describe("integration webhook replay protection", () => {
  it("resolves opaque endpoints, isolates tenants, and records each delivery exactly once", async () => {
    const organizationId = randomUUID();
    const otherOrganizationId = randomUUID();
    const workspaceId = randomUUID();
    const otherWorkspaceId = randomUUID();
    const ownerId = randomUUID();
    const memberId = randomUUID();
    const otherOwnerId = randomUUID();

    try {
      await db.insert(users).values([
        { id: ownerId, email: `webhook-owner-${ownerId}@example.test`, name: "Webhook owner" },
        { id: memberId, email: `webhook-member-${memberId}@example.test`, name: "Webhook member" },
        { id: otherOwnerId, email: `webhook-other-${otherOwnerId}@example.test`, name: "Other webhook owner" },
      ]);
      await db.insert(organizations).values([
        { id: organizationId, name: "Webhook tenant", slug: `webhook-${organizationId}`, ownerId },
        {
          id: otherOrganizationId,
          name: "Other webhook tenant",
          slug: `webhook-${otherOrganizationId}`,
          ownerId: otherOwnerId,
        },
      ]);
      await db.insert(workspaces).values([
        { id: workspaceId, organizationId, name: "Webhook workspace", slug: `webhook-${workspaceId}` },
        {
          id: otherWorkspaceId,
          organizationId: otherOrganizationId,
          name: "Other webhook workspace",
          slug: `webhook-${otherWorkspaceId}`,
        },
      ]);
      await db.insert(memberships).values([
        { userId: ownerId, organizationId, role: "owner", status: "active" },
        { userId: memberId, organizationId, workspaceId, role: "member", status: "active" },
        { userId: otherOwnerId, organizationId: otherOrganizationId, role: "owner", status: "active" },
      ]);

      const ownerRepository = createIntegrationWebhookEndpointsRepository({
        organizationId,
        workspaceId,
        actorId: ownerId,
      });
      const created = await ownerRepository.create("github", "Engineering GitHub events");
      assert.equal(created.endpointToken.length, 43);
      assert.deepEqual(
        (await ownerRepository.list()).map((endpoint) => endpoint.id),
        [created.endpoint.id],
      );

      const [storedEndpoint] = await db
        .select()
        .from(integrationWebhookEndpoints)
        .where(eq(integrationWebhookEndpoints.id, created.endpoint.id));
      assert.equal(storedEndpoint.endpointKeyHash, hashIntegrationWebhookEndpointToken(created.endpointToken));
      assert.equal(JSON.stringify(storedEndpoint).includes(created.endpointToken), false);

      assert.deepEqual(await resolveIntegrationWebhookEndpoint("github", created.endpointToken), {
        endpointId: created.endpoint.id,
        organizationId,
        workspaceId,
      });
      assert.equal(await resolveIntegrationWebhookEndpoint("slack", created.endpointToken), null);
      assert.equal(await resolveIntegrationWebhookEndpoint("github", "invalid"), null);

      const memberRepository = createIntegrationWebhookEndpointsRepository({
        organizationId,
        workspaceId,
        actorId: memberId,
      });
      await assert.rejects(
        () => memberRepository.create("slack", "Forbidden endpoint"),
        (error: unknown) => error instanceof TenantPermissionDeniedError,
      );
      const otherRepository = createIntegrationWebhookEndpointsRepository({
        organizationId: otherOrganizationId,
        workspaceId: otherWorkspaceId,
        actorId: otherOwnerId,
      });
      assert.deepEqual(await otherRepository.list(), []);

      const deliveryId = `delivery-${randomUUID()}`;
      const payloadSha256 = "a".repeat(64);
      const record = () =>
        withTenantTransaction({ organizationId, workspaceId }, () =>
          createIntegrationWebhookReceiptsRepository({ organizationId, workspaceId }).record({
            endpointId: created.endpoint.id,
            provider: "github",
            deliveryId,
            payloadSha256,
            eventType: "issues",
          }),
        );
      const concurrentResults = await Promise.all([record(), record()]);
      assert.deepEqual(concurrentResults.map((result) => result.replayed).sort(), [false, true]);
      assert.equal(
        (
          await db
            .select({ id: integrationWebhookReceipts.id })
            .from(integrationWebhookReceipts)
            .where(eq(integrationWebhookReceipts.endpointId, created.endpoint.id))
        ).length,
        1,
      );

      await assert.rejects(
        () =>
          withTenantTransaction({ organizationId, workspaceId }, () =>
            createIntegrationWebhookReceiptsRepository({ organizationId, workspaceId }).record({
              endpointId: created.endpoint.id,
              provider: "github",
              deliveryId,
              payloadSha256: "b".repeat(64),
              eventType: "issues",
            }),
          ),
        (error: unknown) => error instanceof TenantConflictError,
      );
      await assert.rejects(
        () =>
          withTenantTransaction({ organizationId: otherOrganizationId, workspaceId: otherWorkspaceId }, () =>
            createIntegrationWebhookReceiptsRepository({
              organizationId: otherOrganizationId,
              workspaceId: otherWorkspaceId,
            }).record({
              endpointId: created.endpoint.id,
              provider: "github",
              deliveryId: `cross-${randomUUID()}`,
              payloadSha256,
              eventType: "issues",
            }),
          ),
        (error: unknown) =>
          (error as { cause?: { message?: string } }).cause?.message ===
          "Integration webhook receipt must match an active endpoint tenant and provider",
      );

      await ownerRepository.revoke(created.endpoint.id);
      assert.equal(await resolveIntegrationWebhookEndpoint("github", created.endpointToken), null);
    } finally {
      await db
        .delete(integrationWebhookEndpoints)
        .where(inArray(integrationWebhookEndpoints.organizationId, [organizationId, otherOrganizationId]))
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
