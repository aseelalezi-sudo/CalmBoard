CREATE TYPE "public"."ai_usage_status" AS ENUM('pending', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "ai_usage_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"action" varchar(32) NOT NULL,
	"status" "ai_usage_status" DEFAULT 'pending' NOT NULL,
	"provider" varchar(50),
	"model" varchar(160),
	"reserved_tokens" bigint NOT NULL,
	"input_tokens" bigint DEFAULT 0 NOT NULL,
	"output_tokens" bigint DEFAULT 0 NOT NULL,
	"estimated_cost_microusd" bigint DEFAULT 0 NOT NULL,
	"failure_code" varchar(80),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "ai_usage_events_reserved_tokens_check" CHECK ("ai_usage_events"."reserved_tokens" > 0),
	CONSTRAINT "ai_usage_events_totals_check" CHECK ("ai_usage_events"."input_tokens" >= 0 and "ai_usage_events"."output_tokens" >= 0 and "ai_usage_events"."estimated_cost_microusd" >= 0),
	CONSTRAINT "ai_usage_events_terminal_state_check" CHECK (("ai_usage_events"."status" = 'pending' and "ai_usage_events"."completed_at" is null) or ("ai_usage_events"."status" <> 'pending' and "ai_usage_events"."completed_at" is not null)),
	CONSTRAINT "ai_usage_events_failure_check" CHECK (("ai_usage_events"."status" = 'failed' and "ai_usage_events"."failure_code" is not null) or ("ai_usage_events"."status" <> 'failed' and "ai_usage_events"."failure_code" is null))
);
--> statement-breakpoint
CREATE TABLE "ai_usage_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"request_count" bigint DEFAULT 0 NOT NULL,
	"reserved_tokens" bigint DEFAULT 0 NOT NULL,
	"input_tokens" bigint DEFAULT 0 NOT NULL,
	"output_tokens" bigint DEFAULT 0 NOT NULL,
	"estimated_cost_microusd" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_usage_periods_nonnegative_check" CHECK ("ai_usage_periods"."request_count" >= 0 and "ai_usage_periods"."reserved_tokens" >= 0 and "ai_usage_periods"."input_tokens" >= 0 and "ai_usage_periods"."output_tokens" >= 0 and "ai_usage_periods"."estimated_cost_microusd" >= 0)
);
--> statement-breakpoint
ALTER TABLE "subscription_plans" DROP CONSTRAINT "subscription_plans_limits_check";--> statement-breakpoint
ALTER TABLE "subscription_plans" ADD COLUMN "max_ai_requests_per_month" integer;--> statement-breakpoint
ALTER TABLE "subscription_plans" ADD COLUMN "max_ai_tokens_per_month" bigint;--> statement-breakpoint
UPDATE "subscription_plans"
SET
	"max_ai_requests_per_month" = CASE "key"
		WHEN 'free' THEN 20
		WHEN 'starter' THEN 200
		WHEN 'team' THEN 1000
		WHEN 'business' THEN 5000
		ELSE 25000
	END,
	"max_ai_tokens_per_month" = CASE "key"
		WHEN 'free' THEN 50000
		WHEN 'starter' THEN 500000
		WHEN 'team' THEN 3000000
		WHEN 'business' THEN 20000000
		ELSE 100000000
	END;--> statement-breakpoint
ALTER TABLE "subscription_plans" ALTER COLUMN "max_ai_requests_per_month" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "subscription_plans" ALTER COLUMN "max_ai_tokens_per_month" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_limits" ADD COLUMN "max_ai_requests_per_month" integer DEFAULT 20 NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_limits" ADD COLUMN "max_ai_tokens_per_month" bigint DEFAULT 50000 NOT NULL;--> statement-breakpoint
UPDATE "usage_limits" AS limits
SET
	"max_ai_requests_per_month" = plan."max_ai_requests_per_month",
	"max_ai_tokens_per_month" = plan."max_ai_tokens_per_month",
	"updated_at" = now()
