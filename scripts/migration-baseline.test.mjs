import assert from "node:assert/strict";
import test from "node:test";
import {
  DEVELOPMENT_HASH_EXCEPTIONS,
  digest,
  migrationManifest,
  normalizedHistory,
  REVIEWED_PREFIX_DIGEST,
  validateDevelopmentBaseline,
} from "./migration-baseline.mjs";
import { loadMigrations, pendingMigrations } from "./migration-runner.mjs";

async function decisionFixture() {
  const migrations = await loadMigrations();
  const rows = migrations.map((migration, id) => ({
    id,
    hash: DEVELOPMENT_HASH_EXCEPTIONS.find((entry) => entry.tag === migration.tag)?.historical || migration.hash,
    created_at: migration.when,
  }));
  const identity = { system_identifier: "123", database_oid: "45", database_name: "development_fixture" };
  const document = {
    version: 1,
    scope: "development",
    identity,
    approvedAt: "2026-11-05T00:00:00.000Z",
    reason: "Explicit test approval",
    manifestDigest: REVIEWED_PREFIX_DIGEST,
    historyDigest: digest(normalizedHistory(rows)),
    exceptions: DEVELOPMENT_HASH_EXCEPTIONS,
    evidence: { receiptDigest: "a".repeat(64), archiveSha256: "b".repeat(64), catalogDigest: "c".repeat(64) },
  };
  return { migrations, rows, identity, document, documentHash: digest(document), environment: "development" };
}

test("unknown historical hashes stay rejected without a database-bound validated decision", async () => {
  const fixture = await decisionFixture();
  assert.equal(digest(migrationManifest(fixture.migrations)), REVIEWED_PREFIX_DIGEST);
  assert.throws(() => pendingMigrations(fixture.migrations, fixture.rows), /Hash mismatch/);
  const exceptions = validateDevelopmentBaseline(fixture);
  assert.equal(pendingMigrations(fixture.migrations, fixture.rows, exceptions).length, 0);
});

test("baseline validation rejects another identity, changed prefix, altered history and protected environments", async () => {
  const fixture = await decisionFixture();
  assert.throws(
    () => validateDevelopmentBaseline({ ...fixture, identity: { ...fixture.identity, database_oid: "46" } }),
    /another database identity/,
  );
  assert.throws(
    () => validateDevelopmentBaseline({ ...fixture, migrations: fixture.migrations.slice(1) }),
    /prefix changed/,
  );
  assert.throws(
    () => validateDevelopmentBaseline({ ...fixture, rows: fixture.rows.slice(1) }),
    /historical records changed/,
  );
  for (const environment of ["production", "staging", "unknown"])
    assert.throws(() => validateDevelopmentBaseline({ ...fixture, environment }), /environment/);
});

test("decision digests and evidence cannot be altered silently or expanded to unrelated hashes", async () => {
  const fixture = await decisionFixture();
  assert.throws(
    () => validateDevelopmentBaseline({ ...fixture, document: { ...fixture.document, reason: "changed" } }),
    /Invalid/,
  );
  for (const patch of [
    { exceptions: [...DEVELOPMENT_HASH_EXCEPTIONS, { tag: "0000_other" }] },
    { evidence: {} },
    { scope: "production" },
  ]) {
    const document = { ...fixture.document, ...patch };
    assert.throws(
      () => validateDevelopmentBaseline({ ...fixture, document, documentHash: digest(document) }),
      /exceptions changed|evidence is incomplete|Invalid/,
    );
  }
});
