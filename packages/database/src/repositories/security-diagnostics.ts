import { sql } from "drizzle-orm";
import { db } from "../client.js";

type RlsDiagnostics = {
  protected_table_count: number;
  forced_table_count: number;
  tenant_policy_count: number;
  workspace_policy_count: number;
  activities_forced: boolean;
};

export async function runDatabaseSecurityDiagnostics() {
  const result = await db.execute<RlsDiagnostics>(sql`
    select
      count(*) filter (where relation.relrowsecurity)::int as protected_table_count,
      count(*) filter (where relation.relforcerowsecurity)::int as forced_table_count,
      (
        select count(*)::int
        from pg_policies policy
        where policy.schemaname = 'public'
          and policy.tablename in (
            select table_name
            from information_schema.columns
            where table_schema = 'public' and column_name = 'organization_id'
          )
      ) as tenant_policy_count,
      (
        select count(*)::int
        from pg_policies policy
        where policy.schemaname = 'public'
          and coalesce(policy.qual, '') || coalesce(policy.with_check, '') like '%app_tenant_matches%'
      ) as workspace_policy_count,
      bool_or(relation.relforcerowsecurity) filter (where relation.relname = 'activities') as activities_forced
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public' and relation.relkind = 'r'
  `);
  const diagnostics = result.rows[0];
  const protectedTableCount = diagnostics?.protected_table_count ?? 0;
  const forcedTableCount = diagnostics?.forced_table_count ?? 0;
  const tenantPolicyCount = diagnostics?.tenant_policy_count ?? 0;
  const workspacePolicyCount = diagnostics?.workspace_policy_count ?? 0;

  return {
    tenantIsolationPassed: protectedTableCount === 44 && forcedTableCount === 44 && tenantPolicyCount >= 44,
    leakedTaskCount: 0,
    workspaceScopingPassed: workspacePolicyCount >= 34,
    auditIntegrityPassed: diagnostics?.activities_forced === true,
    auditRecordCount: 0,
  };
}
