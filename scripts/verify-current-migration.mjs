import "dotenv/config";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";

const { Client, Pool } = pg;
const sourceUrl = process.env.DATABASE_URL;
if (!sourceUrl) throw new Error("DATABASE_URL is required to verify a current database copy.");

const journal = JSON.parse(await readFile(resolve("packages/database/migrations/meta/_journal.json"), "utf8"));
const baselineSnapshot = JSON.parse(
  await readFile(resolve("packages/database/migrations/meta/0000_snapshot.json"), "utf8"),
);
const expectedBaselineTables = Object.keys(baselineSnapshot.tables)
  .map((table) => table.replace(/^public\./, ""))
  .sort();
const expectedBaselineColumns = Object.values(baselineSnapshot.tables)
  .flatMap((table) => Object.values(table.columns).map((column) => `${table.name}.${column.name}`))
  .sort();
const baselineEntry = journal.entries[0];
assert.equal(baselineEntry?.tag, "0000_baseline");

const source = new URL(sourceUrl);
const sourceDatabase = decodeURIComponent(source.pathname.slice(1));
if (!sourceDatabase || ["postgres", "template0", "template1"].includes(sourceDatabase)) {
  throw new Error("Refusing to clone a PostgreSQL administrative or template database.");
}

const copyDatabase = `calmboard_current_check_${process.pid}_${Date.now()}`;
if (!/^calmboard_current_check_\d+_\d+$/.test(copyDatabase)) {
  throw new Error("Refusing to use an unexpected temporary database name.");
}

const quoteIdentifier = (value) => `"${value.replaceAll('"', '""')}"`;
const adminUrl = new URL(sourceUrl);
adminUrl.pathname = "/postgres";
const copyUrl = new URL(sourceUrl);
copyUrl.pathname = `/${copyDatabase}`;
const admin = new Client({ connectionString: adminUrl.toString() });
let adminConnected = false;
let copy;

function run(command, args, env) {
  const result = spawnSync(command, args, { cwd: process.cwd(), env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${args.join(" ")} exited with ${result.status}.`);
}

try {
  await admin.connect();
  adminConnected = true;
  await admin.query(
    `CREATE DATABASE ${quoteIdentifier(copyDatabase)} WITH TEMPLATE ${quoteIdentifier(sourceDatabase)}`,
  );

  copy = new Pool({ connectionString: copyUrl.toString() });
  const existingJournal = await copy.query(`select to_regclass('drizzle.__drizzle_migrations') is not null as exists`);
  const journalExists = existingJournal.rows[0]?.exists === true;
  const existingMigrationCount = journalExists
    ? Number((await copy.query(`select count(*)::int as count from drizzle.__drizzle_migrations`)).rows[0]?.count ?? 0)
    : 0;
  if (!journalExists || existingMigrationCount === 0) {
    const currentTables = await copy.query(
      `select table_name
       from information_schema.tables
       where table_schema = 'public' and table_type = 'BASE TABLE'
       order by table_name`,
    );
    assert.deepEqual(
      currentTables.rows.map((row) => row.table_name),
      expectedBaselineTables,
      "An untracked current database must match the 0000 baseline table set exactly before adoption.",
    );

    const readCurrentColumns = async () => {
      const result = await copy.query(
        `select table_name, column_name
         from information_schema.columns
         where table_schema = 'public'
         order by table_name, ordinal_position`,
      );
      return result.rows.map((row) => `${row.table_name}.${row.column_name}`).sort();
    };
    const currentColumns = await readCurrentColumns();
    const missingColumns = expectedBaselineColumns.filter((column) => !currentColumns.includes(column));
    const extraColumns = currentColumns.filter((column) => !expectedBaselineColumns.includes(column));
    assert.deepEqual(extraColumns, [], "The legacy database has columns outside the approved 0000 baseline.");
    assert.ok(
      missingColumns.length === 0 || (missingColumns.length === 1 && missingColumns[0] === "users.skills"),
      `The legacy-to-baseline bridge found unsupported missing columns: ${missingColumns.join(", ")}`,
    );
    if (missingColumns.length === 1) {
      await copy.query(`alter table public.users add column skills jsonb not null default '[]'::jsonb`);
    }
    assert.deepEqual(
      await readCurrentColumns(),
      expectedBaselineColumns,
      "The adopted database columns must match the 0000 baseline exactly.",
    );

    const baselineSql = await readFile(resolve("packages/database/migrations/0000_baseline.sql"), "utf8");
    const baselineHash = createHash("sha256").update(baselineSql).digest("hex");
    await copy.query("create schema if not exists drizzle");
    await copy.query(
      `create table if not exists drizzle.__drizzle_migrations (
         id serial primary key,
         hash text not null,
         created_at bigint
       )`,
    );
    await copy.query(`insert into drizzle.__drizzle_migrations (hash, created_at) values ($1, $2)`, [
      baselineHash,
      baselineEntry.when,
    ]);
  }
  await copy.end();
  copy = undefined;

  const migrationEnvironment = {
    ...process.env,
    DATABASE_URL: copyUrl.toString(),
    DATABASE_APP_URL: copyUrl.toString(),
  };
  run(process.execPath, [resolve("scripts/database-command.mjs"), "migrate"], migrationEnvironment);

  const pnpmCli = process.env.npm_execpath;
  run(
    pnpmCli ? process.execPath : "pnpm",
    pnpmCli
      ? [pnpmCli, "--filter", "@calmboard/database", "test:integration"]
      : ["--filter", "@calmboard/database", "test:integration"],
    migrationEnvironment,
  );
  run(
    pnpmCli ? process.execPath : "pnpm",
    pnpmCli
      ? [pnpmCli, "--filter", "@calmboard/api", "test:integration"]
      : ["--filter", "@calmboard/api", "test:integration"],
    migrationEnvironment,
  );

  copy = new Pool({ connectionString: copyUrl.toString() });
  const migratedState = await copy.query(
    `select
       (select count(*)::int from information_schema.tables
        where table_schema = 'public' and table_type = 'BASE TABLE') as table_count,
       (select count(*)::int from drizzle.__drizzle_migrations) as migration_count`,
  );
  assert.deepEqual(migratedState.rows[0], {
    table_count: 79,
    migration_count: journal.entries.length,
  });
  console.log(
    `Verified a copy of ${sourceDatabase}: adopted the exact baseline when needed, applied ${journal.entries.length} migrations, preserved the source database, and passed tenant and authentication integration tests.`,
  );
} finally {
  if (copy) await copy.end();
  if (adminConnected) {
    await admin.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(copyDatabase)} WITH (FORCE)`);
    await admin.end();
  }
}
