// Windows-only local checkpoint. This does not replace deploy/backup.sh/offsite backups.
import { spawn } from "node:child_process";
import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readFile, rename, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import pg from "pg";
import { loadMigrations } from "./migration-runner.mjs";

export const quoteIdentifier = (value) => `"${value.replaceAll('"', '""')}"`;
export const recoveryDatabaseName = () =>
  `calmboard_recovery_${process.pid}_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
export function assertRecoveryDatabase(name) {
  if (!/^calmboard_recovery_\d+_[a-f0-9]{16}$/.test(name)) throw new Error("Unsafe recovery database name.");
}

function child(command, args) {
  const process = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  // Never echo subprocess stderr: connection errors can contain credentials.
  process.stderr.resume();
  const done = new Promise((resolve, reject) => {
    process.on("error", () => reject(new Error(`${command} could not start.`)));
    process.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited with code ${code}.`))));
  });
  done.catch(() => {});
  return { process, done };
}

async function capture(command, args, input = Buffer.alloc(0)) {
  const running = child(command, args);
  const chunks = [];
  running.process.stdout.on("data", (chunk) => chunks.push(chunk));
  running.process.stdin.on("error", () => {});
  running.process.stdin.end(input);
  await running.done;
  return Buffer.concat(chunks);
}

async function dpapi(bytes, protect) {
  const method = protect ? "Protect" : "Unprotect";
  const script = `Add-Type -AssemblyName System.Security; try { $bytes = [Convert]::FromBase64String([Console]::In.ReadToEnd()); $result = [Security.Cryptography.ProtectedData]::${method}($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($result)) } catch { exit 1 }`;
  const result = await capture(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    bytes.toString("base64"),
  );
  return Buffer.from(result.toString("utf8"), "base64");
}

export function receiptSignature(bytes, identity) {
  return createHmac("sha256", identity).update("calmboard-local-recovery-receipt-v1\0").update(bytes).digest("hex");
}

export function authenticateReceipt(bytes, signature, identity) {
  if (
    !/^[a-f0-9]{64}$/.test(signature) ||
    !timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(receiptSignature(bytes, identity), "hex"))
  ) {
    throw new Error("Recovery receipt authentication failed.");
  }
  const receipt = JSON.parse(bytes.toString("utf8"));
  if (receipt.version !== 1 || !/^[a-f0-9]{64}$/.test(receipt.archiveSha256))
    throw new Error("Invalid recovery receipt.");
  return receipt;
}

export async function verifyLocalCheckpoint(directory) {
  if (process.platform !== "win32")
    throw new Error("The recovery identity requires the original Windows user profile.");
  const identity = await dpapi(await readFile(join(directory, "identity.dpapi")), false);
  try {
    const receipt = authenticateReceipt(
      await readFile(join(directory, "receipt.json")),
      (await readFile(join(directory, "receipt.hmac"), "utf8")).trim(),
      identity,
    );
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(join(directory, "database.dump.age"))) hash.update(chunk);
    if (hash.digest("hex") !== receipt.archiveSha256)
      throw new Error("Encrypted archive checksum differs from the authenticated receipt.");
    console.log(
      `Checkpoint integrity and protected key verified; ${receipt.tables.length} tables were verified during its restore drill.`,
    );
    return receipt;
  } finally {
    identity.fill(0);
  }
}

export async function fingerprintTables(client) {
  const tables = (
    await client.query(`select n.nspname as schema, c.relname as name
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where c.relkind in ('r','m') and n.nspname not like 'pg_%' and n.nspname <> 'information_schema'
    order by n.nspname collate "C", c.relname collate "C"`)
  ).rows;
  const result = [];
  for (const table of tables) {
    const identifier = `${quoteIdentifier(table.schema)}.${quoteIdentifier(table.name)}`;
    const hash = createHash("sha256");
    let count = 0;
    await client.query(
      `declare recovery_rows no scroll cursor for select to_jsonb(t)::text as row from ${identifier} t order by to_jsonb(t)::text collate "C"`,
    );
    try {
      for (;;) {
        const rows = (await client.query("fetch forward 1000 from recovery_rows")).rows;
        if (!rows.length) break;
        for (const { row } of rows) {
          const bytes = Buffer.from(row, "utf8");
          hash.update(`${bytes.length}:`).update(bytes);
          count++;
        }
      }
    } finally {
      await client.query("close recovery_rows");
    }
    result.push({ ...table, rows: count, sha256: hash.digest("hex") });
  }
  return result;
}

export function assertMatchingTables(expected, actual) {
  if (JSON.stringify(expected) !== JSON.stringify(actual))
    throw new Error("Restored table contents differ from the source snapshot.");
}

async function snapshot(client) {
  await client.query("begin isolation level repeatable read read only");
  await client.query("set local time zone 'UTC'");
  await client.query("set local datestyle = 'ISO, YMD'");
}

