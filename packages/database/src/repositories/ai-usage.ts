import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "../client.js";
import { assertWorkspaceTenantContext, type DatabaseTenantContext } from "../tenant-context.js";

export type AIUsageLimitResource = "requests" | "tokens";

export class AIUsageLimitExceededError extends Error {
  readonly code = "ai_usage_limit_exceeded";

  constructor(
    readonly resource: AIUsageLimitResource,
    readonly current: number,
    readonly limit: number,
  ) {
    super(`Monthly AI ${resource} limit exceeded`);
    this.name = "AIUsageLimitExceededError";
  }
}

export type AIUsageReservation = {
  id: string;
  periodStart: string;
  reservedTokens: number;
};

type ReservationRow = {
  event_id: string | null;
  period_start: string;
  request_count: string | number | null;
  used_tokens: string | number | null;
  reserved_tokens: string | number | null;
  max_requests: string | number;
  max_tokens: string | number;
};

function finiteNonnegativeInteger(value: number, name: string) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a non-negative safe integer`);
  return value;
}

function numeric(value: string | number | null | undefined) {
  const parsed = Number(value ?? 0);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error("AI usage counter is outside the safe range");
  return parsed;
}

function usageContext(context: DatabaseTenantContext) {
  assertWorkspaceTenantContext(context);
  if (!context.actorId) throw new Error("actorId is required for AI usage accounting");
  return context as DatabaseTenantContext & { workspaceId: string; actorId: string };
}

export function createAIUsageRepository(context: DatabaseTenantContext) {
  const tenant = usageContext(context);

  return {
    async reserve(action: string, reservedTokensInput: number): Promise<AIUsageReservation> {
      const reservedTokens = finiteNonnegativeInteger(reservedTokensInput, "reservedTokens");
      if (reservedTokens === 0) throw new Error("reservedTokens must be greater than zero");
      if (!/^[a-z_]{2,32}$/.test(action)) throw new Error("AI action is invalid");
      const eventId = randomUUID();
      const result = await db.execute<ReservationRow>(sql`
        with configured_limits as (
          select
            ${tenant.organizationId}::uuid as organization_id,
            date_trunc('month', timezone('UTC', now()))::date as period_start,
            "max_ai_requests_per_month"::bigint as max_requests,
            "max_ai_tokens_per_month"::bigint as max_tokens
          from "usage_limits"
          where "organization_id" = ${tenant.organizationId}::uuid
        ), reserved_period as (
          insert into "ai_usage_periods" (
            "organization_id", "period_start", "request_count", "reserved_tokens", "updated_at"
          )
          select "organization_id", "period_start", 1, ${reservedTokens}::bigint, now()
          from configured_limits
          where max_requests >= 1 and max_tokens >= ${reservedTokens}::bigint
          on conflict ("organization_id", "period_start") do update set
            "request_count" = "ai_usage_periods"."request_count" + 1,
            "reserved_tokens" = "ai_usage_periods"."reserved_tokens" + ${reservedTokens}::bigint,
            "updated_at" = now()
          where
            "ai_usage_periods"."request_count" + 1 <= (select max_requests from configured_limits)
            and "ai_usage_periods"."input_tokens" + "ai_usage_periods"."output_tokens"
              + "ai_usage_periods"."reserved_tokens" + ${reservedTokens}::bigint
              <= (select max_tokens from configured_limits)
          returning "period_start", "request_count", "reserved_tokens", "input_tokens" + "output_tokens" as used_tokens
        ), created_event as (
          insert into "ai_usage_events" (
            "id", "organization_id", "workspace_id", "actor_id", "period_start", "action", "reserved_tokens"
          )
          select
            ${eventId}::uuid, ${tenant.organizationId}::uuid, ${tenant.workspaceId}::uuid,
            ${tenant.actorId}::uuid, "period_start", ${action}, ${reservedTokens}::bigint
          from reserved_period
          returning "id"
        )
        select
          (select "id"::text from created_event) as event_id,
          configured_limits.period_start::text as period_start,
          coalesce(reserved_period.request_count, current_period."request_count", 0) as request_count,
          coalesce(reserved_period.used_tokens, current_period."input_tokens" + current_period."output_tokens", 0) as used_tokens,
          coalesce(reserved_period.reserved_tokens, current_period."reserved_tokens", 0) as reserved_tokens,
          configured_limits.max_requests,
          configured_limits.max_tokens
        from configured_limits
        left join reserved_period on true
        left join "ai_usage_periods" as current_period
          on current_period."organization_id" = configured_limits.organization_id
          and current_period."period_start" = configured_limits.period_start
      `);
      const row = result.rows[0];
      if (!row) throw new Error("AI usage limits are not configured for this organization");
      if (!row.event_id) {
        const requestCount = numeric(row.request_count);
        const maxRequests = numeric(row.max_requests);
        if (requestCount + 1 > maxRequests) {
          throw new AIUsageLimitExceededError("requests", requestCount, maxRequests);
        }
        const tokens = numeric(row.used_tokens) + numeric(row.reserved_tokens);
        throw new AIUsageLimitExceededError("tokens", tokens, numeric(row.max_tokens));
      }
      return { id: row.event_id, periodStart: row.period_start, reservedTokens };
    },

    async complete(
      reservation: AIUsageReservation,
      usage: { inputTokens: number; outputTokens: number; estimatedCostMicrousd: number },
      provider: string,
      model: string,
    ) {
      const inputTokens = finiteNonnegativeInteger(usage.inputTokens, "inputTokens");
      const outputTokens = finiteNonnegativeInteger(usage.outputTokens, "outputTokens");
      const estimatedCostMicrousd = finiteNonnegativeInteger(usage.estimatedCostMicrousd, "estimatedCostMicrousd");
      if (!provider.trim() || provider.length > 50) throw new Error("AI provider is invalid");
      if (!model.trim() || model.length > 160) throw new Error("AI model is invalid");
      const result = await db.execute<{ finalized: boolean }>(sql`
        with finalized_event as (
          update "ai_usage_events"
          set
            "status" = 'completed',
            "provider" = ${provider.trim()},
            "model" = ${model.trim()},
            "input_tokens" = ${inputTokens}::bigint,
            "output_tokens" = ${outputTokens}::bigint,
            "estimated_cost_microusd" = ${estimatedCostMicrousd}::bigint,
            "completed_at" = now()
          where
            "id" = ${reservation.id}::uuid
            and "organization_id" = ${tenant.organizationId}::uuid
            and "status" = 'pending'
          returning "period_start", "reserved_tokens"
        ), updated_period as (
          update "ai_usage_periods" as period
          set
            "reserved_tokens" = greatest(0, period."reserved_tokens" - finalized_event."reserved_tokens"),
            "input_tokens" = period."input_tokens" + ${inputTokens}::bigint,
            "output_tokens" = period."output_tokens" + ${outputTokens}::bigint,
            "estimated_cost_microusd" = period."estimated_cost_microusd" + ${estimatedCostMicrousd}::bigint,
            "updated_at" = now()
          from finalized_event
          where
            period."organization_id" = ${tenant.organizationId}::uuid
            and period."period_start" = finalized_event."period_start"
          returning period."id"
        )
        select exists(select 1 from updated_period) as finalized
      `);
      if (result.rows[0]?.finalized !== true) throw new Error("AI usage reservation could not be completed");
    },

    async fail(reservation: AIUsageReservation, failureCode: string) {
      const normalizedFailureCode = failureCode.trim().toLowerCase();
      if (!/^[a-z0-9_]{2,80}$/.test(normalizedFailureCode)) throw new Error("AI failure code is invalid");
      const result = await db.execute<{ finalized: boolean }>(sql`
        with finalized_event as (
          update "ai_usage_events"
          set "status" = 'failed', "failure_code" = ${normalizedFailureCode}, "completed_at" = now()
          where
            "id" = ${reservation.id}::uuid
            and "organization_id" = ${tenant.organizationId}::uuid
            and "status" = 'pending'
          returning "period_start", "reserved_tokens"
        ), updated_period as (
          update "ai_usage_periods" as period
          set
            "reserved_tokens" = greatest(0, period."reserved_tokens" - finalized_event."reserved_tokens"),
            "updated_at" = now()
          from finalized_event
          where
            period."organization_id" = ${tenant.organizationId}::uuid
            and period."period_start" = finalized_event."period_start"
          returning period."id"
        )
        select exists(select 1 from updated_period) as finalized
      `);
      if (result.rows[0]?.finalized !== true) throw new Error("AI usage reservation could not be failed");
    },
  };
}
