import "dotenv/config";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const supportedCommands = new Set(["check", "generate", "migrate", "push", "studio"]);
const localEnvironments = new Set(["development", "local", "test"]);
const protectedEnvironments = new Set(["production", "staging", "stage", "preproduction"]);

export function databaseEnvironment(env = process.env) {
  return (env.DEPLOY_ENV ?? env.APP_ENV ?? env.NODE_ENV ?? "development").trim().toLowerCase();
}

export function assertDatabaseCommandAllowed(command, env = process.env) {
  if (!supportedCommands.has(command)) {
    throw new Error(`Unsupported database command: ${command || "<missing>"}`);
  }
  if (command !== "push") return;

  const environment = databaseEnvironment(env);
  if (protectedEnvironments.has(environment)) {
    throw new Error(`drizzle-kit push is forbidden in ${environment}; use pnpm db:migrate.`);
  }

  const ephemeralCi = env.CI === "true" && env.NODE_ENV === "test";
  if (!localEnvironments.has(environment) && !ephemeralCi) {
    throw new Error(
      `drizzle-kit push is allowed only for local development or ephemeral CI databases; received ${environment}.`,
    );
  }
}

export async function runDatabaseCommand(argv = process.argv.slice(2), env = process.env) {
  const [command, ...forwardedArgs] = argv;
  assertDatabaseCommandAllowed(command, env);

  if (command === "migrate") {
    if (!env.DATABASE_URL) throw new Error("DATABASE_URL is required to run migrations.");
    const pg = await import("pg");
    const crypto = await import("node:crypto");
    const { readFile } = await import("node:fs/promises");

    const Client = pg.default?.Client ?? pg.Client;
    const client = new Client({ connectionString: env.DATABASE_URL });
    await client.connect();
    try {
      await client.query("CREATE SCHEMA IF NOT EXISTS drizzle;");
      await client.query(`
        CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
          id SERIAL PRIMARY KEY,
          hash text NOT NULL,
          created_at bigint
        );
      `);

      const res = await client.query("SELECT created_at FROM drizzle.__drizzle_migrations;");
      const appliedTimestamps = new Set(res.rows.map((r) => String(r.created_at)));

      const journal = JSON.parse(await readFile(resolve("packages/database/migrations/meta/_journal.json"), "utf8"));
      console.log(`Checking ${journal.entries.length} migrations...`);

      for (const entry of journal.entries) {
        const timestampStr = String(entry.when);
        if (appliedTimestamps.has(timestampStr)) {
          continue;
        }

        const sqlFile = resolve(`packages/database/migrations/${entry.tag}.sql`);
        const content = await readFile(sqlFile, "utf8");
        const hash = crypto.createHash("sha256").update(content).digest("hex");
        const statements = content
          .split("--> statement-breakpoint")
          .map((s) => s.trim())
          .filter(Boolean);

        console.log(`Applying migration: ${entry.tag}...`);
        await client.query("BEGIN;");
        try {
          for (const statement of statements) {
            await client.query(statement);
          }
          await client.query("INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2);", [
            hash,
            entry.when,
          ]);
          await client.query("COMMIT;");
        } catch (migrationError) {
          await client.query("ROLLBACK;");
          throw migrationError;
        }
      }

      console.log("✓ Migrations applied successfully!");
      process.exitCode = 0;
      return;
    } finally {
      await client.end();
    }
  }

  const pnpmCli = env.npm_execpath;
  const executable = pnpmCli ? process.execPath : "pnpm";
  const commandArgs = pnpmCli
    ? [pnpmCli, "exec", "drizzle-kit", command, ...forwardedArgs]
    : ["exec", "drizzle-kit", command, ...forwardedArgs];
  const result = spawnSync(executable, commandArgs, {
    cwd: process.cwd(),
    env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    await runDatabaseCommand();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
