import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, withDatabaseContext } from "../client.js";
import {
  purgeLocatorFingerprint,
  validatePurgeLocator,
  type PurgeDomain,
  type PurgeLocatorKind,
} from "../data-lifecycle-locator.js";
import { TenantConflictError, TenantPermissionDeniedError, TenantResourceNotFoundError } from "../errors.js";
import {
  accountDeletionRequests,
  dataPurgeItems,
  organizationDeletionRequests,
  organizations,
  users,
} from "../schema.js";

export type ScheduleDeletionInput = {
  reauthenticatedAt: Date;
  scheduledFor: Date;
  policyVersion: string;
};

export type ScheduleOrganizationDeletionInput = ScheduleDeletionInput & {
  confirmationVersion: string;
  confirmedName: string;
};

const unresolvedDeletionStates = ["requested", "scheduled", "processing", "retry_wait", "failed"] as const;

function validateSchedule(input: ScheduleDeletionInput) {
  if (!input.policyVersion.trim() || input.policyVersion.length > 64) {
    throw new TenantConflictError("Deletion policy version is invalid");
  }
  if (!Number.isFinite(input.reauthenticatedAt.getTime()) || !Number.isFinite(input.scheduledFor.getTime())) {
    throw new TenantConflictError("Deletion schedule is invalid");
  }
  if (input.scheduledFor < input.reauthenticatedAt) {
    throw new TenantConflictError("Deletion cannot be scheduled before re-authentication");
  }
}

export function createAccountDeletionRepository(userId: string) {
  if (!userId) throw new TenantPermissionDeniedError("Authenticated user is required");
  return {
    async get() {
      return withDatabaseContext({ actorId: userId }, async () => {
        const [request] = await db
          .select()
          .from(accountDeletionRequests)
          .where(eq(accountDeletionRequests.userId, userId))
          .orderBy(desc(accountDeletionRequests.createdAt))
          .limit(1);
        return request ?? null;
      });
    },

    async schedule(input: ScheduleDeletionInput) {
      validateSchedule(input);
      return withDatabaseContext({ actorId: userId }, async () =>
        db.transaction(async (transaction) => {
          const [user] = await transaction
            .select({ id: users.id, lifecycleState: users.lifecycleState })
            .from(users)
            .where(eq(users.id, userId))
            .for("update")
            .limit(1);
          if (!user) throw new TenantResourceNotFoundError("user");
          if (user.lifecycleState !== "active") throw new TenantConflictError("Account deletion is already active");

          const ownedOrganizations = await transaction
            .select({ id: organizations.id })
            .from(organizations)
            .where(and(eq(organizations.ownerId, userId), isNull(organizations.deletedAt)));
          if (ownedOrganizations.length) {
            const deletingOrganizations = await transaction
              .select({ organizationId: organizationDeletionRequests.organizationId })
              .from(organizationDeletionRequests)
              .where(
                and(
                  inArray(
                    organizationDeletionRequests.organizationId,
                    ownedOrganizations.map((organization) => organization.id),
                  ),
                  inArray(organizationDeletionRequests.status, [...unresolvedDeletionStates]),
                ),
              );
            const deleting = new Set(deletingOrganizations.map((request) => request.organizationId));
            if (ownedOrganizations.some((organization) => !deleting.has(organization.id))) {
              throw new TenantConflictError(
                "Transfer ownership or schedule deletion for every Organization you solely own before deleting the account",
              );
            }
          }

          const [request] = await transaction
            .insert(accountDeletionRequests)
            .values({
              userId,
              status: "requested",
              policyVersion: input.policyVersion,
              requestedAt: input.reauthenticatedAt,
              reauthenticatedAt: input.reauthenticatedAt,
            })
            .returning();
          await transaction
            .update(users)
            .set({ lifecycleState: "deletion_pending", updatedAt: input.reauthenticatedAt })
            .where(eq(users.id, userId));
          const [scheduled] = await transaction
            .update(accountDeletionRequests)
            .set({ status: "scheduled", scheduledFor: input.scheduledFor, updatedAt: input.reauthenticatedAt })
            .where(eq(accountDeletionRequests.id, request.id))
            .returning();
          return scheduled;
        }),
      );
    },

    async cancel() {
      return withDatabaseContext({ actorId: userId }, async () =>
        db.transaction(async (transaction) => {
          const [request] = await transaction
            .select()
            .from(accountDeletionRequests)
            .where(
              and(
                eq(accountDeletionRequests.userId, userId),
                inArray(accountDeletionRequests.status, ["requested", "scheduled"]),
              ),
            )
            .for("update")
            .limit(1);
          if (!request) throw new TenantResourceNotFoundError("cancellable account deletion request");
          const now = new Date();
          const [canceled] = await transaction
            .update(accountDeletionRequests)
            .set({ status: "canceled", canceledAt: now, scheduledFor: request.scheduledFor, updatedAt: now })
            .where(eq(accountDeletionRequests.id, request.id))
            .returning();
          await transaction
            .update(users)
            .set({ lifecycleState: "active", authDisabledAt: null, anonymizedAt: null, updatedAt: now })
            .where(eq(users.id, userId));
          return canceled;
        }),
      );
    },
  };
}

