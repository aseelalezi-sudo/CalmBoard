import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const services = ["web", "api", "worker"];

function port(value, fallback, name) {
  const candidate = value ?? String(fallback);
  if (!/^\d+$/.test(candidate) || Number(candidate) < 1 || Number(candidate) > 65535) {
    throw new Error(`${name} must be an integer between 1 and 65535 in the root .env.`);
  }
  return String(Number(candidate));
}

function localUrl(value, fallback, expectedPort, name, syncLocalPort = false) {
  let url;
  try {
    url = new URL(value || fallback);
  } catch {
    throw new Error(`${name} must be a valid HTTP(S) URL in the root .env.`);
  }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) {
    throw new Error(`${name} must be an HTTP(S) URL without credentials.`);
  }
  const actualPort = url.port || (url.protocol === "https:" ? "443" : "80");
  if (["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) && actualPort !== expectedPort) {
    if (syncLocalPort) {
      url.port = expectedPort;
    } else {
      throw new Error(`${name} uses port ${actualPort}, but the service uses ${expectedPort}. Update the root .env.`);
    }
  }
  return url.origin;
}

export function developmentEnvironment(input) {
  if (
    input.NODE_ENV === "production" ||
    !["development", "local", "test"].includes((input.DEPLOY_ENV ?? input.APP_ENV ?? "development").toLowerCase())
  ) {
    throw new Error(
      "Development commands require a local development environment; use production start commands for deployment.",
    );
  }
  const env = { ...input, NODE_ENV: "development" };
  env.PORT = port(input.PORT, 3000, "PORT");
  env.API_PORT = port(input.API_PORT, 4000, "API_PORT");
  env.WORKER_HEALTH_PORT = port(input.WORKER_HEALTH_PORT, 3002, "WORKER_HEALTH_PORT");
  // PORT is authoritative for the local web server. A stale APP_URL inherited
  // from the terminal must not prevent startup or leave API CORS on another port.
  env.APP_URL = localUrl(input.APP_URL, `http://localhost:${env.PORT}`, env.PORT, "APP_URL", true);
  env.API_PUBLIC_URL = localUrl(
    input.API_PUBLIC_URL,
    `http://localhost:${env.API_PORT}`,
    env.API_PORT,
    "API_PUBLIC_URL",
  );
  env.NEXT_PUBLIC_API_URL = localUrl(
    input.NEXT_PUBLIC_API_URL,
    env.API_PUBLIC_URL,
    env.API_PORT,
    "NEXT_PUBLIC_API_URL",
  );
  env.NEXT_PUBLIC_REALTIME_URL = localUrl(
    input.NEXT_PUBLIC_REALTIME_URL,
    env.API_PUBLIC_URL,
    env.API_PORT,
    "NEXT_PUBLIC_REALTIME_URL",
  );
  return env;
}

export function developmentTargets(env, selected = services) {
  if (selected.some((name) => !services.includes(name))) {
    throw new Error("Usage: node scripts/dev-all.mjs [web|api|worker] [--check]");
  }
  const targets = [
    { name: "web", key: "PORT", port: Number(env.PORT), host: "::" },
    { name: "api", key: "API_PORT", port: Number(env.API_PORT), host: env.API_HOST || "::" },
    { name: "worker", key: "WORKER_HEALTH_PORT", port: Number(env.WORKER_HEALTH_PORT), host: "0.0.0.0" },
  ].filter((target) => selected.includes(target.name));
  if (new Set(targets.map((target) => target.port)).size !== targets.length) {
    throw new Error("PORT, API_PORT and WORKER_HEALTH_PORT must use different ports.");
  }
  return targets;
}

export async function checkDevelopmentPorts(targets) {
  for (const target of targets) {
    await new Promise((resolvePort, reject) => {
      const server = createServer();
      server.once("error", (error) => {
        const reason =
          error.code === "EACCES"
            ? "reserved or blocked by the operating system"
            : error.code === "EADDRINUSE"
              ? "already in use"
              : "unavailable";
        reject(
          new Error(
            `${target.name}: port ${target.port} is ${reason} (${error.code}). Change ${target.key} in the root .env${target.name === "web" ? " and update APP_URL to match" : ""}. No application was started.`,
          ),
        );
      });
      server.listen({ port: target.port, host: target.host, exclusive: true }, () => {
        server.close((error) => (error ? reject(error) : resolvePort()));
      });
    });
  }
}

async function main() {
  const loaded = config({ path: resolve(root, ".env"), quiet: true });
  if (loaded.error)
    throw new Error("Cannot load the root .env. Copy .env.example to .env and configure local services first.");
  const args = process.argv.slice(2);
  const selected = args.filter((argument) => argument !== "--check");
  const env = developmentEnvironment(process.env);
  if (process.env.APP_URL && new URL(process.env.APP_URL).origin !== env.APP_URL) {
    console.log(`[dev] Using APP_URL=${env.APP_URL} to match PORT=${env.PORT} for local development.`);
  }
  const targets = developmentTargets(env, selected.length ? selected : services);
  await checkDevelopmentPorts(targets);
  console.log(
    `[dev] Web: ${env.APP_URL} | API: ${env.API_PUBLIC_URL} | Worker health: http://localhost:${env.WORKER_HEALTH_PORT}/health`,
  );
  if (args.includes("--check")) return;
  // Pass the loaded root environment only to local dev tasks. Production tasks
  // retain Turbo's strict environment filtering. Shell variables take precedence.
  const child = spawn(
    process.execPath,
    [
      require.resolve("turbo"),
      "run",
      "dev",
      ...targets.map((target) => `--filter=@calmboard/${target.name}`),
      "--env-mode=loose",
      "--ui=stream",
    ],
    {
      cwd: root,
      env,
      stdio: "inherit",
    },
  );
  child.once("error", (error) => {
    console.error(`[dev] ${error.message}`);
    process.exitCode = 1;
  });
  child.once("exit", (code, signal) => {
    process.exitCode = code ?? (signal === "SIGINT" ? 0 : 1);
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`[dev] ${error.message}`);
    process.exitCode = 1;
  });
}
