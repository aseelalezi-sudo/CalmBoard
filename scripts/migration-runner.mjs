import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { readDevelopmentBaseline } from "./migration-baseline.mjs";

export const MIGRATION_LOCK_KEYS = [0x43414c4d, 0x4d494752];
export const defaultMigrationsDirectory = fileURLToPath(new URL("../packages/database/migrations/", import.meta.url));

// Recovered byte-for-byte from API image
// sha256:868db360486032a4be38f760eb44351618cbec9694d004249e532574b3ae2b5b.
// Only two trailing spaces outside SQL literals and the EOF newline differ.
// Pin both versions; never normalize arbitrary SQL or rewrite recorded hashes.
// See docs/migration-history-review-2026-11-05.md.
const reviewedHistoricalHashes = {
  "0058_sprints_permissions": {
    current: "804f522f1029602b916ddbb9250e03c97e78c4379e03d7c9104b528eaf3b0508",
    historical: "e3a9191d82aeccd01a2ea08772e3854d8ed697235676719e1c295baa6796c307",
  },
};

function matchesMigrationHash(migration, hash) {
  if (hash === migration.hash) return true;
  const reviewed = reviewedHistoricalHashes[migration.tag];
  return reviewed?.current === migration.hash && reviewed.historical === hash;
}

export function migrationLockTimeout(value = "60000") {
  if (!/^\d+$/.test(String(value)) || Number(value) < 1 || Number(value) > 600000) {
    throw new Error("MIGRATION_LOCK_TIMEOUT_MS must be an integer between 1 and 600000.");
  }
  return Number(value);
}

export async function loadMigrations(directory = defaultMigrationsDirectory) {
  const journal = JSON.parse(await readFile(resolve(directory, "meta/_journal.json"), "utf8"));
  if (
    journal.version !== "7" ||
    journal.dialect !== "postgresql" ||
    !Array.isArray(journal.entries) ||
    !journal.entries.length
  ) {
    throw new Error("Expected a nonempty PostgreSQL v7 migration journal.");
  }
  const timestamps = new Set();
  let highWater = 0;
  const migrations = [];
  for (const [index, entry] of journal.entries.entries()) {
    if (
      entry.idx !== index ||
      typeof entry.tag !== "string" ||
      !/^\d{4,}_[a-z0-9_]+$/.test(entry.tag) ||
      !entry.tag.startsWith(`${String(index).padStart(4, "0")}_`)
    ) {
      throw new Error(`Invalid migration journal index or tag at position ${index}.`);
    }
    if (!Number.isSafeInteger(entry.when) || entry.when <= 0 || timestamps.has(entry.when)) {
      throw new Error(`Invalid or duplicate migration timestamp for ${entry.tag}.`);
    }
    // Published metadata is immutable. This one known inversion is handled by
    // journal index, never by the maximum timestamp of applied migrations.
    const historicalInversion =
      entry.idx === 52 &&
      entry.tag === "0052_integration_webhook_replay" &&
      entry.when === 1785579322146 &&
      journal.entries[index - 1]?.tag === "0051_integration_oauth_connections" &&
      journal.entries[index - 1]?.when === 1785584400000;
    if (entry.when <= highWater && !historicalInversion) {
      throw new Error(`Migration timestamp does not advance the journal high-water mark: ${entry.tag}.`);
    }
    highWater = Math.max(highWater, entry.when);
    timestamps.add(entry.when);
    const bytes = await readFile(resolve(directory, `${entry.tag}.sql`));
    const content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    const statements = content
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter(Boolean);
    if (!statements.length) throw new Error(`Migration SQL is empty: ${entry.tag}.`);
    migrations.push({ ...entry, hash: createHash("sha256").update(bytes).digest("hex"), statements });
  }
  return migrations;
}

export class MigrationHistoryError extends Error {
  constructor(issues) {
    super(
      `Migration history verification failed; no migrations were applied:\n${issues.map((issue) => `- ${issue}`).join("\n")}`,
    );
    this.name = "MigrationHistoryError";
    this.issues = issues;
  }
}

export function pendingMigrations(migrations, rows, baselineExceptions = []) {
  const byTimestamp = new Map(migrations.map((migration) => [String(migration.when), migration]));
  const applied = new Set();
  const issues = [];
  for (const row of rows) {
    const timestamp = String(row.created_at);
    const migration = byTimestamp.get(timestamp);
    if (!migration) {
      issues.push(
        `Unknown applied migration timestamp ${timestamp}; this checkout cannot safely migrate this database.`,
      );
      continue;
    }
    if (applied.has(timestamp)) issues.push(`Duplicate history entry for ${migration.tag}.`);
    applied.add(timestamp);
    if (
      !matchesMigrationHash(migration, row.hash) &&
      !baselineExceptions.some(
        (entry) => entry.tag === migration.tag && entry.current === migration.hash && entry.historical === row.hash,
      )
    )
      issues.push(
        `Hash mismatch for ${migration.tag}; recover and review the originally applied SQL. Do not overwrite the recorded hash.`,
      );
  }
  const firstMissing = migrations.findIndex((migration) => !applied.has(String(migration.when)));
  const prefixLength = firstMissing < 0 ? migrations.length : firstMissing;
  if (migrations.slice(prefixLength).some((migration) => applied.has(String(migration.when)))) {
    issues.push(
      `Applied history has a gap at ${migrations[prefixLength].tag}; a contiguous journal prefix is required.`,
    );
  }
  if (issues.length) throw new MigrationHistoryError(issues);
  return migrations.slice(prefixLength);
}

