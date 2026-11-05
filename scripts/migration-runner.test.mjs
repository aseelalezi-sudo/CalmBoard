import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import {
  defaultMigrationsDirectory,
  loadMigrations,
  migrateDatabase,
  migrationLockTimeout,
  MigrationHistoryError,
  pendingMigrations,
} from "./migration-runner.mjs";
import { migrationFixture } from "./testing/migration-fixtures.mjs";

test("migration hashes use exact bytes and SQL is frozen with its hash", async (t) => {
  const fixture = await migrationFixture(["-- تعليق\r\nselect 1;\r\n--> statement-breakpoint\r\nselect 2;"]);
  t.after(() => fixture.cleanup());
  const [migration] = await loadMigrations(fixture.directory);
  assert.equal(
    migration.hash,
    createHash("sha256")
      .update(await fixture.read(0))
      .digest("hex"),
  );
  assert.deepEqual(migration.statements, ["-- تعليق\r\nselect 1;", "select 2;"]);
  await fixture.write(0, "select 3;");
  assert.equal(migration.statements[0], "-- تعليق\r\nselect 1;");
  const [changed] = await loadMigrations(fixture.directory);
  assert.notEqual(changed.hash, migration.hash);
});

test("journal validation rejects traversal, indices, duplicate timestamps and new inversions", async (t) => {
  const fixture = await migrationFixture();
  t.after(() => fixture.cleanup());
  for (const patch of [{ idx: 9 }, { tag: "../outside" }, { when: 1000 }, { when: 999 }, { when: 1.5 }]) {
    await fixture.writeJournal({
      ...fixture.journal,
      entries: [fixture.journal.entries[0], { ...fixture.journal.entries[1], ...patch }],
    });
    await assert.rejects(loadMigrations(fixture.directory), /Invalid|timestamp/);
  }
  await fixture.writeJournal({ ...fixture.journal, entries: [] });
  await assert.rejects(loadMigrations(fixture.directory), /nonempty/);
});

test("every journal file is validated before a migration run can connect", async (t) => {
  const fixture = await migrationFixture(["select 1;", ""]);
  t.after(() => fixture.cleanup());
  await assert.rejects(loadMigrations(fixture.directory), /SQL is empty/);
  await assert.rejects(
    migrateDatabase({
      connectionString: "postgresql://unused@127.0.0.1:1/unused",
      directory: fixture.directory,
      log: () => {},
    }),
    /SQL is empty/,
  );
  await writeFile(join(fixture.directory, "0001_test.sql"), Buffer.from([0xff]));
  await assert.rejects(loadMigrations(fixture.directory), /encoded data/);
  await fixture.writeJournal({
    ...fixture.journal,
    entries: [fixture.journal.entries[0], { ...fixture.journal.entries[1], tag: "0001_missing" }],
  });
  await assert.rejects(loadMigrations(fixture.directory), /ENOENT/);
});

test("applied history must be a unique known prefix with matching hashes", async (t) => {
  const fixture = await migrationFixture(["select 1;", "select 2;", "select 3;"]);
  t.after(() => fixture.cleanup());
  const migrations = await loadMigrations(fixture.directory);
  const row = (index) => ({ id: index + 1, created_at: String(migrations[index].when), hash: migrations[index].hash });
  assert.deepEqual(pendingMigrations(migrations, []), migrations);
  assert.deepEqual(pendingMigrations(migrations, [row(0)]), migrations.slice(1));
  // Sequence IDs do not define order: past transaction rollback or a reviewed
  // historical repair may leave gaps or different insertion order in IDs.
  assert.deepEqual(pendingMigrations(migrations, [{ ...row(1), id: 40 }, { ...row(0), id: 50 }, row(2)]), []);
  for (const invalid of [
    [{ ...row(0), hash: "changed" }],
    [row(0), row(0)],
    [row(1)],
    [row(0), row(2)],
    [{ ...row(0), created_at: "9999999" }],
    [{ ...row(0), created_at: null }],
  ]) {
    assert.throws(() => pendingMigrations(migrations, invalid), MigrationHistoryError);
  }
});

test("published 0052 follows 0051 in journal order despite its historical timestamp", async () => {
  const migrations = await loadMigrations();
  const applied = migrations
    .slice(0, 52)
    .map((migration) => ({ hash: migration.hash, created_at: String(migration.when) }));
  assert.ok(migrations[52].when < migrations[51].when);
  assert.equal(pendingMigrations(migrations, applied)[0].tag, "0052_integration_webhook_replay");
  assert.throws(
    () =>
      pendingMigrations(migrations, [
        ...applied,
        { hash: migrations[53].hash, created_at: String(migrations[53].when) },
      ]),
    /gap at 0052/,
  );
});

test("migration lock waits have bounded explicit timeouts", () => {
  assert.equal(migrationLockTimeout(), 60000);
  assert.equal(migrationLockTimeout("25"), 25);
  for (const invalid of ["", "0", "-1", "25ms", "1.5", "600001", Infinity])
    assert.throws(() => migrationLockTimeout(invalid), /MIGRATION_LOCK_TIMEOUT_MS/);
});

test("only the recovered exact format-only 0058 variant is accepted without rewriting history", async () => {
  const migrations = await loadMigrations();
  const content = await readFile(join(defaultMigrationsDirectory, "0058_sprints_permissions.sql"), "utf8");
  const original = content
    .replaceAll('FROM "roles" CROSS JOIN "permissions"\n', 'FROM "roles" CROSS JOIN "permissions" \n')
    .trimEnd();
  const historicalHash = createHash("sha256").update(original).digest("hex");
  assert.equal(historicalHash, "e3a9191d82aeccd01a2ea08772e3854d8ed697235676719e1c295baa6796c307");
  const rows = migrations.slice(0, 59).map((migration) => ({
    created_at: String(migration.when),
    hash: migration.idx === 58 ? historicalHash : migration.hash,
  }));
  assert.equal(pendingMigrations(migrations, rows)[0].idx, 59);
  assert.equal(rows[58].hash, historicalHash);
  assert.throws(
    () =>
      pendingMigrations(
        migrations.map((migration) =>
          migration.idx === 58 ? { ...migration, hash: "changed-current-file" } : migration,
        ),
        rows,
      ),
    /Hash mismatch/,
  );
  assert.throws(
    () =>
      pendingMigrations(
        migrations,
        rows.map((row, index) =>
          index === 58
            ? {
                ...row,
                hash: createHash("sha256")
                  .update(original + " ")
                  .digest("hex"),
              }
            : row,
        ),
      ),
    /Hash mismatch/,
  );
});
