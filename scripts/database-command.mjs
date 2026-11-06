import { loadMigrations, migrateDatabase, migrationLockTimeout } from "./migration-runner.mjs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
try {
  process.loadEnvFile(resolve(repositoryRoot, ".env"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

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
    const options = forwardedArgs.filter((argument) => argument !== "--");
    if (options.some((argument) => argument !== "--check")) {
      throw new Error("Only --check is supported by migrate; configure DATABASE_URL through the environment.");
    }
    await migrateDatabase({
      connectionString: env.DATABASE_URL,
      lockTimeoutMs: migrationLockTimeout(env.MIGRATION_LOCK_TIMEOUT_MS),
      checkOnly: options.includes("--check"),
      environment: databaseEnvironment(env),
    });
    process.exitCode = 0;
    return;
  }
  if (command === "check") await loadMigrations();
  const pnpmCli = env.npm_execpath;
  const executable = pnpmCli ? process.execPath : "pnpm";
  const commandArgs = pnpmCli
    ? [pnpmCli, "exec", "drizzle-kit", command, ...forwardedArgs]
    : ["exec", "drizzle-kit", command, ...forwardedArgs];
  const result = spawnSync(executable, commandArgs, {
    cwd: repositoryRoot,
    env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (command === "check" && result.status === 0) {
    console.log(
      "CalmBoard journal indexes validated. Apply with pnpm db:migrate; the known 0052 timestamp inversion is handled by journal index, not timestamp order.",
    );
  }
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
