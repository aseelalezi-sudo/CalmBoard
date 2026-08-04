import { createHash, randomUUID } from "node:crypto";
import { and, eq, lte, or } from "drizzle-orm";
import { db } from "../client.js";
import { TenantConflictError } from "../errors.js";
import { idempotencyKeys } from "../schema.js";
import { assertTenantContext, type DatabaseTenantContext } from "../tenant-context.js";

const defaultTtlMs = 24 * 60 * 60 * 1_000;
const defaultStaleLockMs = 2 * 60 * 1_000;

export class IdempotencyKeyReuseError extends TenantConflictError {
  constructor() {
    super("idempotency key was already used with a different request");
    this.name = "IdempotencyKeyReuseError";
  }
}

export class IdempotencyRequestInProgressError extends TenantConflictError {
  constructor() {
    super("an identical request with this idempotency key is still processing");
    this.name = "IdempotencyRequestInProgressError";
  }
}

function canonicalize(value: unknown, seen = new Set<object>()): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TenantConflictError("idempotency request contains a non-finite number");
    return value;
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((entry) => canonicalize(entry, seen));
  if (typeof value === "object") {
    if (seen.has(value)) throw new TenantConflictError("idempotency request contains a circular value");
    seen.add(value);
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const entry = (value as Record<string, unknown>)[key];
      if (entry !== undefined) result[key] = canonicalize(entry, seen);
    }
    seen.delete(value);
    return result;
  }
  if (value === undefined) return null;
  throw new TenantConflictError("idempotency request contains an unsupported value");
}

export function hashIdempotencyRequest(value: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)), "utf8")
    .digest("hex");
}

function normalizeJsonResponse(value: unknown) {
  if (value === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(value)) as unknown;
  } catch (error) {
    throw new TenantConflictError("idempotent response must be JSON serializable", { cause: error });
  }
}

function normalizeKey(value: string) {
  const key = value.trim();
  if (key.length < 8 || key.length > 255 || /[\u0000-\u001f\u007f]/.test(key)) {
    throw new TenantConflictError("idempotency key must contain between 8 and 255 printable characters");
  }
  return key;
}

function normalizeScope(value: string) {
  const scope = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_.:-]{1,159}$/.test(scope)) throw new TenantConflictError("idempotency scope is invalid");
  return scope;
}

export function createIdempotencyRepository(context: DatabaseTenantContext) {
  assertTenantContext(context);
  const { organizationId, workspaceId = null, actorId = null } = context;

  return {
    async execute<T>(input: {
      key: string;
      scope: string;
      request: unknown;
      operation: () => Promise<{ body: T; statusCode?: number }>;
      ttlMs?: number;
      staleLockMs?: number;
    }): Promise<{ body: T; statusCode: number; replayed: boolean }> {
      const key = normalizeKey(input.key);
      const scope = normalizeScope(input.scope);
      const requestHash = hashIdempotencyRequest(input.request);
      const ttlMs = input.ttlMs ?? defaultTtlMs;
      const staleLockMs = input.staleLockMs ?? defaultStaleLockMs;
      if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0 || !Number.isSafeInteger(staleLockMs) || staleLockMs <= 0) {
        throw new TenantConflictError("idempotency timing configuration is invalid");
      }

      const now = new Date();
      const lockToken = randomUUID();
      const expiresAt = new Date(now.getTime() + ttlMs);
      const [inserted] = await db
        .insert(idempotencyKeys)
        .values({
          organizationId,
          workspaceId,
          actorId,
          key,
          scope,
          requestHash,
          lockToken,
          lockedAt: now,
          expiresAt,
        })
        .onConflictDoNothing({
          target: [idempotencyKeys.organizationId, idempotencyKeys.scope, idempotencyKeys.key],
        })
        .returning();

      let owned = inserted;
      if (!owned) {
        const [existing] = await db
          .select()
          .from(idempotencyKeys)
          .where(
            and(
              eq(idempotencyKeys.organizationId, organizationId),
              eq(idempotencyKeys.scope, scope),
              eq(idempotencyKeys.key, key),
            ),
          )
          .limit(1);
        if (!existing) throw new IdempotencyRequestInProgressError();

        if (existing.expiresAt <= now) {
          const [removed] = await db
            .delete(idempotencyKeys)
            .where(and(eq(idempotencyKeys.id, existing.id), lte(idempotencyKeys.expiresAt, now)))
            .returning({ id: idempotencyKeys.id });
          if (!removed) throw new IdempotencyRequestInProgressError();
          return this.execute(input);
        }
        if (existing.requestHash !== requestHash) throw new IdempotencyKeyReuseError();
        if (existing.status === "completed") {
          return {
            body: existing.responseBody as T,
            statusCode: existing.responseStatusCode!,
            replayed: true,
          };
        }

        const staleBefore = new Date(now.getTime() - staleLockMs);
        const nextLockToken = randomUUID();
        const [claimed] = await db
          .update(idempotencyKeys)
          .set({
            status: "processing",
            lockToken: nextLockToken,
            attempts: existing.attempts + 1,
            lockedAt: now,
            expiresAt,
            updatedAt: now,
          })
          .where(
            and(
              eq(idempotencyKeys.id, existing.id),
              eq(idempotencyKeys.lockToken, existing.lockToken),
              or(eq(idempotencyKeys.status, "failed"), lte(idempotencyKeys.lockedAt, staleBefore)),
            ),
          )
          .returning();
        if (!claimed) throw new IdempotencyRequestInProgressError();
        owned = claimed;
      }

      try {
        const result = await input.operation();
        const statusCode = result.statusCode ?? 200;
        if (!Number.isInteger(statusCode) || statusCode < 100 || statusCode > 599) {
          throw new TenantConflictError("idempotent response status code is invalid");
        }
        const responseBody = normalizeJsonResponse(result.body);
        const completedAt = new Date();
        const [completed] = await db
          .update(idempotencyKeys)
          .set({
            status: "completed",
            responseStatusCode: statusCode,
            responseBody,
            completedAt,
            updatedAt: completedAt,
          })
          .where(
            and(
              eq(idempotencyKeys.id, owned.id),
              eq(idempotencyKeys.lockToken, owned.lockToken),
              eq(idempotencyKeys.status, "processing"),
            ),
          )
          .returning({ id: idempotencyKeys.id });
        if (!completed) throw new IdempotencyRequestInProgressError();
        return { body: result.body, statusCode, replayed: false };
      } catch (error) {
        await db
          .update(idempotencyKeys)
          .set({ status: "failed", updatedAt: new Date() })
          .where(
            and(
              eq(idempotencyKeys.id, owned.id),
              eq(idempotencyKeys.lockToken, owned.lockToken),
              eq(idempotencyKeys.status, "processing"),
            ),
          )
          .catch(() => undefined);
        throw error;
      }
    },

    async purgeExpired(now = new Date()) {
      return db
        .delete(idempotencyKeys)
        .where(lte(idempotencyKeys.expiresAt, now))
        .returning({ id: idempotencyKeys.id });
    },
  };
}
