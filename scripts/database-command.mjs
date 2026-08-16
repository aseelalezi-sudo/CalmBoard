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

  if (command === "migrate" && env.DATABASE_URL) {
    try {
      const pg = await import("pg");
      const Client = pg.default?.Client ?? pg.Client;
      const client = new Client({ connectionString: env.DATABASE_URL });
      await client.connect();
      await client.query("CREATE SCHEMA IF NOT EXISTS drizzle;");
      await client.end();
    } catch {
      // ignore
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
