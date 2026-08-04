ALTER TABLE "subscriptions" ADD COLUMN "provider_event_created_at" timestamp with time zone;
--> statement-breakpoint
CREATE INDEX "subscriptions_grace_period_due_idx" ON "subscriptions" USING btree ("status","grace_period_ends_at") WHERE "subscriptions"."ended_at" is null;
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
