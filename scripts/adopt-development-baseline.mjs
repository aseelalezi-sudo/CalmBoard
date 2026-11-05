import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import pg from "pg";
import { loadMigrations, migrateDatabase, pendingMigrations, withMigrationLock } from "./migration-runner.mjs";
import {
  assertDevelopmentEnvironment,
  BASELINE_TABLE,
  canonicalJson,
  databaseIdentity,
  DEVELOPMENT_HASH_EXCEPTIONS,
  digest,
  migrationManifest,
  normalizedHistory,
  readDevelopmentBaseline,
  REVIEWED_PREFIX_DIGEST,
  REVIEWED_PREFIX_LENGTH,
} from "./migration-baseline.mjs";
import { compareReviewedCatalog, readCatalog } from "./migration-catalog.mjs";
import {
  assertMatchingTables,
  fingerprintTables,
  localRecoveryCheckpoint,
  quoteIdentifier,
  verifyLocalCheckpoint,
} from "./local-db-recovery.mjs";

export async function adoptDevelopmentBaseline({
  connectionString,
  receipt,
  receiptDigest,
  referenceCatalog,
  environment = (process.env.DEPLOY_ENV ?? process.env.APP_ENV ?? process.env.NODE_ENV ?? "development")
    .trim()
    .toLowerCase(),
  reason,
  apply = false,
  snapshotId,
  log = console.log,
}) {
  assertDevelopmentEnvironment(environment);
  const url = new URL(connectionString);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    throw new Error("Baseline adoption is restricted to local development databases.");
  if (!reason?.trim() || !/^[a-f0-9]{64}$/.test(receiptDigest || ""))
    throw new Error("Approval reason and authenticated checkpoint evidence are required.");
  const migrations = await loadMigrations();
  if (migrations.length !== REVIEWED_PREFIX_LENGTH || digest(migrationManifest(migrations)) !== REVIEWED_PREFIX_DIGEST)
    throw new Error("Adoption requires the exact reviewed 67-file checkout.");
  return withMigrationLock({ connectionString, log }, async (client) => {
    if (snapshotId) {
      if (!/^[0-9a-f]+-[0-9a-f]+-\d+$/i.test(snapshotId)) throw new Error("Invalid exported recovery snapshot.");
      // Check current committed history/schema under the lock before importing
      // the backup's older data snapshot. Do not hide a concurrent migration.
      const latestRows = (await client.query("select id,hash,created_at from drizzle.__drizzle_migrations")).rows;
      if (digest(normalizedHistory(latestRows)) !== digest(normalizedHistory(receipt.history || [])))
        throw new Error("Migration history changed after the backup snapshot.");
      compareReviewedCatalog(await readCatalog(client), referenceCatalog);
    }
    await client.query("begin isolation level repeatable read");
    try {
      if (snapshotId) await client.query(`set transaction snapshot '${snapshotId}'`);
      await client.query("set local time zone 'UTC'");
      await client.query("set local datestyle = 'ISO, YMD'");
      const identity = await databaseIdentity(client);
      const expectedIdentity = {
        system_identifier: receipt.sourceIdentity?.system_identifier,
        database_oid: receipt.sourceIdentity?.database_oid,
        database_name: receipt.sourceDatabase,
      };
      if (canonicalJson(identity) !== canonicalJson(expectedIdentity))
        throw new Error("Checkpoint belongs to another database identity.");
      const rows = (await client.query("select id, hash, created_at from drizzle.__drizzle_migrations order by id"))
        .rows;
      if (
        digest(normalizedHistory(rows)) !== digest(normalizedHistory(receipt.history || [])) ||
        rows.length !== REVIEWED_PREFIX_LENGTH
      )
        throw new Error("Checkpoint migration history differs from the current database.");
      if (
        digest(receipt.migrations) !== REVIEWED_PREFIX_DIGEST ||
        receipt.verification?.isolatedRestore !== true ||
        receipt.verification?.tableContentsMatch !== true
      )
        throw new Error("Checkpoint does not verify the reviewed migration prefix and restored data.");
      const present = (await client.query("select to_regclass($1) is not null as present", [BASELINE_TABLE])).rows[0]
        .present;
      if (present) {
        const exceptions = await readDevelopmentBaseline(client, { migrations, rows, environment });
        pendingMigrations(migrations, rows, exceptions);
        const existing = (await client.query(`select document from ${BASELINE_TABLE}`)).rows[0].document;
        if (existing.evidence.receiptDigest !== receiptDigest)
          throw new Error("A different baseline decision already exists; it will not be overwritten.");
        await client.query("rollback");
        return { adopted: false, existing: true, document: existing };
      }
      if (pendingMigrations(migrations, rows, DEVELOPMENT_HASH_EXCEPTIONS).length)
        throw new Error("A baseline cannot adopt pending migrations.");
      for (const entry of DEVELOPMENT_HASH_EXCEPTIONS) {
        const migration = migrations.find((migration) => migration.tag === entry.tag);
        if (!rows.some((row) => String(row.created_at) === String(migration.when) && row.hash === entry.historical))
          throw new Error("The database does not have the reviewed historical hash pair.");
      }
      const catalog = compareReviewedCatalog(await readCatalog(client), referenceCatalog);
      assertMatchingTables(receipt.tables, await fingerprintTables(client));
      const document = {
        version: 1,
        scope: "development",
        identity,
        approvedAt: new Date().toISOString(),
        reason: reason.trim(),
        manifestDigest: REVIEWED_PREFIX_DIGEST,
        historyDigest: digest(normalizedHistory(rows)),
        exceptions: DEVELOPMENT_HASH_EXCEPTIONS,
        evidence: {
          receiptDigest,
          archiveSha256: receipt.archiveSha256,
          catalogDigest: digest(catalog),
          catalog,
          dataEvidence: snapshotId
            ? "Imported verified backup snapshot; subsequent application writes are allowed"
            : "Current transaction matches verified backup",
        },
      };
      if (apply) {
        await client.query(
          `create table ${BASELINE_TABLE} (singleton boolean primary key default true check (singleton), document jsonb not null, document_hash text not null)`,
        );
        // Strip inherited/default grants too: application roles must never edit the decision.
        const grantees = (
          await client.query(
            "select distinct case when a.grantee=0 then 'PUBLIC' else quote_ident(r.rolname) end as role from pg_class c cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a left join pg_roles r on r.oid=a.grantee where c.oid=$1::regclass and a.grantee<>c.relowner",
            [BASELINE_TABLE],
          )
        ).rows;
        for (const { role } of grantees) await client.query(`revoke all on table ${BASELINE_TABLE} from ${role}`);
        await client.query(`revoke all on table ${BASELINE_TABLE} from public`);
        await client.query(`insert into ${BASELINE_TABLE} (document,document_hash) values ($1::jsonb,$2)`, [
          JSON.stringify(document),
          digest(document),
        ]);
        await readDevelopmentBaseline(client, { migrations, rows, environment });
        await client.query("commit");
      } else await client.query("rollback");
      log(
        `${apply ? "Adopted" : "Verified proposed"} development baseline; 67 original records preserved; 2 database-bound exceptions.`,
      );
      return { adopted: apply, existing: false, document };
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  });
}

export async function withReferenceCatalog(connectionString, operation) {
  if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(connectionString).hostname))
    throw new Error("Reference verification is restricted to localhost.");
  const name = `calmboard_baseline_ref_${process.pid}_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
  const adminUrl = new URL(connectionString);
  adminUrl.pathname = "/postgres";
  const targetUrl = new URL(connectionString);
  targetUrl.pathname = `/${name}`;
  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  const reference = new pg.Client({ connectionString: targetUrl.toString() });
  let created = false;
  try {
    await admin.connect();
    await admin.query(`create database ${quoteIdentifier(name)} template template0`);
    created = true;
    await migrateDatabase({ connectionString: targetUrl.toString(), log: () => {} });
    await reference.connect();
    return await operation(await readCatalog(reference), { client: reference, connectionString: targetUrl.toString() });
  } finally {
    await reference.end();
    try {
      if (created) {
        if (!/^calmboard_baseline_ref_\d+_[a-f0-9]{16}$/.test(name)) throw new Error("Unsafe reference database name.");
        await admin.query(`drop database ${quoteIdentifier(name)} with (force)`);
      }
    } finally {
      await admin.end();
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const root = fileURLToPath(new URL("../", import.meta.url));
    try {
      process.loadEnvFile(resolve(root, ".env"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const args = process.argv.slice(2).filter((value) => value !== "--");
    const apply = args.at(-1) === "--apply";
    if (apply) args.pop();
    const fresh = args.length === 3 && args[0] === "--fresh" && args[1] === "--reason";
    if (!fresh && (args.length !== 4 || args[0] !== "--checkpoint" || args[2] !== "--reason"))
      throw new Error(
        "Usage: adopt-development-baseline.mjs (--fresh --reason REASON | --checkpoint DIRECTORY --reason REASON) [--apply]",
      );
    const environment = (process.env.DEPLOY_ENV ?? process.env.APP_ENV ?? process.env.NODE_ENV ?? "development")
      .trim()
      .toLowerCase();
    assertDevelopmentEnvironment(environment);
    const run = async (directory, snapshotId) => {
      const receipt = await verifyLocalCheckpoint(directory);
      const receiptDigest = createHash("sha256")
        .update(await readFile(resolve(directory, "receipt.json")))
        .digest("hex");
      return withReferenceCatalog(process.env.DATABASE_URL, (referenceCatalog) =>
        adoptDevelopmentBaseline({
          connectionString: process.env.DATABASE_URL,
          receipt,
          receiptDigest,
          referenceCatalog,
          environment,
          reason: fresh ? args[2] : args[3],
          apply,
          snapshotId,
        }),
      );
    };
    if (fresh)
      await localRecoveryCheckpoint({
        adoptVerifiedSource: ({ checkpointDirectory, snapshotId }) => run(checkpointDirectory, snapshotId),
      });
    else await run(resolve(args[1]));
  } catch (error) {
    console.error(`Baseline adoption failed: ${error.message}`);
    process.exitCode = 1;
  }
}
