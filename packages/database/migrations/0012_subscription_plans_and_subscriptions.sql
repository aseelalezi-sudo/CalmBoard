CREATE TYPE "public"."subscription_billing_interval" AS ENUM('monthly', 'yearly');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('trialing', 'active', 'past_due', 'grace_period', 'paused', 'canceled', 'incomplete');--> statement-breakpoint
CREATE TABLE "subscription_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" "org_plan" NOT NULL,
	"name" varchar(120) NOT NULL,
	"description" text,
	"monthly_price_cents" integer DEFAULT 0 NOT NULL,
	"yearly_price_cents" integer DEFAULT 0 NOT NULL,
	"currency" varchar(3) DEFAULT 'USD' NOT NULL,
	"min_seats" integer DEFAULT 1 NOT NULL,
	"max_seats" integer NOT NULL,
	"max_projects" integer NOT NULL,
	"max_tasks" integer NOT NULL,
	"max_storage_mb" integer NOT NULL,
	"trial_days" integer DEFAULT 0 NOT NULL,
	"features" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_public" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_plans_prices_check" CHECK ("subscription_plans"."monthly_price_cents" >= 0 and "subscription_plans"."yearly_price_cents" >= 0),
	CONSTRAINT "subscription_plans_seats_check" CHECK ("subscription_plans"."min_seats" > 0 and "subscription_plans"."max_seats" >= "subscription_plans"."min_seats"),
	CONSTRAINT "subscription_plans_limits_check" CHECK ("subscription_plans"."max_projects" >= 0 and "subscription_plans"."max_tasks" >= 0 and "subscription_plans"."max_storage_mb" >= 0 and "subscription_plans"."trial_days" >= 0),
	CONSTRAINT "subscription_plans_currency_check" CHECK ("subscription_plans"."currency" = upper("subscription_plans"."currency"))
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"status" "subscription_status" DEFAULT 'active' NOT NULL,
	"billing_interval" "subscription_billing_interval" DEFAULT 'monthly' NOT NULL,
	"seats" integer DEFAULT 1 NOT NULL,
	"unit_price_cents" integer DEFAULT 0 NOT NULL,
	"currency" varchar(3) DEFAULT 'USD' NOT NULL,
	"provider" varchar(50) DEFAULT 'internal' NOT NULL,
	"provider_customer_id" varchar(255),
	"provider_subscription_id" varchar(255),
	"current_period_start" timestamp with time zone DEFAULT now() NOT NULL,
	"current_period_end" timestamp with time zone NOT NULL,
	"trial_ends_at" timestamp with time zone,
	"grace_period_ends_at" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"canceled_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_seats_check" CHECK ("subscriptions"."seats" > 0),
	CONSTRAINT "subscriptions_price_check" CHECK ("subscriptions"."unit_price_cents" >= 0),
	CONSTRAINT "subscriptions_currency_check" CHECK ("subscriptions"."currency" = upper("subscriptions"."currency")),
	CONSTRAINT "subscriptions_period_check" CHECK ("subscriptions"."current_period_end" > "subscriptions"."current_period_start"),
	CONSTRAINT "subscriptions_trial_check" CHECK ("subscriptions"."status" <> 'trialing' or "subscriptions"."trial_ends_at" is not null),
	CONSTRAINT "subscriptions_grace_period_check" CHECK ("subscriptions"."status" <> 'grace_period' or "subscriptions"."grace_period_ends_at" is not null),
	CONSTRAINT "subscriptions_canceled_check" CHECK ("subscriptions"."status" <> 'canceled' or ("subscriptions"."canceled_at" is not null and "subscriptions"."ended_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_subscription_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."subscription_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_plans_key_unique" ON "subscription_plans" USING btree ("key");--> statement-breakpoint
CREATE INDEX "subscription_plans_catalog_idx" ON "subscription_plans" USING btree ("is_active","is_public","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_organization_current_unique" ON "subscriptions" USING btree ("organization_id") WHERE "subscriptions"."ended_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_provider_subscription_unique" ON "subscriptions" USING btree ("provider","provider_subscription_id") WHERE "subscriptions"."provider_subscription_id" is not null;--> statement-breakpoint
CREATE INDEX "subscriptions_organization_status_idx" ON "subscriptions" USING btree ("organization_id","status","current_period_end");--> statement-breakpoint
CREATE INDEX "subscriptions_provider_customer_idx" ON "subscriptions" USING btree ("provider","provider_customer_id");
--> statement-breakpoint
ALTER TABLE "usage_limits" DROP CONSTRAINT "usage_limits_organization_id_organizations_id_fk";
--> statement-breakpoint
ALTER TABLE "usage_limits" ADD CONSTRAINT "usage_limits_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
INSERT INTO "subscription_plans" (
	"id", "key", "name", "description", "monthly_price_cents", "yearly_price_cents", "currency",
	"min_seats", "max_seats", "max_projects", "max_tasks", "max_storage_mb", "trial_days", "features", "sort_order"
) VALUES
	('10000000-0000-4000-8000-000000000001', 'free', 'Free', 'For personal evaluation and small projects.', 0, 0, 'USD', 1, 3, 3, 500, 1024, 0, '{"automations":false,"advanced_reports":false,"sso":false}'::jsonb, 10),
	('10000000-0000-4000-8000-000000000002', 'starter', 'Starter', 'For individuals and growing personal workflows.', 400, 4000, 'USD', 1, 10, 10, 5000, 10240, 14, '{"automations":true,"advanced_reports":false,"sso":false}'::jsonb, 20),
	('10000000-0000-4000-8000-000000000003', 'team', 'Team', 'For teams collaborating across projects.', 800, 8000, 'USD', 1, 25, 50, 25000, 51200, 14, '{"automations":true,"advanced_reports":true,"sso":false}'::jsonb, 30),
	('10000000-0000-4000-8000-000000000004', 'business', 'Business', 'For organizations that need governance and scale.', 1600, 16000, 'USD', 1, 100, 1000, 100000, 100000, 14, '{"automations":true,"advanced_reports":true,"sso":true}'::jsonb, 40),
	('10000000-0000-4000-8000-000000000005', 'enterprise', 'Enterprise', 'For large organizations with advanced controls.', 4500, 45000, 'USD', 1, 1000, 10000, 1000000, 1000000, 30, '{"automations":true,"advanced_reports":true,"sso":true}'::jsonb, 50)
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint
INSERT INTO "subscriptions" (
	"organization_id", "plan_id", "status", "billing_interval", "seats", "unit_price_cents", "currency",
	"provider", "current_period_start", "current_period_end"
)
SELECT
	o."id",
	p."id",
	'active',
	'monthly',
	greatest(p."min_seats", least(o."seats", p."max_seats")),
	p."monthly_price_cents",
	p."currency",
	'internal',
	now(),
	now() + interval '1 month'
FROM "organizations" o
JOIN "subscription_plans" p ON p."key" = o."plan"
ON CONFLICT DO NOTHING;
--> statement-breakpoint
UPDATE "organizations" o
SET "seats" = s."seats", "updated_at" = now()
FROM "subscriptions" s
WHERE s."organization_id" = o."id" AND s."ended_at" IS NULL;
--> statement-breakpoint
INSERT INTO "usage_limits" (
	"organization_id", "max_seats", "max_projects", "max_tasks", "max_storage_mb", "updated_at"
)
SELECT
	s."organization_id", p."max_seats", p."max_projects", p."max_tasks", p."max_storage_mb", now()
FROM "subscriptions" s
JOIN "subscription_plans" p ON p."id" = s."plan_id"
WHERE s."ended_at" IS NULL
ON CONFLICT ("organization_id") DO UPDATE SET
	"max_seats" = excluded."max_seats",
	"max_projects" = excluded."max_projects",
	"max_tasks" = excluded."max_tasks",
	"max_storage_mb" = excluded."max_storage_mb",
	"updated_at" = excluded."updated_at";
--> statement-breakpoint
CREATE OR REPLACE FUNCTION validate_subscription_plan_and_seats()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	selected_plan "subscription_plans"%ROWTYPE;
BEGIN
	SELECT * INTO selected_plan FROM "subscription_plans" WHERE "id" = NEW."plan_id";
	IF NOT FOUND THEN
		RAISE EXCEPTION 'Subscription plan does not exist';
	END IF;
	IF NEW."ended_at" IS NULL AND NOT selected_plan."is_active" THEN
		RAISE EXCEPTION 'Cannot activate a subscription on an inactive plan';
	END IF;
	IF NEW."seats" < selected_plan."min_seats" OR NEW."seats" > selected_plan."max_seats" THEN
		RAISE EXCEPTION 'Subscription seats must be between % and % for plan %', selected_plan."min_seats", selected_plan."max_seats", selected_plan."key";
	END IF;
	NEW."updated_at" := now();
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "subscriptions_validate_plan_and_seats"
BEFORE INSERT OR UPDATE OF "plan_id", "seats", "ended_at" ON "subscriptions"
FOR EACH ROW EXECUTE FUNCTION validate_subscription_plan_and_seats();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION sync_current_subscription_projection()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	selected_plan "subscription_plans"%ROWTYPE;
BEGIN
	IF NEW."ended_at" IS NOT NULL THEN
		RETURN NEW;
	END IF;
	SELECT * INTO selected_plan FROM "subscription_plans" WHERE "id" = NEW."plan_id";
	UPDATE "organizations"
	SET "plan" = selected_plan."key", "seats" = NEW."seats", "updated_at" = now()
	WHERE "id" = NEW."organization_id";
	INSERT INTO "usage_limits" (
		"organization_id", "max_seats", "max_projects", "max_tasks", "max_storage_mb", "updated_at"
	) VALUES (
		NEW."organization_id", selected_plan."max_seats", selected_plan."max_projects",
		selected_plan."max_tasks", selected_plan."max_storage_mb", now()
	)
	ON CONFLICT ("organization_id") DO UPDATE SET
		"max_seats" = excluded."max_seats",
		"max_projects" = excluded."max_projects",
		"max_tasks" = excluded."max_tasks",
		"max_storage_mb" = excluded."max_storage_mb",
		"updated_at" = excluded."updated_at";
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "subscriptions_sync_current_projection"
AFTER INSERT OR UPDATE OF "plan_id", "seats", "ended_at" ON "subscriptions"
FOR EACH ROW EXECUTE FUNCTION sync_current_subscription_projection();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_subscription_plan_changes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF NEW."key" <> OLD."key" AND EXISTS (SELECT 1 FROM "subscriptions" WHERE "plan_id" = OLD."id") THEN
		RAISE EXCEPTION 'Cannot change the key of a subscription plan that is in use';
	END IF;
	IF EXISTS (
		SELECT 1 FROM "subscriptions"
		WHERE "plan_id" = OLD."id" AND "ended_at" IS NULL
		AND ("seats" < NEW."min_seats" OR "seats" > NEW."max_seats")
	) THEN
		RAISE EXCEPTION 'Plan seat limits conflict with a current subscription';
	END IF;
	NEW."updated_at" := now();
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "subscription_plans_guard_changes"
BEFORE UPDATE OF "key", "min_seats", "max_seats" ON "subscription_plans"
FOR EACH ROW EXECUTE FUNCTION guard_subscription_plan_changes();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION create_default_organization_subscription()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	selected_plan "subscription_plans"%ROWTYPE;
BEGIN
	SELECT * INTO selected_plan FROM "subscription_plans" WHERE "key" = NEW."plan" AND "is_active" = true;
	IF NOT FOUND THEN
		RAISE EXCEPTION 'No active subscription plan exists for organization plan %', NEW."plan";
	END IF;
	INSERT INTO "subscriptions" (
		"organization_id", "plan_id", "status", "billing_interval", "seats", "unit_price_cents", "currency",
		"provider", "current_period_start", "current_period_end"
	) VALUES (
		NEW."id", selected_plan."id", 'active', 'monthly',
		greatest(selected_plan."min_seats", least(NEW."seats", selected_plan."max_seats")),
		selected_plan."monthly_price_cents", selected_plan."currency", 'internal', now(), now() + interval '1 month'
	);
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "organizations_create_default_subscription"
AFTER INSERT ON "organizations"
FOR EACH ROW EXECUTE FUNCTION create_default_organization_subscription();
