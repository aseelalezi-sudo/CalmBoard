import { createHash, randomUUID } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db, withTenantTransaction } from "../client.js";
import { memberships, oauthIdentities, oauthLoginStates, organizations, users, workspaces } from "../schema.js";

export type OAuthProvider = "google" | "microsoft";

export type OAuthProfile = {
  provider: OAuthProvider;
  subject: string;
  email: string;
  name: string;
  avatarUrl?: string | null;
  emailVerified: boolean;
};

const publicUserSelection = {
  id: users.id,
  email: users.email,
  name: users.name,
  avatarUrl: users.avatarUrl,
  locale: users.locale,
  theme: users.theme,
  emailVerifiedAt: users.emailVerifiedAt,
};

export function hashOAuthState(state: string) {
  return createHash("sha256").update(state).digest("hex");
}

export function createOAuthIdentityRepository() {
  return {
    async createState(provider: OAuthProvider, state: string, expiresAt: Date, requestedIp?: string) {
      const [record] = await db
        .insert(oauthLoginStates)
        .values({ provider, stateHash: hashOAuthState(state), expiresAt, requestedIp })
        .returning({ id: oauthLoginStates.id, expiresAt: oauthLoginStates.expiresAt });
      return record;
    },

    async consumeState(provider: OAuthProvider, state: string) {
      const now = new Date();
      const [record] = await db
        .update(oauthLoginStates)
        .set({ consumedAt: now })
        .where(
          and(
            eq(oauthLoginStates.provider, provider),
            eq(oauthLoginStates.stateHash, hashOAuthState(state)),
            isNull(oauthLoginStates.consumedAt),
            gt(oauthLoginStates.expiresAt, now),
          ),
        )
        .returning({ id: oauthLoginStates.id });
      return record ?? null;
    },

    async findByProviderSubject(provider: OAuthProvider, subject: string) {
      const [identity] = await db
        .select({ ...publicUserSelection, oauthIdentityId: oauthIdentities.id })
        .from(oauthIdentities)
        .innerJoin(users, eq(users.id, oauthIdentities.userId))
        .where(and(eq(oauthIdentities.provider, provider), eq(oauthIdentities.providerSubject, subject)))
        .limit(1);
      return identity ?? null;
    },

    async recordLogin(userId: string, oauthIdentityId: string) {
      const now = new Date();
      await db.transaction(async (transaction) => {
        await transaction
          .update(oauthIdentities)
          .set({ lastLoginAt: now, updatedAt: now })
          .where(eq(oauthIdentities.id, oauthIdentityId));
        await transaction
          .update(users)
          .set({ failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: now, updatedAt: now })
          .where(eq(users.id, userId));
      });
    },

    async linkExistingUser(userId: string, profile: OAuthProfile) {
      const now = new Date();
      return db.transaction(async (transaction) => {
        const [identity] = await transaction
          .insert(oauthIdentities)
          .values({
            userId,
            provider: profile.provider,
            providerSubject: profile.subject,
            email: profile.email.toLowerCase(),
            lastLoginAt: now,
          })
          .returning({ id: oauthIdentities.id });
        if (profile.emailVerified) {
          await transaction
            .update(users)
            .set({ emailVerifiedAt: now, updatedAt: now })
            .where(and(eq(users.id, userId), isNull(users.emailVerifiedAt)));
        }
        return identity;
      });
    },

    async registerExternal(profile: OAuthProfile) {
      const userId = randomUUID();
      const organizationId = randomUUID();
      const workspaceId = randomUUID();
      const suffix = organizationId.slice(0, 8);
      const now = new Date();

      return withTenantTransaction({ organizationId, workspaceId, actorId: userId }, async () => {
        return db.transaction(async (transaction) => {
          const [user] = await transaction
            .insert(users)
            .values({
              id: userId,
              email: profile.email.toLowerCase(),
              name: profile.name,
              avatarUrl: profile.avatarUrl,
              emailVerifiedAt: profile.emailVerified ? now : null,
              lastLoginAt: now,
            })
            .returning(publicUserSelection);
          await transaction.insert(oauthIdentities).values({
            userId,
            provider: profile.provider,
            providerSubject: profile.subject,
            email: profile.email.toLowerCase(),
            lastLoginAt: now,
          });
          await transaction.insert(organizations).values({
            id: organizationId,
            name: `${profile.name}'s organization`,
            slug: `org-${suffix}`,
            ownerId: userId,
          });
          await transaction.insert(workspaces).values({
            id: workspaceId,
            organizationId,
            name: "My workspace",
            slug: `workspace-${suffix}`,
          });
          await transaction.insert(memberships).values({
            userId,
            organizationId,
            workspaceId: null,
            role: "owner",
            status: "active",
          });
          return { user, organizationId, workspaceId };
        });
      });
    },
  };
}
