export type RuntimeConfig = {
  appUrl: string;
  databaseUrl?: string;
  redisUrl?: string;
  nodeEnv: string;
};

export function readRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  return {
    appUrl: env.APP_URL ?? "http://localhost:3000",
    databaseUrl: env.DATABASE_URL,
    redisUrl: env.REDIS_URL,
    nodeEnv: env.NODE_ENV ?? "development",
  };
}
