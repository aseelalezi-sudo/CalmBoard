import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db, withTenantTransaction } from "../client.js";
import { memberships, organizations, users, workspaces } from "../schema.js";

export type PublicAuthUser = Pick<
  typeof users.$inferSelect,
  "id" | "email" | "name" | "avatarUrl" | "locale" | "theme" | "emailVerifiedAt" | "lifecycleState"
>;

export type RegisterIdentityInput = {
  email: string;
  name: string;
  passwordHash: string;
  organizationName: string;
  workspaceName: string;
};

const publicUserSelection = {
  id: users.id,
  email: users.email,
  name: users.name,
  avatarUrl: users.avatarUrl,
  locale: users.locale,
  theme: users.theme,
  emailVerifiedAt: users.emailVerifiedAt,
  lifecycleState: users.lifecycleState,
};

export function createAuthIdentityRepository() {
  return {
    async findByEmail(email: string) {
      const [identity] = await db
        .select({
          ...publicUserSelection,
          passwordHash: users.passwordHash,
          failedLoginAttempts: users.failedLoginAttempts,
          lockedUntil: users.lockedUntil,
        })
        .from(users)
        .where(eq(users.email, email.toLowerCase()))
        .limit(1);
      return identity ?? null;
    },

    async findPublicUser(userId: string) {
      const [user] = await db.select(publicUserSelection).from(users).where(eq(users.id, userId)).limit(1);
      return user ?? null;
    },

    async findForReauthentication(userId: string) {
      const [identity] = await db
        .select({ id: users.id, passwordHash: users.passwordHash, lifecycleState: users.lifecycleState })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      return identity ?? null;
    },

    async recordLoginFailure(userId: string) {
      const now = new Date();
      const oneMinute = new Date(now.getTime() + 60_000);
      const fiveMinutes = new Date(now.getTime() + 5 * 60_000);
      const fifteenMinutes = new Date(now.getTime() + 15 * 60_000);
      const oneHour = new Date(now.getTime() + 60 * 60_000);
      const oneDay = new Date(now.getTime() + 24 * 60 * 60_000);
      const [state] = await db
        .update(users)
        .set({
          failedLoginAttempts: sql`${users.failedLoginAttempts} + 1`,
          lastFailedLoginAt: now,
          lockedUntil: sql`case
            when ${users.failedLoginAttempts} + 1 >= 9 then cast(${oneDay} as timestamptz)
            when ${users.failedLoginAttempts} + 1 = 8 then cast(${oneHour} as timestamptz)
            when ${users.failedLoginAttempts} + 1 = 7 then cast(${fifteenMinutes} as timestamptz)
            when ${users.failedLoginAttempts} + 1 = 6 then cast(${fiveMinutes} as timestamptz)
            when ${users.failedLoginAttempts} + 1 = 5 then cast(${oneMinute} as timestamptz)
            else null
          end`,
          updatedAt: now,
        })
        .where(eq(users.id, userId))
        .returning({ failedLoginAttempts: users.failedLoginAttempts, lockedUntil: users.lockedUntil });
      return state ?? null;
    },

    async recordLoginSuccess(userId: string) {
      const now = new Date();
      await db
        .update(users)
        .set({ failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: now, updatedAt: now })
        .where(eq(users.id, userId));
    },

    async register(input: RegisterIdentityInput) {
      const userId = randomUUID();
      const organizationId = randomUUID();
      const workspaceId = randomUUID();
      const suffix = organizationId.slice(0, 8);
      const organizationSlug = `org-${suffix}`;
      const workspaceSlug = `workspace-${suffix}`;

      return withTenantTransaction({ organizationId, workspaceId, actorId: userId }, async () => {
        return db.transaction(async (transaction) => {
          const [user] = await transaction
            .insert(users)
            .values({
              id: userId,
              email: input.email.toLowerCase(),
              name: input.name,
              passwordHash: input.passwordHash,
            })
            .returning(publicUserSelection);
          await transaction.insert(organizations).values({
            id: organizationId,
            name: input.organizationName,
            slug: organizationSlug,
            ownerId: userId,
          });
          await transaction.insert(workspaces).values({
            id: workspaceId,
            organizationId,
            name: input.workspaceName,
            slug: workspaceSlug,
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