async function streamCommands(commands, destination) {
  const running = commands.map((args) => child("docker", args));
  const operations = running.map(({ done }) => done);
  running[0].process.stdin.end();
  for (let index = 1; index < running.length; index++) {
    operations.push(pipeline(running[index - 1].process.stdout, running[index].process.stdin));
  }
  operations.push(pipeline(running.at(-1).process.stdout, destination));
  // Kill every peer on the first failure; await all streams before returning.
  const guarded = operations.map((operation) =>
    operation.catch((error) => {
      for (const peer of running) peer.process.kill();
      throw error;
    }),
  );
  const results = await Promise.allSettled(guarded);
  const failed = results.find((result) => result.status === "rejected");
  if (failed) throw failed.reason;
}

export async function localRecoveryCheckpoint({ verifyRestored, adoptVerifiedSource } = {}) {
  if (process.platform !== "win32")
    throw new Error("This local checkpoint requires Windows DPAPI. Use deploy/backup.sh for production.");
  const root = fileURLToPath(new URL("../", import.meta.url));
  try {
    process.loadEnvFile(join(root, ".env"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const sourceUrl = new URL(process.env.DATABASE_URL);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(sourceUrl.hostname))
    throw new Error("Only a local development database is supported.");
  if (process.env.NODE_ENV === "production") throw new Error("Use the production offsite backup procedure.");
  const container = process.env.LOCAL_RECOVERY_POSTGRES_CONTAINER || "calmboard-postgres-1";
  const imageTag = process.env.LOCAL_RECOVERY_IMAGE || "calmboard-db-recovery:local";
  // Pin this run to the inspected local image. Never pull code while handling a key.
  const image = (await capture("docker", ["image", "inspect", imageTag, "--format", "{{.Id}}"]))
    .toString("utf8")
    .trim();
  if (!/^sha256:[a-f0-9]{64}$/.test(image)) throw new Error("Invalid recovery image ID.");
  const name = recoveryDatabaseName();
  assertRecoveryDatabase(name);
  const output = resolve(root, "artifacts", "local-recovery", name);
  await mkdir(output, { recursive: true });
  const temporary = await mkdtemp(join(tmpdir(), "calmboard-recovery-"));
  const envFile = join(temporary, "postgres.env");
  const restoreEnvFile = join(temporary, "restore.env");
  const pgEnvironment = (database) => {
    const values = {
      PGHOST: "127.0.0.1",
      PGPORT: "5432",
      PGDATABASE: database,
      PGUSER: decodeURIComponent(sourceUrl.username),
      PGPASSWORD: decodeURIComponent(sourceUrl.password),
      PGSSLMODE: "disable",
    };
    if (Object.values(values).some((value) => /[\r\n\0]/.test(value)))
      throw new Error("Unsupported PostgreSQL environment value.");
    return Object.entries(values)
      .map(([key, value]) => `${key}=${value}\n`)
      .join("");
  };
  const adminUrl = new URL(sourceUrl);
  adminUrl.pathname = "/postgres";
  const targetUrl = new URL(sourceUrl);
  targetUrl.pathname = `/${name}`;
  const source = new pg.Client({ connectionString: sourceUrl.toString() });
  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  const restored = new pg.Client({ connectionString: targetUrl.toString() });
  const archive = join(output, "database.dump.age");
  let created = false;
  let identity;
  try {
    await source.connect();
    await admin.connect();
    const role = (
      await source.query("select rolsuper or rolbypassrls as allowed from pg_roles where rolname=current_user")
    ).rows[0];
    if (!role?.allowed) throw new Error("A complete checkpoint requires a source role that bypasses RLS.");
    const sourceIdentity = (
      await source.query(
        "select (select system_identifier::text from pg_control_system()) as system_identifier, oid::text as database_oid, current_setting('server_version_num') as server_version from pg_database where datname=current_database()",
      )
    ).rows[0];
    await writeFile(envFile, pgEnvironment(decodeURIComponent(sourceUrl.pathname.slice(1))), {
      mode: 0o600,
      flag: "wx",
    });
    await writeFile(restoreEnvFile, pgEnvironment(name), { mode: 0o600, flag: "wx" });
    identity = await capture("docker", [
      "run",
      "--rm",
      "--pull",
      "never",
      "--network",
      "none",
      "--entrypoint",
      "age-keygen",
      image,
    ]);
    const recipient = (
      await capture(
        "docker",
        ["run", "--rm", "-i", "--pull", "never", "--network", "none", "--entrypoint", "age-keygen", image, "-y"],
        identity,
      )
    )
      .toString("utf8")
      .trim();
    if (!/^age1[a-z0-9]+$/.test(recipient)) throw new Error("Invalid age recipient.");
    const protectedKey = await dpapi(identity, true);
    await writeFile(join(output, "identity.dpapi"), protectedKey, { mode: 0o600, flag: "wx" });
    const recoveredIdentity = await dpapi(await readFile(join(output, "identity.dpapi")), false);
    if (!identity.equals(recoveredIdentity)) throw new Error("Protected key round trip failed.");
    recoveredIdentity.fill(0);
    await snapshot(source);
    const snapshotId = (await source.query("select pg_export_snapshot() as id")).rows[0].id;
    const history = (
      await source.query("select id, hash, created_at::text from drizzle.__drizzle_migrations order by created_at, id")
    ).rows;
    console.log("Exporting the consistent source snapshot directly into age encryption...");
    await streamCommands(
      [
        [
          "exec",
          "--env-file",
          envFile,
          container,
          "pg_dump",
          "--format=custom",
          "--no-password",
          `--snapshot=${snapshotId}`,
        ],
        ["run", "--rm", "-i", "--pull", "never", "--network", "none", image, "-r", recipient],
      ],
      createWriteStream(`${archive}.partial`, { flags: "wx", mode: 0o644 }),
    );
    await rename(`${archive}.partial`, archive);
    const tables = await fingerprintTables(source);
    // Keep this exported snapshot alive for a locked adoption callback. Ordinary
    // backups can release it immediately after fingerprinting the source.
    if (!adoptVerifiedSource) await source.query("commit");
    console.log("Encrypted backup complete; restoring into a new isolated database...");
    await admin.query(`create database ${quoteIdentifier(name)} template template0`);
    created = true;
    const decrypt = child("docker", [
      "run",
      "--rm",
      "-i",
      "--pull",
      "never",
      "--network",
      "none",
      "--mount",
      `type=bind,source=${archive},target=/backup/database.dump.age,readonly`,
      "--tmpfs",
      "/run/keys:rw,noexec,nosuid,size=1m,uid=65532,gid=65532,mode=0700",
      "--entrypoint",
      "sh",
      image,
      "-c",
      "umask 077; cat > /run/keys/identity; exec age -d -i /run/keys/identity /backup/database.dump.age",
    ]);
    const restore = child("docker", [
      "exec",
      "-i",
      "--env-file",
      restoreEnvFile,
      container,
      "pg_restore",
      "--dbname",
      name,
      "--no-password",
      "--exit-on-error",
      "--single-transaction",
      "--no-owner",
      "--no-privileges",
    ]);
    decrypt.process.stdin.on("error", () => {});
    decrypt.process.stdin.end(identity);
    restore.process.stdout.resume();
    const restoreResults = await Promise.allSettled(
      [decrypt.done, restore.done, pipeline(decrypt.process.stdout, restore.process.stdin)].map((operation) =>
        operation.catch((error) => {
          decrypt.process.kill();
          restore.process.kill();
          throw error;
        }),
      ),
    );
    const failed = restoreResults.find((result) => result.status === "rejected");
    if (failed) throw failed.reason;
    await restored.connect();
    await snapshot(restored);
    const restoredTables = await fingerprintTables(restored);
    assertMatchingTables(tables, restoredTables);
    await restored.query("commit");
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(archive)) hash.update(chunk);
    const receipt = {
      version: 1,
      completedAt: new Date().toISOString(),
      scope: "local Windows-user-bound database checkpoint; not offsite or cluster recovery",
      image,
      recipient,
      archiveSha256: hash.digest("hex"),
      sourceDatabase: decodeURIComponent(sourceUrl.pathname.slice(1)),
      sourceIdentity,
      history,
      migrations: (await loadMigrations()).map(({ idx, tag, when, hash }) => ({ idx, tag, when, hash })),
      tables,
      verification: {
        isolatedRestore: true,
        tableContentsMatch: true,
        migrationHistoryPreserved: true,
        ownershipAndGrantsRestored: false,
      },
    };
    const bytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
    await writeFile(join(output, "receipt.json"), bytes, { flag: "wx" });
    await writeFile(join(output, "receipt.hmac"), receiptSignature(bytes, identity), { flag: "wx" });
    if (verifyRestored)
      await verifyRestored({ connectionString: targetUrl.toString(), receipt, checkpointDirectory: output });
    if (adoptVerifiedSource) {
      await adoptVerifiedSource({
        connectionString: sourceUrl.toString(),
        receipt,
        checkpointDirectory: output,
        snapshotId,
      });
      await source.query("commit");
    }
    console.log(
      JSON.stringify({
        checkpoint: output,
        tablesVerified: tables.length,
        rowsVerified: tables.reduce((sum, table) => sum + table.rows, 0),
        migrationsPreserved: history.length,
        restoredCopy: "verified; removed during cleanup",
      }),
    );
    return receipt;
  } finally {
    identity?.fill(0);
    await restored.end();
    await source.end();
    try {
      if (created) {
        assertRecoveryDatabase(name);
        await admin.query(`drop database ${quoteIdentifier(name)} with (force)`);
      }
    } finally {
      await admin.end();
      await unlink(envFile).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
      await unlink(restoreEnvFile).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
      await rmdir(temporary);
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2).filter((argument) => argument !== "--");
  if (args.length && (args.length !== 2 || args[0] !== "--verify"))
    throw new Error("Usage: local-db-recovery.mjs [--verify CHECKPOINT_DIRECTORY]");
  await (args.length ? verifyLocalCheckpoint(resolve(args[1])) : localRecoveryCheckpoint()).catch((error) => {
    console.error(`Local recovery checkpoint failed (${error.code || error.name}). No migration history was changed.`);
    process.exitCode = 1;
  });
}
