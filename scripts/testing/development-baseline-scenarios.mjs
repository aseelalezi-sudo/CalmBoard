import assert from "node:assert/strict";
import { cp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { adoptDevelopmentBaseline } from "../adopt-development-baseline.mjs";
import {
  BASELINE_TABLE,
  databaseIdentity,
  digest,
  migrationManifest,
  normalizedHistory,
} from "../migration-baseline.mjs";
import { defaultMigrationsDirectory, loadMigrations, migrateDatabase } from "../migration-runner.mjs";
import { fingerprintTables } from "../local-db-recovery.mjs";
import { migrationFixture } from "./migration-fixtures.mjs";

const quiet = () => {};

export async function baselineTestReceipt(client) {
  await client.query("begin isolation level repeatable read read only");
  try {
    await client.query("set local time zone 'UTC'");
    await client.query("set local datestyle = 'ISO, YMD'");
    const identity = await databaseIdentity(client);
    return {
      version: 1,
      sourceIdentity: identity,
      sourceDatabase: identity.database_name,
      history: normalizedHistory(
        (await client.query("select id,hash,created_at from drizzle.__drizzle_migrations")).rows,
      ),
      tables: await fingerprintTables(client),
      migrations: migrationManifest(await loadMigrations()),
      archiveSha256: "a".repeat(64),
      verification: { isolatedRestore: true, tableContentsMatch: true },
    };
  } finally {
    await client.query("rollback");
  }
}

// Runs only on a caller-owned disposable database. It intentionally mutates its
// baseline metadata and appends a probe migration; never point this at live data.
export async function exerciseDevelopmentBaseline({
  connectionString,
  receipt,
  receiptDigest = "b".repeat(64),
  referenceCatalog,
}) {
  if (
    !/^calmboard_(?:migrator_test|recovery)_\d+_[a-f0-9]{16}$/.test(
      decodeURIComponent(new URL(connectionString).pathname.slice(1)),
    )
  )
    throw new Error("Baseline regression scenarios require a disposable test database.");
  const client = new pg.Client({ connectionString });
  await client.connect();
  const options = {
    connectionString,
    receipt,
    receiptDigest,
    referenceCatalog,
    reason: "Isolated baseline regression test",
    log: quiet,
  };
  const history = normalizedHistory(
    (await client.query("select id,hash,created_at from drizzle.__drizzle_migrations")).rows,
  );
  const assertNoDecision = async () =>
    assert.equal((await client.query("select to_regclass($1) as name", [BASELINE_TABLE])).rows[0].name, null);
  try {
    for (const environment of ["production", "staging", "unexpected"])
      await assert.rejects(adoptDevelopmentBaseline({ ...options, environment, apply: true }), /environment/);
    await assert.rejects(
      adoptDevelopmentBaseline({
        ...options,
        receipt: { ...receipt, sourceDatabase: "another_database" },
        apply: true,
      }),
      /another database identity/,
    );
    await assert.rejects(
      adoptDevelopmentBaseline({ ...options, receipt: { ...receipt, history: [] }, apply: true }),
      /migration history differs/,
    );
    await assert.rejects(
      adoptDevelopmentBaseline({ ...options, receipt: { ...receipt, migrations: [] }, apply: true }),
      /reviewed migration prefix/,
    );
    await assert.rejects(
      adoptDevelopmentBaseline({ ...options, receipt: { ...receipt, tables: [] }, apply: true }),
      /contents differ/,
    );
    await client.query("alter table comments add column baseline_unreviewed integer");
    try {
      await assert.rejects(adoptDevelopmentBaseline({ ...options, apply: true }), /Unreviewed catalog difference/);
    } finally {
      await client.query("alter table comments drop column baseline_unreviewed");
    }
    await assertNoDecision();
    assert.equal((await adoptDevelopmentBaseline(options)).adopted, false);
    await assertNoDecision();
    const concurrent = await Promise.all([
      adoptDevelopmentBaseline({ ...options, apply: true }),
      adoptDevelopmentBaseline({ ...options, apply: true }),
    ]);
    assert.equal(concurrent.filter((result) => result.adopted).length, 1);
    assert.equal(concurrent.filter((result) => result.existing).length, 1);
    assert.equal(
      (
        await client.query(
          "select count(*)::int as count from pg_class c cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a where c.oid=$1::regclass and a.grantee<>c.relowner",
          [BASELINE_TABLE],
        )
      ).rows[0].count,
      0,
    );
    assert.equal((await migrateDatabase({ connectionString, checkOnly: true, log: quiet })).pending, 0);
    assert.deepEqual(
      normalizedHistory((await client.query("select id,hash,created_at from drizzle.__drizzle_migrations")).rows),
      history,
    );
    for (const environment of ["production", "staging"])
      await assert.rejects(migrateDatabase({ connectionString, environment, log: quiet }), /environment/);
    await assert.rejects(
      adoptDevelopmentBaseline({ ...options, receiptDigest: "c".repeat(64), apply: true }),
      /different baseline decision/,
    );

    const saved = (await client.query(`select document,document_hash from ${BASELINE_TABLE}`)).rows[0];
    const tampered = { ...saved.document, identity: { ...saved.document.identity, database_oid: "0" } };
    await client.query(`update ${BASELINE_TABLE} set document=$1,document_hash=$2`, [
      JSON.stringify(tampered),
      digest(tampered),
    ]);
    await assert.rejects(
      migrateDatabase({ connectionString, checkOnly: true, log: quiet }),
      /another database identity/,
    );
    await client.query(`update ${BASELINE_TABLE} set document=$1,document_hash=$2`, [
      JSON.stringify(saved.document),
      saved.document_hash,
    ]);

    const original = history[0];
    await client.query("update drizzle.__drizzle_migrations set hash=$1 where id=$2", ["d".repeat(64), original.id]);
    await assert.rejects(
      migrateDatabase({ connectionString, checkOnly: true, log: quiet }),
      /historical records changed/,
    );
    await client.query("update drizzle.__drizzle_migrations set hash=$1 where id=$2", [original.hash, original.id]);

    const fixture = await migrationFixture();
    try {
      // Replace synthetic entries with the full, published prefix and one future probe.
      await cp(defaultMigrationsDirectory, fixture.directory, { recursive: true });
      const journal = JSON.parse(await readFile(join(fixture.directory, "meta/_journal.json"), "utf8"));
      const next = {
        ...journal.entries.at(-1),
        idx: 67,
        tag: "0067_baseline_probe",
        when: Math.max(...journal.entries.map((entry) => entry.when)) + 1,
      };
      journal.entries.push(next);
      await writeFile(join(fixture.directory, "meta/_journal.json"), JSON.stringify(journal));
      await writeFile(
        join(fixture.directory, `${next.tag}.sql`),
        "create table baseline_probe (id integer primary key);",
      );
      const first = journal.entries[0];
      const firstFile = join(fixture.directory, `${first.tag}.sql`);
      const bytes = await readFile(firstFile);
      await writeFile(firstFile, Buffer.concat([bytes, Buffer.from("\n-- unexpected drift\n")]));
      await assert.rejects(
        migrateDatabase({ connectionString, directory: fixture.directory, log: quiet }),
        /prefix changed/,
      );
      assert.equal((await client.query("select to_regclass('public.baseline_probe') as name")).rows[0].name, null);
      await writeFile(firstFile, bytes);
      assert.equal((await migrateDatabase({ connectionString, directory: fixture.directory, log: quiet })).executed, 1);
      assert.equal((await migrateDatabase({ connectionString, directory: fixture.directory, log: quiet })).executed, 0);
      assert.deepEqual(
        normalizedHistory(
          (
            await client.query("select id,hash,created_at from drizzle.__drizzle_migrations where created_at<>$1", [
              next.when,
            ])
          ).rows,
        ),
        history,
      );
      return {
        baselineDocument: saved.document,
        baselineDocumentHash: saved.document_hash,
        futureMigrationAppliedOnce: true,
      };
    } finally {
      await fixture.cleanup();
    }
  } finally {
    await client.end();
  }
}
