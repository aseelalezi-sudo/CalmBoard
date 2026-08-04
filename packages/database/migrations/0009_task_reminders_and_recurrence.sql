CREATE TYPE "public"."task_recurrence_frequency" AS ENUM('daily', 'weekly', 'monthly', 'yearly');--> statement-breakpoint
CREATE TYPE "public"."task_recurrence_status" AS ENUM('active', 'paused', 'completed');--> statement-breakpoint
CREATE TYPE "public"."task_reminder_status" AS ENUM('scheduled', 'sent', 'failed');--> statement-breakpoint
CREATE TABLE "task_recurrence_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"frequency" "task_recurrence_frequency" DEFAULT 'weekly' NOT NULL,
	"interval" integer DEFAULT 1 NOT NULL,
	"timezone" varchar(100) DEFAULT 'UTC' NOT NULL,
	"weekdays" integer[] DEFAULT ARRAY[]::integer[] NOT NULL,
	"month_day" integer,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"max_occurrences" integer,
	"occurrences_created" integer DEFAULT 0 NOT NULL,
	"next_occurrence_at" timestamp with time zone NOT NULL,
	"last_occurrence_at" timestamp with time zone,
	"status" "task_recurrence_status" DEFAULT 'active' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "task_recurrence_rules_interval_check" CHECK ("task_recurrence_rules"."interval" > 0),
	CONSTRAINT "task_recurrence_rules_weekdays_check" CHECK ("task_recurrence_rules"."weekdays" <@ ARRAY[0, 1, 2, 3, 4, 5, 6]::integer[]),
	CONSTRAINT "task_recurrence_rules_month_day_check" CHECK ("task_recurrence_rules"."month_day" is null or "task_recurrence_rules"."month_day" between 1 and 31),
	CONSTRAINT "task_recurrence_rules_max_occurrences_check" CHECK ("task_recurrence_rules"."max_occurrences" is null or "task_recurrence_rules"."max_occurrences" > 0),
	CONSTRAINT "task_recurrence_rules_occurrences_created_check" CHECK ("task_recurrence_rules"."occurrences_created" >= 0),
	CONSTRAINT "task_recurrence_rules_end_check" CHECK ("task_recurrence_rules"."ends_at" is null or "task_recurrence_rules"."ends_at" > "task_recurrence_rules"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "task_reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"external_id" varchar(128) NOT NULL,
	"remind_at" timestamp with time zone NOT NULL,
	"label" varchar(255) NOT NULL,
	"status" "task_reminder_status" DEFAULT 'scheduled' NOT NULL,
	"sent_at" timestamp with time zone,
	"failure_reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "task_recurrence_rules" ADD CONSTRAINT "task_recurrence_rules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_recurrence_rules" ADD CONSTRAINT "task_recurrence_rules_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_recurrence_rules" ADD CONSTRAINT "task_recurrence_rules_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_recurrence_rules" ADD CONSTRAINT "task_recurrence_rules_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_recurrence_rules" ADD CONSTRAINT "task_recurrence_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_reminders" ADD CONSTRAINT "task_reminders_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_reminders" ADD CONSTRAINT "task_reminders_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_reminders" ADD CONSTRAINT "task_reminders_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_reminders" ADD CONSTRAINT "task_reminders_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_reminders" ADD CONSTRAINT "task_reminders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "task_recurrence_rules_task_active_unique" ON "task_recurrence_rules" USING btree ("task_id") WHERE "task_recurrence_rules"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "task_recurrence_rules_tenant_due_idx" ON "task_recurrence_rules" USING btree ("organization_id","workspace_id","status","next_occurrence_at","deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "task_reminders_task_external_active_unique" ON "task_reminders" USING btree ("task_id","external_id") WHERE "task_reminders"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "task_reminders_tenant_due_idx" ON "task_reminders" USING btree ("organization_id","workspace_id","status","remind_at","deleted_at");--> statement-breakpoint
CREATE INDEX "task_reminders_tenant_task_active_idx" ON "task_reminders" USING btree ("organization_id","workspace_id","task_id","deleted_at");
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "tasks" task
    WHERE task."custom_fields" ? 'reminders'
      AND jsonb_typeof(task."custom_fields" -> 'reminders') <> 'array'
  ) OR EXISTS (
    SELECT 1
    FROM "tasks" task
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE
        WHEN jsonb_typeof(task."custom_fields" -> 'reminders') = 'array'
          THEN task."custom_fields" -> 'reminders'
        ELSE '[]'::jsonb
      END
    ) reminder("value")
    WHERE jsonb_typeof(reminder."value") <> 'object'
      OR jsonb_typeof(reminder."value" -> 'id') <> 'string'
      OR jsonb_typeof(reminder."value" -> 'time') <> 'string'
      OR jsonb_typeof(reminder."value" -> 'label') <> 'string'
      OR length(reminder."value" ->> 'id') NOT BETWEEN 1 AND 128
      OR length(reminder."value" ->> 'label') NOT BETWEEN 1 AND 255
      OR NOT pg_input_is_valid(reminder."value" ->> 'time', 'timestamp with time zone')
  ) OR EXISTS (
    SELECT 1
    FROM "tasks" task
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE
        WHEN jsonb_typeof(task."custom_fields" -> 'reminders') = 'array'
          THEN task."custom_fields" -> 'reminders'
        ELSE '[]'::jsonb
      END
    ) reminder("value")
    GROUP BY task."id", reminder."value" ->> 'id'
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Invalid legacy task reminders must be resolved before relational backfill';
  END IF;
