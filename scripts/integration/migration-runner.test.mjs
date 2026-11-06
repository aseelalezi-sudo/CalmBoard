import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { copyFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import pg from "pg";
import {
  defaultMigrationsDirectory,
  loadMigrations,
  migrateDatabase,
  MIGRATION_LOCK_KEYS,
  MigrationHistoryError,
} from "../migration-runner.mjs";
import { migrationFixture } from "../testing/migration-fixtures.mjs";
import { baselineTestReceipt, exerciseDevelopmentBaseline } from "../testing/development-baseline-scenarios.mjs";
import { adoptDevelopmentBaseline, withReferenceCatalog } from "../adopt-development-baseline.mjs";
import { BASELINE_TABLE, DEVELOPMENT_HASH_EXCEPTIONS } from "../migration-baseline.mjs";

const quiet = () => {};
const quoteIdentifier = (value) => `"${value.replaceAll('"', '""')}"`;

test(
  "an explicit development baseline preserves history, refuses drift and other databases, and supports future upgrades",
  { timeout: 120000 },
  async () => {
    await withDatabase(async ({ client, connectionString }) => {
      await migrateDatabase({ connectionString, log: quiet });
      const migrations = await loadMigrations();
      // Model the two unknown historical records only inside this disposable database.
      for (const entry of DEVELOPMENT_HASH_EXCEPTIONS)
        await client.query("update drizzle.__drizzle_migrations set hash=$1 where created_at=$2", [
          entry.historical,
          migrations.find((migration) => migration.tag === entry.tag).when,
        ]);
      await assert.rejects(migrateDatabase({ connectionString, checkOnly: true, log: quiet }), /Hash mismatch/);
      const receipt = await baselineTestReceipt(client);
      const result = await withReferenceCatalog(connectionString, async (referenceCatalog) => {
        const writer = new pg.Client({ connectionString });
        const id = randomUUID();
        await writer.connect();
        await client.query("begin isolation level repeatable read read only");
        const snapshotId = (await client.query("select pg_export_snapshot() as id")).rows[0].id;
        const options = {
          connectionString,
          receipt,
          referenceCatalog,
          receiptDigest: "e".repeat(64),
          reason: "Isolated exported snapshot verification",
          log: quiet,
        };
        try {
          await writer.query("insert into users (id,email,name) values ($1,$2,'Concurrent application writer')", [
            id,
            `${id}@example.test`,
          ]);
          await assert.rejects(adoptDevelopmentBaseline(options), /contents differ/);
          assert.equal((await adoptDevelopmentBaseline({ ...options, snapshotId })).adopted, false);
          await assert.rejects(
            adoptDevelopmentBaseline({ ...options, snapshotId: "unsafe';select 1" }),
            /Invalid exported/,
          );
          const first = receipt.history[0];
          await writer.query("update drizzle.__drizzle_migrations set hash=$1 where id=$2", ["f".repeat(64), first.id]);
          await assert.rejects(
            adoptDevelopmentBaseline({ ...options, snapshotId }),
            /history changed after the backup/,
          );
          await writer.query("update drizzle.__drizzle_migrations set hash=$1 where id=$2", [first.hash, first.id]);
        } finally {
          await client.query("rollback");
          await writer.query("delete from users where id=$1", [id]);
          await writer.end();
        }
        return exerciseDevelopmentBaseline({ connectionString, receipt, referenceCatalog });
      });
      assert.equal(result.futureMigrationAppliedOnce, true);
      await withDatabase(async ({ client: other, connectionString: otherUrl }) => {
        await other.query("create schema drizzle");
        await other.query(`create table ${BASELINE_TABLE} (document jsonb, document_hash text)`);
        await other.query(`insert into ${BASELINE_TABLE} values ($1,$2)`, [
          JSON.stringify(result.baselineDocument),
          result.baselineDocumentHash,
        ]);
        await assert.rejects(
          migrateDatabase({ connectionString: otherUrl, checkOnly: true, log: quiet }),
          /another database identity/,
        );
      });
    });
  },
);

async function withDatabase(operation) {
  if (!process.env.DATABASE_URL)
    throw new Error("DATABASE_URL with CREATEDB permission is required for migration integration tests.");
  const name = `calmboard_migrator_test_${process.pid}_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
  const adminUrl = new URL(process.env.DATABASE_URL);
  adminUrl.pathname = "/postgres";
  const targetUrl = new URL(process.env.DATABASE_URL);
  targetUrl.pathname = `/${name}`;
  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  const client = new pg.Client({ connectionString: targetUrl.toString() });
  let created = false;
  try {
    await admin.connect();
    await admin.query(`create database ${quoteIdentifier(name)}`);
    created = true;
    await client.connect();
    return await operation({ client, connectionString: targetUrl.toString() });
  } finally {
    await client.end();
    try {
      if (created) {
        assert.match(name, /^calmboard_migrator_test_\d+_[a-f0-9]{16}$/);
        await admin.query(`drop database ${quoteIdentifier(name)} with (force)`);
      }
    } finally {
      await admin.end();
    }
  }
}

test("two concurrent migrators serialize bootstrap and execute each migration once", { timeout: 30000 }, async (t) => {
  const fixture = await migrationFixture([
    "create table migration_effects (step integer primary key); insert into migration_effects values (0); select pg_sleep(0.3);",
    "insert into migration_effects values (1);",
  ]);
  t.after(() => fixture.cleanup());
  await withDatabase(async ({ client, connectionString }) => {
    let started;
    const running = new Promise((resolve) => {
      started = resolve;
    });
    const order = [];
    const first = migrateDatabase({
      connectionString,
      directory: fixture.directory,
      log: (message) => {
        if (message.startsWith("Applying migration")) started();
        if (message.startsWith("Migrations verified")) order.push("first completed");
      },
    });
    await running;
    const second = migrateDatabase({
      connectionString,
      directory: fixture.directory,
      log: (message) => {
        if (message === "Database migration lock acquired.") order.push("second acquired");
      },
    });
    const results = await Promise.all([first, second]);
    assert.deepEqual(
      results.map((result) => result.executed),
      [2, 0],
    );
    assert.deepEqual(order, ["first completed", "second acquired"]);
    assert.deepEqual((await client.query("select step from migration_effects order by step")).rows, [
      { step: 0 },
      { step: 1 },
    ]);
    assert.equal(
      (await client.query("select count(*)::int as count from drizzle.__drizzle_migrations")).rows[0].count,
      2,
    );
  });
});

test("lock timeout leaves no schema changes and the lock is available after release", { timeout: 30000 }, async (t) => {
  const fixture = await migrationFixture(["create table timeout_probe (id integer);"]);
  t.after(() => fixture.cleanup());
  await withDatabase(async ({ client, connectionString }) => {
    await client.query("select pg_advisory_lock($1::integer, $2::integer)", MIGRATION_LOCK_KEYS);
    try {
      await assert.rejects(
        migrateDatabase({ connectionString, directory: fixture.directory, lockTimeoutMs: 50, log: quiet }),
        /not acquired within 50ms/,
      );
      assert.equal(
        (await client.query("select to_regclass('drizzle.__drizzle_migrations') as relation")).rows[0].relation,
        null,
      );
    } finally {
      await client.query("select pg_advisory_unlock($1::integer, $2::integer)", MIGRATION_LOCK_KEYS);
    }
    assert.equal((await migrateDatabase({ connectionString, directory: fixture.directory, log: quiet })).executed, 1);
    assert.equal(
      (await client.query("select pg_try_advisory_lock($1::integer, $2::integer) as acquired", MIGRATION_LOCK_KEYS))
        .rows[0].acquired,
      true,
    );
    await client.query("select pg_advisory_unlock($1::integer, $2::integer)", MIGRATION_LOCK_KEYS);
  });
});

test(
  "failed migration rolls back its DDL and history, releases its lock, and can resume",
  { timeout: 30000 },
  async (t) => {
    const fixture = await migrationFixture([
      "create table committed_probe (id integer); insert into committed_probe values (1);",
      "create table rollback_probe (id integer); insert into rollback_probe values (1); select missing_migration_function();",
    ]);
    t.after(() => fixture.cleanup());
    await withDatabase(async ({ client, connectionString }) => {
      await assert.rejects(
        migrateDatabase({ connectionString, directory: fixture.directory, log: quiet }),
        /0001_test failed.*rolled back/,
      );
      assert.equal(
        (await client.query("select to_regclass('public.rollback_probe') as relation")).rows[0].relation,
        null,
      );
      assert.deepEqual((await client.query("select * from committed_probe")).rows, [{ id: 1 }]);
      assert.equal(
        (await client.query("select count(*)::int as count from drizzle.__drizzle_migrations")).rows[0].count,
        1,
      );
      await fixture.write(1, "create table rollback_probe (id integer); insert into rollback_probe values (2);");
      assert.equal((await migrateDatabase({ connectionString, directory: fixture.directory, log: quiet })).executed, 1);
      assert.deepEqual((await client.query("select * from rollback_probe")).rows, [{ id: 2 }]);
    });
  },
);

test(
  "changed applied SQL stops before pending SQL and never rewrites its recorded hash",
  { timeout: 30000 },
  async (t) => {
    const fixture = await migrationFixture([
      "create table original_probe (id integer);",
      "create table must_not_run (id integer);",
    ]);
    t.after(() => fixture.cleanup());
    await fixture.writeJournal({ ...fixture.journal, entries: fixture.journal.entries.slice(0, 1) });
    await withDatabase(async ({ client, connectionString }) => {
      await migrateDatabase({ connectionString, directory: fixture.directory, log: quiet });
      const before = (await client.query("select * from drizzle.__drizzle_migrations")).rows;
      await fixture.writeJournal();
      await fixture.write(0, "create table changed_probe (id integer);");
      await assert.rejects(
        migrateDatabase({ connectionString, directory: fixture.directory, log: quiet }),
        MigrationHistoryError,
      );
      assert.equal(
        (await client.query("select to_regclass('public.must_not_run') as relation")).rows[0].relation,
        null,
      );
      assert.deepEqual((await client.query("select * from drizzle.__drizzle_migrations")).rows, before);
      assert.equal(
        (await client.query("select pg_try_advisory_lock($1::integer, $2::integer) as acquired", MIGRATION_LOCK_KEYS))
          .rows[0].acquired,
        true,
      );
      await client.query("select pg_advisory_unlock($1::integer, $2::integer)", MIGRATION_LOCK_KEYS);
    });
  },
);

test("status is read-only and an untracked public schema cannot be silently adopted", { timeout: 30000 }, async (t) => {
  const fixture = await migrationFixture(["create table new_probe (id integer);"]);
  t.after(() => fixture.cleanup());
  await withDatabase(async ({ client, connectionString }) => {
    assert.deepEqual(
      await migrateDatabase({ connectionString, directory: fixture.directory, checkOnly: true, log: quiet }),
      { applied: 0, pending: 1, executed: 0 },
    );
    assert.equal(
      (await client.query("select to_regclass('drizzle.__drizzle_migrations') as relation")).rows[0].relation,
      null,
    );
    await client.query("create table untracked_probe (id integer); insert into untracked_probe values (5)");
    await assert.rejects(
      migrateDatabase({ connectionString, directory: fixture.directory, log: quiet }),
      /untracked tables/,
    );
    assert.deepEqual((await client.query("select * from untracked_probe")).rows, [{ id: 5 }]);
    assert.equal(
      (await client.query("select to_regclass('drizzle.__drizzle_migrations') as relation")).rows[0].relation,
      null,
    );
  });
});

test(
  "the real chain upgrades 0051 -> 0052 by journal index and finishes through 0066",
  { timeout: 90000 },
  async (t) => {
    const fixture = await migrationFixture();
    t.after(() => fixture.cleanup());
    const journal = JSON.parse(await readFile(join(defaultMigrationsDirectory, "meta/_journal.json"), "utf8"));
    await Promise.all(
      journal.entries.map((entry) =>
        copyFile(join(defaultMigrationsDirectory, `${entry.tag}.sql`), join(fixture.directory, `${entry.tag}.sql`)),
      ),
    );
    await fixture.writeJournal({ ...journal, entries: journal.entries.slice(0, 52) });
    await withDatabase(async ({ client, connectionString }) => {
      assert.equal(
        (await migrateDatabase({ connectionString, directory: fixture.directory, log: quiet })).executed,
        52,
      );
      assert.equal(
        (await client.query("select to_regclass('public.integration_webhook_endpoints') as relation")).rows[0].relation,
        null,
      );
      await fixture.writeJournal({ ...journal, entries: journal.entries.slice(0, 53) });
      assert.equal((await migrateDatabase({ connectionString, directory: fixture.directory, log: quiet })).executed, 1);
      assert.equal(
        (await client.query("select to_regclass('public.integration_webhook_endpoints') as relation")).rows[0].relation,
        "integration_webhook_endpoints",
      );
      await fixture.writeJournal(journal);
      assert.equal(
        (await migrateDatabase({ connectionString, directory: fixture.directory, log: quiet })).executed,
        journal.entries.length - 53,
      );
      assert.equal((await migrateDatabase({ connectionString, directory: fixture.directory, log: quiet })).executed, 0);
      const rows = (await client.query("select * from drizzle.__drizzle_migrations")).rows;
      const expected = await loadMigrations();
      assert.equal(rows.length, expected.length);
      for (const entry of expected)
        assert.equal(rows.find((row) => String(row.created_at) === String(entry.when)).hash, entry.hash);
      const historicalHash = "e3a9191d82aeccd01a2ea08772e3854d8ed697235676719e1c295baa6796c307";
      await client.query("update drizzle.__drizzle_migrations set hash = $1 where created_at = $2", [
        historicalHash,
        expected[58].when,
      ]);
      const messages = [];
      assert.equal(
        (
          await migrateDatabase({
            connectionString,
            directory: fixture.directory,
            checkOnly: true,
            log: (message) => messages.push(message),
          })
        ).executed,
        0,
      );
      assert.ok(messages.some((message) => message.includes("reviewed historical hash for 0058")));
      assert.equal(
        (await client.query("select hash from drizzle.__drizzle_migrations where created_at = $1", [expected[58].when]))
          .rows[0].hash,
        historicalHash,
      );
    });
  },
);

test(
  "the production CLI applies and verifies the full real chain in an isolated empty database",
  { timeout: 90000 },
  async () => {
    await withDatabase(async ({ client, connectionString }) => {
      const run = (args) =>
        new Promise((resolve, reject) => {
          const child = spawn(process.execPath, ["scripts/database-command.mjs", "migrate", ...args], {
            env: { ...process.env, DATABASE_URL: connectionString, NODE_ENV: "production", DEPLOY_ENV: "production" },
            stdio: ["ignore", "pipe", "pipe"],
          });
          let output = "";
          child.stdout.on("data", (chunk) => {
            output += chunk;
          });
          child.stderr.on("data", (chunk) => {
            output += chunk;
          });
          child.on("error", reject);
          child.on("exit", (code) =>
            code === 0 ? resolve(output) : reject(new Error(`Migration CLI exited ${code}: ${output}`)),
          );
        });
      assert.match(await run([]), /67 executed/);
      assert.match(await run(["--check"]), /67 applied migration hashes; 0 pending/);
      assert.equal(
        (await client.query("select count(*)::int as count from drizzle.__drizzle_migrations")).rows[0].count,
        67,
      );
    });
  },
);