FROM "subscriptions" AS subscription
JOIN "subscription_plans" AS plan ON plan."id" = subscription."plan_id"
WHERE subscription."organization_id" = limits."organization_id" AND subscription."ended_at" IS NULL;--> statement-breakpoint
ALTER TABLE "ai_usage_events" ADD CONSTRAINT "ai_usage_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage_events" ADD CONSTRAINT "ai_usage_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage_events" ADD CONSTRAINT "ai_usage_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage_periods" ADD CONSTRAINT "ai_usage_periods_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_usage_events_organization_created_idx" ON "ai_usage_events" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_usage_events_period_status_idx" ON "ai_usage_events" USING btree ("organization_id","period_start","status");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_usage_periods_organization_period_unique" ON "ai_usage_periods" USING btree ("organization_id","period_start");--> statement-breakpoint
CREATE INDEX "ai_usage_periods_period_idx" ON "ai_usage_periods" USING btree ("period_start","organization_id");--> statement-breakpoint
ALTER TABLE "subscription_plans" ADD CONSTRAINT "subscription_plans_limits_check" CHECK ("subscription_plans"."max_projects" >= 0 and "subscription_plans"."max_tasks" >= 0 and "subscription_plans"."max_storage_mb" >= 0 and "subscription_plans"."max_ai_requests_per_month" >= 0 and "subscription_plans"."max_ai_tokens_per_month" >= 0 and "subscription_plans"."trial_days" >= 0);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION sync_current_subscription_projection()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	selected_plan "subscription_plans"%ROWTYPE;
	projection_seats integer;
BEGIN
	IF NEW."ended_at" IS NOT NULL THEN
		SELECT * INTO selected_plan
		FROM "subscription_plans"
		WHERE "key" = 'free' AND "is_active" = true
		LIMIT 1;
		IF NOT FOUND THEN
			RAISE EXCEPTION 'An active free plan is required when a subscription ends';
		END IF;
		projection_seats := selected_plan."max_seats";
	ELSE
		SELECT * INTO selected_plan FROM "subscription_plans" WHERE "id" = NEW."plan_id";
		projection_seats := NEW."seats";
	END IF;

	UPDATE "organizations"
	SET "plan" = selected_plan."key", "seats" = projection_seats, "updated_at" = now()
	WHERE "id" = NEW."organization_id";

	INSERT INTO "usage_limits" (
		"organization_id", "max_seats", "max_projects", "max_tasks", "max_storage_mb",
		"max_ai_requests_per_month", "max_ai_tokens_per_month", "updated_at"
	) VALUES (
		NEW."organization_id", projection_seats, selected_plan."max_projects",
		selected_plan."max_tasks", selected_plan."max_storage_mb",
		selected_plan."max_ai_requests_per_month", selected_plan."max_ai_tokens_per_month", now()
	)
	ON CONFLICT ("organization_id") DO UPDATE SET
		"max_seats" = excluded."max_seats",
		"max_projects" = excluded."max_projects",
		"max_tasks" = excluded."max_tasks",
		"max_storage_mb" = excluded."max_storage_mb",
		"max_ai_requests_per_month" = excluded."max_ai_requests_per_month",
		"max_ai_tokens_per_month" = excluded."max_ai_tokens_per_month",
		"updated_at" = excluded."updated_at";
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION sync_subscription_plan_usage_limits()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	UPDATE "usage_limits" AS limits
	SET
		"max_projects" = NEW."max_projects",
		"max_tasks" = NEW."max_tasks",
		"max_storage_mb" = NEW."max_storage_mb",
		"max_ai_requests_per_month" = NEW."max_ai_requests_per_month",
		"max_ai_tokens_per_month" = NEW."max_ai_tokens_per_month",
		"updated_at" = now()
	FROM "subscriptions" AS subscription
	WHERE subscription."organization_id" = limits."organization_id"
		AND subscription."plan_id" = NEW."id"
		AND subscription."ended_at" IS NULL;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "subscription_plans_sync_usage_limits"
AFTER UPDATE OF "max_projects", "max_tasks", "max_storage_mb", "max_ai_requests_per_month", "max_ai_tokens_per_month"
ON "subscription_plans"
FOR EACH ROW EXECUTE FUNCTION sync_subscription_plan_usage_limits();
--> statement-breakpoint
ALTER TABLE public.ai_usage_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_usage_periods FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.ai_usage_periods
USING (organization_id = public.app_current_organization_id())
WITH CHECK (organization_id = public.app_current_organization_id());
--> statement-breakpoint
ALTER TABLE public.ai_usage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_usage_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.ai_usage_events
USING (public.app_tenant_matches(organization_id, workspace_id))
WITH CHECK (public.app_tenant_matches(organization_id, workspace_id));