END $$;
--> statement-breakpoint
CREATE FUNCTION "validate_task_schedule_scope"() RETURNS trigger AS $$
DECLARE
  scheduled_task record;
BEGIN
  SELECT "organization_id", "workspace_id", "project_id", "deleted_at"
  INTO scheduled_task
  FROM "tasks"
  WHERE "id" = NEW."task_id";

  IF scheduled_task."organization_id" IS NULL
    OR scheduled_task."organization_id" <> NEW."organization_id"
    OR scheduled_task."workspace_id" <> NEW."workspace_id"
    OR scheduled_task."project_id" <> NEW."project_id" THEN
    RAISE EXCEPTION 'Task schedule does not belong to the task tenant and project scope';
  END IF;

  IF NEW."deleted_at" IS NULL AND scheduled_task."deleted_at" IS NOT NULL THEN
    RAISE EXCEPTION 'Active task schedules cannot reference deleted tasks';
  END IF;

  IF TG_TABLE_NAME = 'task_recurrence_rules' THEN
    IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE "name" = NEW."timezone") THEN
      RAISE EXCEPTION 'Task recurrence timezone is invalid';
    END IF;
    IF NEW."next_occurrence_at" < NEW."starts_at"
      OR (NEW."ends_at" IS NOT NULL AND NEW."next_occurrence_at" > NEW."ends_at") THEN
      RAISE EXCEPTION 'Task recurrence next occurrence is outside its schedule';
    END IF;
    IF (SELECT count(*) FROM unnest(NEW."weekdays") day) <>
      (SELECT count(DISTINCT day) FROM unnest(NEW."weekdays") day) THEN
      RAISE EXCEPTION 'Task recurrence weekdays must be unique';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "task_reminders_validate_scope"
BEFORE INSERT OR UPDATE ON "task_reminders"
FOR EACH ROW EXECUTE FUNCTION "validate_task_schedule_scope"();
--> statement-breakpoint
CREATE TRIGGER "task_recurrence_rules_validate_scope"
BEFORE INSERT OR UPDATE ON "task_recurrence_rules"
FOR EACH ROW EXECUTE FUNCTION "validate_task_schedule_scope"();
--> statement-breakpoint
INSERT INTO "task_reminders" (
  "organization_id", "workspace_id", "project_id", "task_id", "external_id",
  "remind_at", "label", "status", "sent_at", "created_at", "updated_at"
)
SELECT
  task."organization_id",
  task."workspace_id",
  task."project_id",
  task."id",
  reminder."value" ->> 'id',
  (reminder."value" ->> 'time')::timestamp with time zone,
  reminder."value" ->> 'label',
  CASE
    WHEN jsonb_typeof(reminder."value" -> 'sent') = 'boolean'
      AND (reminder."value" ->> 'sent')::boolean
      THEN 'sent'::"task_reminder_status"
    ELSE 'scheduled'::"task_reminder_status"
  END,
  CASE
    WHEN jsonb_typeof(reminder."value" -> 'sent') = 'boolean'
      AND (reminder."value" ->> 'sent')::boolean
      THEN (reminder."value" ->> 'time')::timestamp with time zone
    ELSE NULL
  END,
  task."created_at",
  task."updated_at"
