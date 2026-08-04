ALTER TABLE "usage_limits" ADD COLUMN "current_seats" bigint DEFAULT 0 NOT NULL;
ALTER TABLE "usage_limits" ADD COLUMN "current_projects" bigint DEFAULT 0 NOT NULL;
ALTER TABLE "usage_limits" ADD COLUMN "current_tasks" bigint DEFAULT 0 NOT NULL;
ALTER TABLE "usage_limits" ADD COLUMN "current_storage_bytes" bigint DEFAULT 0 NOT NULL;
--> statement-breakpoint
UPDATE "usage_limits" AS limits
SET
	"max_seats" = organization."seats",
	"current_seats" = (SELECT count(DISTINCT membership."user_id") FROM "memberships" AS membership WHERE membership."organization_id" = limits."organization_id" AND membership."status" = 'active'),
	"current_projects" = (SELECT count(*) FROM "projects" AS project WHERE project."organization_id" = limits."organization_id" AND project."deleted_at" IS NULL),
	"current_tasks" = (SELECT count(*) FROM "tasks" AS task WHERE task."organization_id" = limits."organization_id" AND task."deleted_at" IS NULL),
	"current_storage_bytes" = (SELECT coalesce(sum(attachment."file_size"::bigint), 0) FROM "attachments" AS attachment WHERE attachment."organization_id" = limits."organization_id" AND attachment."deleted_at" IS NULL),
	"updated_at" = now()
