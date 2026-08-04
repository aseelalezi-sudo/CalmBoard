const DEFAULT_DATABASE_POOL_MAX = 10;
const MAX_DATABASE_POOL_MAX = 100;

export function databasePoolMax(env: NodeJS.ProcessEnv = process.env) {
  const raw = env.DATABASE_POOL_MAX;
  if (raw === undefined || raw.trim() === "") return DEFAULT_DATABASE_POOL_MAX;
  if (!/^\d+$/.test(raw)) {
    throw new Error("DATABASE_POOL_MAX must be an integer between 1 and 100");
  }
  const value = Number(raw);
  if (value < 1 || value > MAX_DATABASE_POOL_MAX) {
    throw new Error("DATABASE_POOL_MAX must be an integer between 1 and 100");
  }
  return value;
}