FROM "tasks" task
CROSS JOIN LATERAL jsonb_array_elements(
  CASE
    WHEN jsonb_typeof(task."custom_fields" -> 'reminders') = 'array'
      THEN task."custom_fields" -> 'reminders'
    ELSE '[]'::jsonb
  END
) reminder("value")
WHERE task."deleted_at" IS NULL;
--> statement-breakpoint
INSERT INTO "task_recurrence_rules" (
  "organization_id", "workspace_id", "project_id", "task_id", "frequency",
  "starts_at", "next_occurrence_at", "created_at", "updated_at"
)
SELECT
  task."organization_id",
  task."workspace_id",
  task."project_id",
  task."id",
  'weekly'::"task_recurrence_frequency",
  COALESCE(task."due_date", task."start_date", task."created_at"),
  COALESCE(task."due_date", task."start_date", task."created_at"),
  task."created_at",
  task."updated_at"
FROM "tasks" task
WHERE task."is_recurring" = true
  AND task."deleted_at" IS NULL;
--> statement-breakpoint
CREATE FUNCTION "sync_task_recurrence_rule"() RETURNS trigger AS $$
BEGIN
  IF NEW."is_recurring" = true THEN
    INSERT INTO "task_recurrence_rules" (
      "organization_id", "workspace_id", "project_id", "task_id", "frequency",
      "starts_at", "next_occurrence_at", "created_by"
    )
    SELECT
      NEW."organization_id", NEW."workspace_id", NEW."project_id", NEW."id",
      'weekly'::"task_recurrence_frequency",
      COALESCE(NEW."due_date", NEW."start_date", NEW."created_at"),
      COALESCE(NEW."due_date", NEW."start_date", NEW."created_at"),
      NEW."reporter_id"
    WHERE NOT EXISTS (
      SELECT 1 FROM "task_recurrence_rules"
      WHERE "task_id" = NEW."id" AND "deleted_at" IS NULL
    );
  ELSIF OLD."is_recurring" = true THEN
    UPDATE "task_recurrence_rules"
    SET "deleted_at" = now(), "updated_at" = now()
    WHERE "task_id" = NEW."id" AND "deleted_at" IS NULL;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "tasks_sync_recurrence_rule"
AFTER UPDATE OF "is_recurring" ON "tasks"
FOR EACH ROW
WHEN (OLD."is_recurring" IS DISTINCT FROM NEW."is_recurring")
EXECUTE FUNCTION "sync_task_recurrence_rule"();
--> statement-breakpoint
CREATE FUNCTION "sync_task_recurrence_flag"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' OR OLD."deleted_at" IS DISTINCT FROM NEW."deleted_at" THEN
    UPDATE "tasks"
    SET "is_recurring" = EXISTS (
      SELECT 1 FROM "task_recurrence_rules"
      WHERE "task_id" = NEW."task_id" AND "deleted_at" IS NULL
    ), "updated_at" = now()
    WHERE "id" = NEW."task_id";
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "task_recurrence_rules_sync_task_flag"
AFTER INSERT OR UPDATE ON "task_recurrence_rules"
FOR EACH ROW EXECUTE FUNCTION "sync_task_recurrence_flag"();
--> statement-breakpoint
CREATE FUNCTION "close_deleted_task_schedules"() RETURNS trigger AS $$
BEGIN
  IF NEW."deleted_at" IS NOT NULL AND OLD."deleted_at" IS NULL THEN
    UPDATE "task_reminders"
    SET "deleted_at" = NEW."deleted_at", "updated_at" = NEW."deleted_at"
    WHERE "task_id" = NEW."id" AND "deleted_at" IS NULL;

    UPDATE "task_recurrence_rules"
    SET "deleted_at" = NEW."deleted_at", "updated_at" = NEW."deleted_at"
    WHERE "task_id" = NEW."id" AND "deleted_at" IS NULL;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "tasks_close_deleted_schedules"
AFTER UPDATE OF "deleted_at" ON "tasks"
FOR EACH ROW EXECUTE FUNCTION "close_deleted_task_schedules"();