FROM "organizations" AS organization
WHERE organization."id" = limits."organization_id";
--> statement-breakpoint
ALTER TABLE "usage_limits" ADD CONSTRAINT "usage_limits_current_nonnegative_check" CHECK (
	"current_seats" >= 0 AND "current_projects" >= 0 AND "current_tasks" >= 0 AND "current_storage_bytes" >= 0
);
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
		NEW."organization_id", projection_seats, selected_plan."max_projects",
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
CREATE OR REPLACE FUNCTION apply_organization_usage_delta(
	organization_id_input uuid,
	resource_name text,
	delta_value bigint
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
	current_usage bigint;
	configured_limit bigint;
BEGIN
	IF delta_value = 0 THEN
		RETURN;
	END IF;
	IF resource_name NOT IN ('projects', 'tasks', 'storage') THEN
		RAISE EXCEPTION 'Unsupported usage resource %', resource_name;
	END IF;

	UPDATE "usage_limits"
	SET
		"current_projects" = "current_projects" + CASE WHEN resource_name = 'projects' THEN delta_value ELSE 0 END,
		"current_tasks" = "current_tasks" + CASE WHEN resource_name = 'tasks' THEN delta_value ELSE 0 END,
		"current_storage_bytes" = "current_storage_bytes" + CASE WHEN resource_name = 'storage' THEN delta_value ELSE 0 END,
		"updated_at" = now()
	WHERE "organization_id" = organization_id_input
	RETURNING
		CASE resource_name
			WHEN 'projects' THEN "current_projects"
			WHEN 'tasks' THEN "current_tasks"
			ELSE "current_storage_bytes"
		END,
		CASE resource_name
			WHEN 'projects' THEN "max_projects"::bigint
			WHEN 'tasks' THEN "max_tasks"::bigint
			ELSE "max_storage_mb"::bigint * 1024 * 1024
		END
	INTO current_usage, configured_limit;

	IF NOT FOUND THEN
		RAISE EXCEPTION 'Usage limits are not configured for organization %', organization_id_input;
	END IF;
	IF current_usage > configured_limit THEN
		RAISE EXCEPTION USING
			ERRCODE = 'P0001',
			MESSAGE = 'usage limit exceeded',
			DETAIL = format('resource=%s,current=%s,limit=%s', resource_name, current_usage, configured_limit),
			CONSTRAINT = 'usage_limits_' || resource_name;
	END IF;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION refresh_membership_usage_limit(organization_id_input uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
	current_usage bigint;
	configured_limit bigint;
BEGIN
	PERFORM 1 FROM "usage_limits" WHERE "organization_id" = organization_id_input FOR UPDATE;
	IF NOT FOUND THEN
		RAISE EXCEPTION 'Usage limits are not configured for organization %', organization_id_input;
	END IF;
	SELECT count(DISTINCT "user_id") INTO current_usage
	FROM "memberships"
	WHERE "organization_id" = organization_id_input AND "status" = 'active';
	UPDATE "usage_limits"
	SET "current_seats" = current_usage, "updated_at" = now()
	WHERE "organization_id" = organization_id_input
	RETURNING "max_seats" INTO configured_limit;
	IF current_usage > configured_limit THEN
		RAISE EXCEPTION USING
			ERRCODE = 'P0001',
			MESSAGE = 'usage limit exceeded',
			DETAIL = format('resource=seats,current=%s,limit=%s', current_usage, configured_limit),
			CONSTRAINT = 'usage_limits_seats';
	END IF;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_membership_usage_limit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF TG_OP = 'INSERT' THEN
		PERFORM refresh_membership_usage_limit(NEW."organization_id");
	ELSIF TG_OP = 'DELETE' THEN
		PERFORM refresh_membership_usage_limit(OLD."organization_id");
	ELSIF OLD."organization_id" = NEW."organization_id" THEN
		PERFORM refresh_membership_usage_limit(NEW."organization_id");
	ELSIF OLD."organization_id"::text < NEW."organization_id"::text THEN
		PERFORM refresh_membership_usage_limit(OLD."organization_id");
		PERFORM refresh_membership_usage_limit(NEW."organization_id");
	ELSE
		PERFORM refresh_membership_usage_limit(NEW."organization_id");
		PERFORM refresh_membership_usage_limit(OLD."organization_id");
	END IF;
	RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "memberships_enforce_usage_limit"
AFTER INSERT OR UPDATE OR DELETE ON "memberships"
FOR EACH ROW EXECUTE FUNCTION enforce_membership_usage_limit();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_project_usage_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE usage_change record;
BEGIN
	FOR usage_change IN
		SELECT "organization_id", count(*)::bigint AS delta
		FROM new_projects WHERE "deleted_at" IS NULL GROUP BY "organization_id" ORDER BY "organization_id"
	LOOP
		PERFORM apply_organization_usage_delta(usage_change."organization_id", 'projects', usage_change.delta);
	END LOOP;
	RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_project_usage_delete()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE usage_change record;
BEGIN
	FOR usage_change IN
		SELECT "organization_id", -count(*)::bigint AS delta
		FROM old_projects WHERE "deleted_at" IS NULL GROUP BY "organization_id" ORDER BY "organization_id"
	LOOP
		PERFORM apply_organization_usage_delta(usage_change."organization_id", 'projects', usage_change.delta);
	END LOOP;
	RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_project_usage_update()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE usage_change record;
BEGIN
	FOR usage_change IN
		SELECT "organization_id", sum(delta)::bigint AS delta FROM (
			SELECT "organization_id", count(*)::bigint AS delta FROM new_projects WHERE "deleted_at" IS NULL GROUP BY "organization_id"
			UNION ALL
			SELECT "organization_id", -count(*)::bigint AS delta FROM old_projects WHERE "deleted_at" IS NULL GROUP BY "organization_id"
		) changes GROUP BY "organization_id" HAVING sum(delta) <> 0 ORDER BY "organization_id"
	LOOP
		PERFORM apply_organization_usage_delta(usage_change."organization_id", 'projects', usage_change.delta);
	END LOOP;
	RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "projects_enforce_usage_insert" AFTER INSERT ON "projects"
REFERENCING NEW TABLE AS new_projects FOR EACH STATEMENT EXECUTE FUNCTION enforce_project_usage_insert();
CREATE TRIGGER "projects_enforce_usage_delete" AFTER DELETE ON "projects"
REFERENCING OLD TABLE AS old_projects FOR EACH STATEMENT EXECUTE FUNCTION enforce_project_usage_delete();
CREATE TRIGGER "projects_enforce_usage_update" AFTER UPDATE ON "projects"
REFERENCING OLD TABLE AS old_projects NEW TABLE AS new_projects FOR EACH STATEMENT EXECUTE FUNCTION enforce_project_usage_update();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_task_usage_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE usage_change record;
BEGIN
	FOR usage_change IN
		SELECT "organization_id", count(*)::bigint AS delta
		FROM new_tasks WHERE "deleted_at" IS NULL GROUP BY "organization_id" ORDER BY "organization_id"
	LOOP
		PERFORM apply_organization_usage_delta(usage_change."organization_id", 'tasks', usage_change.delta);
	END LOOP;
	RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_task_usage_delete()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE usage_change record;
BEGIN
	FOR usage_change IN
		SELECT "organization_id", -count(*)::bigint AS delta
		FROM old_tasks WHERE "deleted_at" IS NULL GROUP BY "organization_id" ORDER BY "organization_id"
	LOOP
		PERFORM apply_organization_usage_delta(usage_change."organization_id", 'tasks', usage_change.delta);
	END LOOP;
	RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_task_usage_update()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE usage_change record;
BEGIN
	FOR usage_change IN
		SELECT "organization_id", sum(delta)::bigint AS delta FROM (
			SELECT "organization_id", count(*)::bigint AS delta FROM new_tasks WHERE "deleted_at" IS NULL GROUP BY "organization_id"
			UNION ALL
			SELECT "organization_id", -count(*)::bigint AS delta FROM old_tasks WHERE "deleted_at" IS NULL GROUP BY "organization_id"
		) changes GROUP BY "organization_id" HAVING sum(delta) <> 0 ORDER BY "organization_id"
	LOOP
		PERFORM apply_organization_usage_delta(usage_change."organization_id", 'tasks', usage_change.delta);
	END LOOP;
	RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "tasks_enforce_usage_insert" AFTER INSERT ON "tasks"
REFERENCING NEW TABLE AS new_tasks FOR EACH STATEMENT EXECUTE FUNCTION enforce_task_usage_insert();
CREATE TRIGGER "tasks_enforce_usage_delete" AFTER DELETE ON "tasks"
REFERENCING OLD TABLE AS old_tasks FOR EACH STATEMENT EXECUTE FUNCTION enforce_task_usage_delete();
CREATE TRIGGER "tasks_enforce_usage_update" AFTER UPDATE ON "tasks"
REFERENCING OLD TABLE AS old_tasks NEW TABLE AS new_tasks FOR EACH STATEMENT EXECUTE FUNCTION enforce_task_usage_update();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_storage_usage_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE usage_change record;
BEGIN
	FOR usage_change IN
		SELECT "organization_id", coalesce(sum("file_size"::bigint), 0)::bigint AS delta
		FROM new_attachments WHERE "deleted_at" IS NULL GROUP BY "organization_id" ORDER BY "organization_id"
	LOOP
		PERFORM apply_organization_usage_delta(usage_change."organization_id", 'storage', usage_change.delta);
	END LOOP;
	RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_storage_usage_delete()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE usage_change record;
BEGIN
	FOR usage_change IN
		SELECT "organization_id", (-coalesce(sum("file_size"::bigint), 0))::bigint AS delta
		FROM old_attachments WHERE "deleted_at" IS NULL GROUP BY "organization_id" ORDER BY "organization_id"
	LOOP
		PERFORM apply_organization_usage_delta(usage_change."organization_id", 'storage', usage_change.delta);
	END LOOP;
	RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_storage_usage_update()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE usage_change record;
BEGIN
	FOR usage_change IN
		SELECT "organization_id", sum(delta)::bigint AS delta FROM (
			SELECT "organization_id", coalesce(sum("file_size"::bigint), 0)::bigint AS delta FROM new_attachments WHERE "deleted_at" IS NULL GROUP BY "organization_id"
			UNION ALL
			SELECT "organization_id", (-coalesce(sum("file_size"::bigint), 0))::bigint AS delta FROM old_attachments WHERE "deleted_at" IS NULL GROUP BY "organization_id"
		) changes GROUP BY "organization_id" HAVING sum(delta) <> 0 ORDER BY "organization_id"
	LOOP
		PERFORM apply_organization_usage_delta(usage_change."organization_id", 'storage', usage_change.delta);
	END LOOP;
	RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "attachments_enforce_usage_insert" AFTER INSERT ON "attachments"
REFERENCING NEW TABLE AS new_attachments FOR EACH STATEMENT EXECUTE FUNCTION enforce_storage_usage_insert();
CREATE TRIGGER "attachments_enforce_usage_delete" AFTER DELETE ON "attachments"
REFERENCING OLD TABLE AS old_attachments FOR EACH STATEMENT EXECUTE FUNCTION enforce_storage_usage_delete();
CREATE TRIGGER "attachments_enforce_usage_update" AFTER UPDATE ON "attachments"
REFERENCING OLD TABLE AS old_attachments NEW TABLE AS new_attachments FOR EACH STATEMENT EXECUTE FUNCTION enforce_storage_usage_update();
