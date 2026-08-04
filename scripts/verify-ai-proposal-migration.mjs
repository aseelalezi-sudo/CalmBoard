import pg from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
try {
  const result = await client.query(`
    select
      (select count(*)::int
       from information_schema.tables
       where table_schema = 'public' and table_type = 'BASE TABLE') as table_count,
      (select count(*)::int from drizzle.__drizzle_migrations) as migration_count,
      (select relrowsecurity and relforcerowsecurity
       from pg_class
       where oid = 'public.ai_action_proposals'::regclass) as rls_forced,
      (select count(*)::int
       from pg_policies
       where schemaname = 'public'
         and tablename = 'ai_action_proposals'
         and policyname = 'tenant_isolation') as policy_count
  `);
  const state = result.rows[0];
  const expected = { table_count: 79, migration_count: 55, rls_forced: true, policy_count: 1 };
  for (const [field, value] of Object.entries(expected)) {
    if (state?.[field] !== value) {
      throw new Error(
        `Unexpected AI proposal migration state for ${field}: expected ${value}, received ${state?.[field]}`,
      );
    }
  }
  console.log("AI proposal migration, RLS, and journal state are valid.");
} finally {
  await client.end();
}