export function createOrganizationDeletionRepository(organizationId: string, actorId: string) {
  if (!organizationId || !actorId) throw new TenantPermissionDeniedError("Organization owner context is required");
  const context = { organizationId, actorId };
  return {
    async get() {
      return withDatabaseContext(context, async () => {
        const [request] = await db
          .select()
          .from(organizationDeletionRequests)
          .where(eq(organizationDeletionRequests.organizationId, organizationId))
          .orderBy(desc(organizationDeletionRequests.createdAt))
          .limit(1);
        return request ?? null;
      });
    },

    async schedule(input: ScheduleOrganizationDeletionInput) {
      validateSchedule(input);
      if (!input.confirmationVersion.trim() || input.confirmationVersion.length > 64) {
        throw new TenantConflictError("Deletion confirmation version is invalid");
      }
      return withDatabaseContext(context, async () =>
        db.transaction(async (transaction) => {
          const [organization] = await transaction
            .select({
              id: organizations.id,
              name: organizations.name,
              ownerId: organizations.ownerId,
              lifecycleState: organizations.lifecycleState,
            })
            .from(organizations)
            .where(and(eq(organizations.id, organizationId), isNull(organizations.deletedAt)))
            .for("update")
            .limit(1);
          if (!organization) throw new TenantResourceNotFoundError("organization");
          if (organization.ownerId !== actorId)
            throw new TenantPermissionDeniedError("Only the Organization owner may delete it");
          if (organization.lifecycleState !== "active") {
            throw new TenantConflictError("Organization deletion is already active");
          }
          if (input.confirmedName !== organization.name) {
            throw new TenantConflictError("Organization name confirmation does not match exactly");
          }

          const [request] = await transaction
            .insert(organizationDeletionRequests)
            .values({
              organizationId,
              requestedByUserId: actorId,
              status: "requested",
              policyVersion: input.policyVersion,
              confirmationVersion: input.confirmationVersion,
              requestedAt: input.reauthenticatedAt,
              reauthenticatedAt: input.reauthenticatedAt,
            })
            .returning();
          await transaction
            .update(organizations)
            .set({ lifecycleState: "deletion_pending", updatedAt: input.reauthenticatedAt })
            .where(eq(organizations.id, organizationId));
          const [scheduled] = await transaction
            .update(organizationDeletionRequests)
            .set({ status: "scheduled", scheduledFor: input.scheduledFor, updatedAt: input.reauthenticatedAt })
            .where(eq(organizationDeletionRequests.id, request.id))
            .returning();
          return scheduled;
        }),
      );
    },

    async cancel() {
      return withDatabaseContext(context, async () =>
        db.transaction(async (transaction) => {
          const [request] = await transaction
            .select()
            .from(organizationDeletionRequests)
            .where(
              and(
                eq(organizationDeletionRequests.organizationId, organizationId),
                inArray(organizationDeletionRequests.status, ["requested", "scheduled"]),
              ),
            )
            .for("update")
            .limit(1);
          if (!request) throw new TenantResourceNotFoundError("cancellable Organization deletion request");
          const [organization] = await transaction
            .select({ ownerId: organizations.ownerId })
            .from(organizations)
            .where(eq(organizations.id, organizationId))
            .for("update")
            .limit(1);
          if (!organization) throw new TenantResourceNotFoundError("organization");
          if (organization.ownerId !== actorId)
            throw new TenantPermissionDeniedError("Only the Organization owner may cancel deletion");
          const now = new Date();
          const [canceled] = await transaction
            .update(organizationDeletionRequests)
            .set({ status: "canceled", canceledAt: now, updatedAt: now })
            .where(eq(organizationDeletionRequests.id, request.id))
            .returning();
          await transaction
            .update(organizations)
            .set({ lifecycleState: "active", writeFrozenAt: null, updatedAt: now })
            .where(eq(organizations.id, organizationId));
          return canceled;
        }),
      );
    },
  };
}

export function createDataPurgeRepository() {
  return {
    async insertItem(input: {
      accountRequestId?: string;
      organizationRequestId?: string;
      domain: PurgeDomain;
      locatorKind: PurgeLocatorKind;
      locator: Record<string, unknown>;
    }) {
      if (Boolean(input.accountRequestId) === Boolean(input.organizationRequestId)) {
        throw new TenantConflictError("Exactly one purge request parent is required");
      }
      validatePurgeLocator(input.domain, input.locatorKind, input.locator);
      const locatorFingerprint = purgeLocatorFingerprint(input.domain, input.locatorKind, input.locator);
      const [item] = await db
        .insert(dataPurgeItems)
        .values({ ...input, locatorFingerprint })
        .onConflictDoNothing()
        .returning();
      if (item) return item;
      const parentCondition = input.accountRequestId
        ? eq(dataPurgeItems.accountRequestId, input.accountRequestId)
        : eq(dataPurgeItems.organizationRequestId, input.organizationRequestId!);
      const [existing] = await db
        .select()
        .from(dataPurgeItems)
        .where(
          and(
            parentCondition,
            eq(dataPurgeItems.domain, input.domain),
            eq(dataPurgeItems.locatorFingerprint, locatorFingerprint),
          ),
        )
        .limit(1);
      if (!existing) throw new TenantConflictError("Purge item could not be persisted");
      if (purgeLocatorFingerprint(existing.domain, existing.locatorKind, existing.locator) !== locatorFingerprint) {
        throw new TenantConflictError("Purge locator fingerprint collision");
      }
      return existing;
    },
  };
}
