import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "../client.js";
import { branches } from "../schema.js";
import { assertTenantContext, type DatabaseTenantContext } from "../tenant-context.js";

export type CreateBranchInput = Pick<typeof branches.$inferInsert, "name" | "code" | "city" | "address">;

export function createBranchesRepository(context: DatabaseTenantContext) {
  assertTenantContext(context);
  const { organizationId } = context;
  return {
    list() {
      return db
        .select()
        .from(branches)
        .where(and(eq(branches.organizationId, organizationId), isNull(branches.deletedAt)))
        .orderBy(desc(branches.createdAt));
    },
    async create(input: CreateBranchInput) {
      const [branch] = await db
        .insert(branches)
        .values({ ...input, organizationId })
        .returning();
      return branch;
    },
  };
}
