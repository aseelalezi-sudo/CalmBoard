CREATE TYPE "public"."task_dependency_type" AS ENUM('finish_to_start', 'start_to_start', 'finish_to_finish', 'start_to_finish');--> statement-breakpoint
CREATE TYPE "public"."task_relation_type" AS ENUM('related', 'duplicate_of', 'caused_by');--> statement-breakpoint
CREATE TABLE "task_dependencies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"blocking_task_id" uuid NOT NULL,
	"dependent_task_id" uuid NOT NULL,
	"type" "task_dependency_type" DEFAULT 'finish_to_start' NOT NULL,
	"lag_minutes" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "task_dependencies_not_self_check" CHECK ("task_dependencies"."blocking_task_id" <> "task_dependencies"."dependent_task_id")
);
--> statement-breakpoint
CREATE TABLE "task_relations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"source_task_id" uuid NOT NULL,
	"target_task_id" uuid NOT NULL,
	"type" "task_relation_type" DEFAULT 'related' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "task_relations_not_self_check" CHECK ("task_relations"."source_task_id" <> "task_relations"."target_task_id")
);
--> statement-breakpoint
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_blocking_task_id_tasks_id_fk" FOREIGN KEY ("blocking_task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_dependent_task_id_tasks_id_fk" FOREIGN KEY ("dependent_task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_relations" ADD CONSTRAINT "task_relations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_relations" ADD CONSTRAINT "task_relations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_relations" ADD CONSTRAINT "task_relations_source_task_id_tasks_id_fk" FOREIGN KEY ("source_task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_relations" ADD CONSTRAINT "task_relations_target_task_id_tasks_id_fk" FOREIGN KEY ("target_task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_relations" ADD CONSTRAINT "task_relations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "task_dependencies_active_unique" ON "task_dependencies" USING btree ("blocking_task_id","dependent_task_id","type") WHERE "task_dependencies"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "task_dependencies_tenant_dependent_active_idx" ON "task_dependencies" USING btree ("organization_id","workspace_id","dependent_task_id","deleted_at");--> statement-breakpoint
CREATE INDEX "task_dependencies_tenant_blocking_active_idx" ON "task_dependencies" USING btree ("organization_id","workspace_id","blocking_task_id","deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "task_relations_active_unique" ON "task_relations" USING btree ("source_task_id","target_task_id","type") WHERE "task_relations"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "task_relations_tenant_source_active_idx" ON "task_relations" USING btree ("organization_id","workspace_id","source_task_id","deleted_at");--> statement-breakpoint
CREATE INDEX "task_relations_tenant_target_active_idx" ON "task_relations" USING btree ("organization_id","workspace_id","target_task_id","deleted_at");
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "tasks" dependent
    CROSS JOIN LATERAL jsonb_array_elements_text(
      CASE
        WHEN jsonb_typeof(dependent."custom_fields" -> 'dependencies') = 'array'
          THEN dependent."custom_fields" -> 'dependencies'
        ELSE '[]'::jsonb
      END
    ) legacy("serial")
    LEFT JOIN "tasks" blocking
      ON blocking."organization_id" = dependent."organization_id"
      AND blocking."serial" = legacy."serial"
    WHERE dependent."deleted_at" IS NULL
      AND (
        blocking."id" IS NULL
        OR blocking."deleted_at" IS NOT NULL
        OR blocking."workspace_id" <> dependent."workspace_id"
        OR blocking."id" = dependent."id"
      )
  ) THEN
    RAISE EXCEPTION 'Invalid legacy task dependencies must be resolved before relational backfill';
  END IF;
END $$;
--> statement-breakpoint
CREATE FUNCTION "validate_task_dependency"() RETURNS trigger AS $$
DECLARE
  blocking_task record;
  dependent_task record;
BEGIN
  SELECT "organization_id", "workspace_id", "deleted_at"
  INTO blocking_task
  FROM "tasks"
  WHERE "id" = NEW."blocking_task_id";

  SELECT "organization_id", "workspace_id", "deleted_at"
  INTO dependent_task
  FROM "tasks"
  WHERE "id" = NEW."dependent_task_id";

  IF blocking_task."organization_id" IS NULL OR dependent_task."organization_id" IS NULL
    OR blocking_task."organization_id" <> NEW."organization_id"
    OR dependent_task."organization_id" <> NEW."organization_id"
    OR blocking_task."workspace_id" <> NEW."workspace_id"
    OR dependent_task."workspace_id" <> NEW."workspace_id" THEN
    RAISE EXCEPTION 'Task dependency endpoints do not belong to the same tenant scope';
  END IF;

  IF NEW."deleted_at" IS NULL
    AND (blocking_task."deleted_at" IS NOT NULL OR dependent_task."deleted_at" IS NOT NULL) THEN
    RAISE EXCEPTION 'Active task dependencies cannot reference deleted tasks';
  END IF;

  IF NEW."deleted_at" IS NULL AND EXISTS (
    WITH RECURSIVE downstream("task_id") AS (
      SELECT NEW."dependent_task_id"
      UNION
      SELECT dependency."dependent_task_id"
      FROM "task_dependencies" dependency
      JOIN downstream ON dependency."blocking_task_id" = downstream."task_id"
      WHERE dependency."deleted_at" IS NULL
        AND dependency."id" IS DISTINCT FROM NEW."id"
    )
    SELECT 1 FROM downstream WHERE "task_id" = NEW."blocking_task_id"
  ) THEN
    RAISE EXCEPTION 'Task dependency would create a cycle';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "task_dependencies_validate"
