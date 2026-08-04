import { desc, eq } from "drizzle-orm";
import { db } from "../client.js";
import { invoices } from "../schema.js";
import { assertTenantContext, type DatabaseTenantContext } from "../tenant-context.js";

export function createInvoicesRepository(context: DatabaseTenantContext) {
  assertTenantContext(context);
  return {
    list() {
      return db
        .select()
        .from(invoices)
        .where(eq(invoices.organizationId, context.organizationId))
        .orderBy(desc(invoices.createdAt));
    },
  };
}