export async function withMigrationLock({ connectionString, lockTimeoutMs = 60000, log = console.log }, operation) {
  if (!connectionString) throw new Error("DATABASE_URL is required to run migrations.");
  const timeout = migrationLockTimeout(lockTimeoutMs);
  const client = new pg.Client({
    connectionString,
    connectionTimeoutMillis: 10000,
    application_name: "calmboard-migrator",
  });
  let connected = false;
  let locked = false;
  try {
    await client.connect();
    connected = true;
    const previous = (await client.query("show lock_timeout")).rows[0].lock_timeout;
    await client.query("select set_config('lock_timeout', $1, false)", [`${timeout}ms`]);
    log("Waiting for the database migration lock...");
    try {
      await client.query("select pg_advisory_lock($1::integer, $2::integer)", MIGRATION_LOCK_KEYS);
      locked = true;
    } catch (error) {
      if (error.code === "55P03")
        throw new Error(`Migration lock was not acquired within ${timeout}ms; another migrator may be running.`, {
          cause: error,
        });
      throw error;
    }
    await client.query("select set_config('lock_timeout', $1, false)", [previous]);
    log("Database migration lock acquired.");
    return await operation(client);
  } finally {
    // A session lock must be released on this exact connection, including failures.
    try {
      if (connected && locked)
        await client.query("select pg_advisory_unlock($1::integer, $2::integer)", MIGRATION_LOCK_KEYS);
    } finally {
      await client.end();
    }
  }
}

export async function migrateDatabase({
  connectionString,
  directory = defaultMigrationsDirectory,
  lockTimeoutMs = 60000,
  checkOnly = false,
  environment = (process.env.DEPLOY_ENV ?? process.env.APP_ENV ?? process.env.NODE_ENV ?? "development")
    .trim()
    .toLowerCase(),
  log = console.log,
}) {
  // Freeze SQL with its hash before connecting; a baseline never bypasses this.
  const migrations = await loadMigrations(directory);
  return withMigrationLock({ connectionString, lockTimeoutMs, log }, async (client) => {
    const present = (await client.query("select to_regclass('drizzle.__drizzle_migrations') is not null as present"))
      .rows[0].present;
    const rows = present
      ? (await client.query("select id, hash, created_at from drizzle.__drizzle_migrations order by id")).rows
      : [];
    const exceptions = await readDevelopmentBaseline(client, { migrations, rows, environment });
    const pending = pendingMigrations(migrations, rows, exceptions);
    if (exceptions.length) log("Verified database-bound development baseline; original historical hashes preserved.");
    for (const row of rows) {
      const entry = migrations.find((migration) => String(migration.when) === String(row.created_at));
      if (row.hash !== entry.hash)
        log(
          exceptions.some((exception) => exception.tag === entry.tag)
            ? `Accepted explicitly adopted development history for ${entry.tag}; original SQL remains unavailable; recorded hash preserved.`
            : `Verified reviewed historical hash for ${entry.tag}; recorded hash preserved.`,
        );
    }
    if (!rows.length) {
      const tables = await client.query(
        "select count(*)::int as count from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'",
      );
      if (tables.rows[0].count !== 0)
        throw new MigrationHistoryError([
          "The public schema contains untracked tables. Baseline adoption requires an explicit reviewed process.",
        ]);
    }
    log(`Verified ${rows.length} applied migration hashes; ${pending.length} pending.`);
    if (checkOnly) return { applied: rows.length, pending: pending.length, executed: 0 };
    if (!present) {
      await client.query("begin");
      try {
        await client.query("create schema if not exists drizzle");
        await client.query(
          "create table drizzle.__drizzle_migrations (id serial primary key, hash text not null, created_at bigint)",
        );
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw error;
      }
    }
    for (const migration of pending) {
      log(`Applying migration: ${migration.tag}...`);
      await client.query("begin");
      try {
        for (const statement of migration.statements) await client.query(statement);
        await client.query("insert into drizzle.__drizzle_migrations (hash, created_at) values ($1, $2)", [
          migration.hash,
          migration.when,
        ]);
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw new Error(
          `Migration ${migration.tag} failed${error.code ? ` (SQLSTATE ${error.code})` : ""}; its transaction was rolled back.`,
          { cause: error },
        );
      }
    }
    log(`Migrations verified and applied successfully (${pending.length} executed).`);
    return { applied: rows.length + pending.length, pending: 0, executed: pending.length };
  });
}
