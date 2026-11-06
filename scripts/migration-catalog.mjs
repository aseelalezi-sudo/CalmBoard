import { canonicalJson, digest } from "./migration-baseline.mjs";

export const structureSql = `
select 'table'::text as kind, c.relname::text as key, jsonb_build_object('rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,'kind',c.relkind) as definition
from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p')
union all
select 'column',c.relname||'.'||a.attname,jsonb_build_object('type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid),'identity',a.attidentity,'generated',a.attgenerated)
from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
where n.nspname='public' and c.relkind in ('r','p') and a.attnum>0 and not a.attisdropped
union all
select 'constraint',c.relname||'/'||con.conname||'/'||con.contype::text||'/'||md5(pg_get_constraintdef(con.oid,true)),to_jsonb(pg_get_constraintdef(con.oid,true))
from pg_constraint con join pg_class c on c.oid=con.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'
union all
select 'index',i.relname,to_jsonb(pg_get_indexdef(i.oid,0,true)) from pg_index ix join pg_class i on i.oid=ix.indexrelid join pg_namespace n on n.oid=i.relnamespace where n.nspname='public'
union all
select 'function',p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',to_jsonb(pg_get_functiondef(p.oid))
from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind in ('f','p')
union all
select 'trigger',c.relname||'/'||t.tgname,to_jsonb(pg_get_triggerdef(t.oid,true))
from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal
union all
select 'enum',t.typname,to_jsonb(array_agg(e.enumlabel order by e.enumsortorder)) from pg_type t join pg_enum e on e.enumtypid=t.oid join pg_namespace n on n.oid=t.typnamespace where n.nspname='public' group by t.typname
union all
select 'policy',c.relname||'/'||p.polname,jsonb_build_object('command',p.polcmd,'permissive',p.polpermissive,'roles',p.polroles::text,'using',pg_get_expr(p.polqual,p.polrelid),'check',pg_get_expr(p.polwithcheck,p.polrelid))
from pg_policy p join pg_class c on c.oid=p.polrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'
union all
select 'view',c.relname,to_jsonb(pg_get_viewdef(c.oid,true)) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('v','m')
order by kind,key`;

const reviewedFunctions = {
  "function:validate_goal_child_scope()": {
    actual: "f016731dde43df4d59426efafd190d6f10c09b404161a8d1b9e3c51229203ef4",
    expected: "607c0d73ddf644e5e5629537c6082f0ceff5037a6f1e630252ad54cf7a1ff016",
  },
  "function:validate_goal_task_scope()": {
    actual: "06d823a0486c71170868bd8e39d0f32f8b1cf9ac36b3e9141091d6803e7fd27e",
    expected: "82515b140155fb2626b2d52f1fee26fd8dfb68e39ef4db285c376de8a9ec5128",
  },
};

export async function readCatalog(client) {
  const result = await client.query(structureSql);
  if (result.fields[1].dataTypeID !== 25)
    throw new Error("Catalog keys must be PostgreSQL text, never truncated names.");
  if (new Set(result.rows.map(({ kind, key }) => `${kind}:${key}`)).size !== result.rows.length)
    throw new Error("Duplicate catalog keys.");
  return result.rows;
}

export function compareReviewedCatalog(actual, expected) {
  const map = (rows) => new Map(rows.map((row) => [`${row.kind}:${row.key}`, row.definition]));
  const left = map(actual),
    right = map(expected);
  const reviewed = [];
  for (const key of new Set([...left.keys(), ...right.keys()])) {
    const a = left.get(key),
      e = right.get(key);
    if (canonicalJson(a) === canonicalJson(e)) continue;
    const known = reviewedFunctions[key];
    if (!known || a === undefined || e === undefined || digest(a) !== known.actual || digest(e) !== known.expected)
      throw new Error(`Unreviewed catalog difference: ${key}.`);
    reviewed.push(key);
  }
  return {
    actualObjects: actual.length,
    expectedObjects: expected.length,
    actualDigest: digest(actual),
    expectedDigest: digest(expected),
    reviewed,
  };
}
