export class TenantResourceNotFoundError extends Error {
  constructor(resource: string) {
    super(`${resource} was not found in the current tenant`);
    this.name = "TenantResourceNotFoundError";
  }
}

export class TenantPermissionDeniedError extends Error {
  constructor(message = "permission denied in the current tenant") {
    super(message);
    this.name = "TenantPermissionDeniedError";
  }
}

export class TenantConflictError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "TenantConflictError";
  }
}

export type TenantUsageLimitResource = "seats" | "projects" | "tasks" | "storage";

export class TenantUsageLimitExceededError extends Error {
  constructor(
    readonly resource: TenantUsageLimitResource,
    readonly current: number,
    readonly limit: number,
  ) {
    super(`The ${resource} usage limit has been reached`);
    this.name = "TenantUsageLimitExceededError";
  }
}

export function usageLimitErrorFromDatabase(error: unknown) {
  const candidate = error as {
    code?: unknown;
    constraint?: unknown;
    detail?: unknown;
    cause?: unknown;
  };
  const databaseError = (candidate?.cause && typeof candidate.cause === "object" ? candidate.cause : candidate) as {
    code?: unknown;
    constraint?: unknown;
    detail?: unknown;
  };
  const code = typeof databaseError.code === "string" ? databaseError.code : undefined;
  const constraint = typeof databaseError.constraint === "string" ? databaseError.constraint : undefined;
  const detail = typeof databaseError.detail === "string" ? databaseError.detail : undefined;
  const resource = constraint?.match(/^usage_limits_(seats|projects|tasks|storage)$/)?.[1] as
    TenantUsageLimitResource | undefined;
  const values = detail?.match(/^resource=(?:seats|projects|tasks|storage),current=(\d+),limit=(\d+)$/);
  if (code !== "P0001" || !resource || !values) return undefined;
  return new TenantUsageLimitExceededError(resource, Number(values[1]), Number(values[2]));
}
