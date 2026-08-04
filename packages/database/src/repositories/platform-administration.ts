import { eq } from "drizzle-orm";
import { db } from "../client.js";
import { users } from "../schema.js";

export function createPlatformAdministrationRepository() {
  return {
    async isPlatformAdmin(userId: string) {
      const [user] = await db
        .select({ isPlatformAdmin: users.isPlatformAdmin })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      return user?.isPlatformAdmin === true;
    },
  };
}