BEFORE INSERT OR UPDATE ON "task_dependencies"
FOR EACH ROW EXECUTE FUNCTION "validate_task_dependency"();
--> statement-breakpoint
CREATE FUNCTION "validate_task_relation"() RETURNS trigger AS $$
DECLARE
  source_task record;
  target_task record;
  swap_task_id uuid;
BEGIN
  IF NEW."type" = 'related' AND NEW."source_task_id" > NEW."target_task_id" THEN
    swap_task_id := NEW."source_task_id";
    NEW."source_task_id" := NEW."target_task_id";
    NEW."target_task_id" := swap_task_id;
  END IF;

  SELECT "organization_id", "workspace_id", "deleted_at"
  INTO source_task
  FROM "tasks"
  WHERE "id" = NEW."source_task_id";

  SELECT "organization_id", "workspace_id", "deleted_at"
  INTO target_task
  FROM "tasks"
  WHERE "id" = NEW."target_task_id";

  IF source_task."organization_id" IS NULL OR target_task."organization_id" IS NULL
    OR source_task."organization_id" <> NEW."organization_id"
    OR target_task."organization_id" <> NEW."organization_id"
    OR source_task."workspace_id" <> NEW."workspace_id"
    OR target_task."workspace_id" <> NEW."workspace_id" THEN
    RAISE EXCEPTION 'Task relation endpoints do not belong to the same tenant scope';
  END IF;

  IF NEW."deleted_at" IS NULL
    AND (source_task."deleted_at" IS NOT NULL OR target_task."deleted_at" IS NOT NULL) THEN
    RAISE EXCEPTION 'Active task relations cannot reference deleted tasks';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "task_relations_validate"
BEFORE INSERT OR UPDATE ON "task_relations"
FOR EACH ROW EXECUTE FUNCTION "validate_task_relation"();
--> statement-breakpoint
INSERT INTO "task_dependencies" (
  "organization_id", "workspace_id", "blocking_task_id", "dependent_task_id", "type"
)
SELECT DISTINCT
  dependent."organization_id",
  dependent."workspace_id",
  blocking."id",
  dependent."id",
  'finish_to_start'::"task_dependency_type"
FROM "tasks" dependent
CROSS JOIN LATERAL jsonb_array_elements_text(
  CASE
    WHEN jsonb_typeof(dependent."custom_fields" -> 'dependencies') = 'array'
      THEN dependent."custom_fields" -> 'dependencies'
    ELSE '[]'::jsonb
  END
) legacy("serial")
JOIN "tasks" blocking
  ON blocking."organization_id" = dependent."organization_id"
  AND blocking."workspace_id" = dependent."workspace_id"
  AND blocking."serial" = legacy."serial"
  AND blocking."deleted_at" IS NULL
WHERE dependent."deleted_at" IS NULL
ON CONFLICT ("blocking_task_id", "dependent_task_id", "type") WHERE "deleted_at" IS NULL DO NOTHING;
--> statement-breakpoint
CREATE FUNCTION "close_deleted_task_links"() RETURNS trigger AS $$
BEGIN
  IF NEW."deleted_at" IS NOT NULL AND OLD."deleted_at" IS NULL THEN
    UPDATE "task_dependencies"
    SET "deleted_at" = NEW."deleted_at"
    WHERE ("blocking_task_id" = NEW."id" OR "dependent_task_id" = NEW."id")
      AND "deleted_at" IS NULL;

    UPDATE "task_relations"
    SET "deleted_at" = NEW."deleted_at"
    WHERE ("source_task_id" = NEW."id" OR "target_task_id" = NEW."id")
      AND "deleted_at" IS NULL;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "tasks_close_deleted_links"
AFTER UPDATE OF "deleted_at" ON "tasks"
FOR EACH ROW EXECUTE FUNCTION "close_deleted_task_links"();
