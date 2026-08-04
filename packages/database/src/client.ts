import { AsyncLocalStorage } from "node:async_hooks";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { Pool } from "pg";
import * as schema from "./schema.js";
import { assertTenantContext, type DatabaseTenantContext } from "./tenant-context.js";

function readDatabaseUrl() {
  const databaseUrl = process.env.DATABASE_APP_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_APP_URL or DATABASE_URL is required");
  }
  return databaseUrl;
}

const globalForDb = globalThis as typeof globalThis & {
  __calmboardPostgresPool?: Pool;
};

export const pool =
  globalForDb.__calmboardPostgresPool ??
  new Pool({
    connectionString: readDatabaseUrl(),
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__calmboardPostgresPool = pool;
}

const baseDb = drizzle(pool, { schema });
export type DatabaseClient = typeof baseDb;
type TransactionClient = Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0];

export type DatabaseRequestContext = {
  organizationId?: string;
  workspaceId?: string;
  actorId?: string;
};

type TenantTransactionStore = {
  client: TransactionClient;
  context: DatabaseRequestContext;
};

const tenantTransactionStorage = new AsyncLocalStorage<TenantTransactionStore>();

function activeClient(): DatabaseClient | TransactionClient {
  return tenantTransactionStorage.getStore()?.client ?? baseDb;
}

/**
 * Database facade that automatically delegates repository calls to the tenant
 * transaction attached to the current asynchronous request.
 */
export const db = new Proxy(baseDb, {
  get(_target, property) {
    const client = activeClient();
    const value = Reflect.get(client, property, client) as unknown;
    return typeof value === "function" ? value.bind(client) : value;
  },
});

export function currentDatabaseTenantContext() {
  return tenantTransactionStorage.getStore()?.context;
}

export async function withTenantTransaction<T>(
  context: DatabaseTenantContext,
  operation: () => Promise<T>,
): Promise<T> {
  assertTenantContext(context);
  return withDatabaseContext(context, operation);
}

export async function withDatabaseContext<T>(context: DatabaseRequestContext, operation: () => Promise<T>): Promise<T> {
  if (!context.organizationId && !context.actorId) {
    throw new Error("organizationId or actorId is required for database access");
  }
  const active = tenantTransactionStorage.getStore();
  if (active) {
    if (
      (context.organizationId && active.context.organizationId !== context.organizationId) ||
      (context.workspaceId && active.context.workspaceId !== context.workspaceId) ||
      (context.actorId && active.context.actorId !== context.actorId)
    ) {
      throw new Error("Cannot change tenant context inside an active database transaction");
    }
    return operation();
  }

  // A tenant request intentionally owns one PostgreSQL connection so the
  // transaction-local RLS settings apply to every query. Database operations
  // inside `operation` must therefore be awaited sequentially; overlapping
  // queries on one PoolClient are deprecated in pg 8 and rejected by pg 9.
  return baseDb.transaction(async (transaction) => {
    await transaction.execute(sql`
      select
        set_config('app.organization_id', ${context.organizationId ?? ""}, true),
        set_config('app.workspace_id', ${context.workspaceId ?? ""}, true),
        set_config('app.actor_id', ${context.actorId ?? ""}, true)
    `);
    return tenantTransactionStorage.run({ client: transaction, context }, operation);
  });
}
