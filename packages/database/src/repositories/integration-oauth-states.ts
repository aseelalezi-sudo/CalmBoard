import { createHash } from "node:crypto";
import { and, eq, gt, isNotNull, isNull, lt, or } from "drizzle-orm";
import { db } from "../client.js";
import { integrationOauthStates } from "../schema.js";

export type IntegrationOAuthProvider = "github" | "slack" | "gcal" | "microsoft";

export function hashIntegrationOAuthState(state: string) {
  return createHash("sha256").update(state).digest("hex");
}

export function createIntegrationOAuthStateRepository() {
  return {
    async createState(provider: IntegrationOAuthProvider, state: string, expiresAt: Date, requestedIp?: string) {
      const now = new Date();
      await db
        .delete(integrationOauthStates)
        .where(or(lt(integrationOauthStates.expiresAt, now), isNotNull(integrationOauthStates.consumedAt)));
      const [record] = await db
        .insert(integrationOauthStates)
        .values({ provider, stateHash: hashIntegrationOAuthState(state), expiresAt, requestedIp })
        .returning({ id: integrationOauthStates.id, expiresAt: integrationOauthStates.expiresAt });
      return record;
    },

    async consumeState(provider: IntegrationOAuthProvider, state: string) {
      const now = new Date();
      const [record] = await db
        .update(integrationOauthStates)
        .set({ consumedAt: now })
        .where(
          and(
            eq(integrationOauthStates.provider, provider),
            eq(integrationOauthStates.stateHash, hashIntegrationOAuthState(state)),
            isNull(integrationOauthStates.consumedAt),
            gt(integrationOauthStates.expiresAt, now),
          ),
        )
        .returning({ id: integrationOauthStates.id });
      return record ?? null;
    },
  };
}
