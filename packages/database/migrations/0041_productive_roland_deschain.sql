CREATE TABLE "goal_checkins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"goal_id" uuid NOT NULL,
	"progress" integer NOT NULL,
	"current_value" double precision,
	"status" varchar(20) NOT NULL,
	"note" varchar(2000) NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goal_checkins_progress_check" CHECK ("goal_checkins"."progress" between 0 and 100),
	CONSTRAINT "goal_checkins_status_check" CHECK ("goal_checkins"."status" in ('on_track', 'at_risk', 'off_track', 'achieved'))
);
--> statement-breakpoint
CREATE TABLE "goal_task_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"goal_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"weight" double precision DEFAULT 1 NOT NULL,
	"created_by_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goal_task_links_weight_check" CHECK ("goal_task_links"."weight" > 0 and "goal_task_links"."weight" <= 100)
);
--> statement-breakpoint
UPDATE "goals"
SET
  "type" = CASE WHEN "type" IN ('objective', 'key_result') THEN "type" ELSE 'objective' END,
  "progress" = GREATEST(0, LEAST(100, COALESCE("progress", 0))),
  "status" = CASE
    WHEN COALESCE("progress", 0) >= 100 THEN 'achieved'
    WHEN COALESCE("progress", 0) >= 60 THEN 'on_track'
    WHEN COALESCE("progress", 0) >= 30 THEN 'at_risk'
    ELSE 'off_track'
  END;--> statement-breakpoint
UPDATE "goals" child
SET "parent_id" = NULL
WHERE child."parent_id" = child."id"
   OR NOT EXISTS (
     SELECT 1
     FROM "goals" parent
     WHERE parent."id" = child."parent_id"
       AND parent."organization_id" = child."organization_id"
       AND parent."workspace_id" = child."workspace_id"
   );--> statement-breakpoint
ALTER TABLE "goals" ALTER COLUMN "type" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "goals" ALTER COLUMN "progress" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "goals" ALTER COLUMN "status" SET DEFAULT 'off_track';--> statement-breakpoint
ALTER TABLE "goals" ALTER COLUMN "status" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "progress_mode" varchar(20) DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "measurement_unit" varchar(20) DEFAULT 'percentage' NOT NULL;--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "start_value" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "current_value" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "target_value" double precision DEFAULT 100 NOT NULL;--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "weight" double precision DEFAULT 1 NOT NULL;--> statement-breakpoint
UPDATE "goals" objective
SET "progress_mode" = 'children'
WHERE objective."type" = 'objective'
  AND EXISTS (
    SELECT 1
    FROM "goals" child
    WHERE child."parent_id" = objective."id"
      AND child."deleted_at" IS NULL
  );--> statement-breakpoint
INSERT INTO "goal_checkins" (
  "organization_id",
  "workspace_id",
  "goal_id",
  "progress",
  "current_value",
  "status",
  "note",
  "created_by_id",
  "created_at"
)
SELECT
  goal."organization_id",
  goal."workspace_id",
  goal."id",
  GREATEST(0, LEAST(100, CASE
    WHEN jsonb_typeof(entry.value->'progress') = 'number'
      THEN (entry.value->>'progress')::integer
    ELSE goal."progress"
  END)),
  NULL,
  CASE
    WHEN goal."progress" >= 100 THEN 'achieved'
    WHEN goal."progress" >= 60 THEN 'on_track'
    WHEN goal."progress" >= 30 THEN 'at_risk'
    ELSE 'off_track'
  END,
  LEFT(COALESCE(NULLIF(entry.value->>'note', ''), 'Imported check-in'), 2000),
  goal."owner_id",
  goal."updated_at"
FROM "goals" goal
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(goal."checkins", '[]'::jsonb)) entry(value)
WHERE jsonb_typeof(COALESCE(goal."checkins", '[]'::jsonb)) = 'array';--> statement-breakpoint
ALTER TABLE "goal_checkins" ADD CONSTRAINT "goal_checkins_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_checkins" ADD CONSTRAINT "goal_checkins_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_checkins" ADD CONSTRAINT "goal_checkins_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_checkins" ADD CONSTRAINT "goal_checkins_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_task_links" ADD CONSTRAINT "goal_task_links_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_task_links" ADD CONSTRAINT "goal_task_links_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_task_links" ADD CONSTRAINT "goal_task_links_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_task_links" ADD CONSTRAINT "goal_task_links_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_task_links" ADD CONSTRAINT "goal_task_links_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "goal_checkins_tenant_goal_created_idx" ON "goal_checkins" USING btree ("organization_id","workspace_id","goal_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "goal_task_links_goal_task_unique" ON "goal_task_links" USING btree ("goal_id","task_id");--> statement-breakpoint
CREATE INDEX "goal_task_links_tenant_task_idx" ON "goal_task_links" USING btree ("organization_id","workspace_id","task_id","goal_id");--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_parent_id_goals_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."goals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "goals_tenant_parent_active_idx" ON "goals" USING btree ("organization_id","workspace_id","parent_id","deleted_at");--> statement-breakpoint
CREATE INDEX "goals_tenant_owner_period_idx" ON "goals" USING btree ("organization_id","workspace_id","owner_id","period_start","period_end");--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_type_check" CHECK ("goals"."type" in ('objective', 'key_result'));--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_progress_check" CHECK ("goals"."progress" between 0 and 100);--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_status_check" CHECK ("goals"."status" in ('on_track', 'at_risk', 'off_track', 'achieved'));--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_progress_mode_check" CHECK ("goals"."progress_mode" in ('manual', 'measurement', 'tasks', 'children'));--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_measurement_unit_check" CHECK ("goals"."measurement_unit" in ('percentage', 'number', 'currency', 'boolean'));--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_weight_check" CHECK ("goals"."weight" > 0 and "goals"."weight" <= 100);--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_parent_not_self_check" CHECK ("goals"."parent_id" is null or "goals"."parent_id" <> "goals"."id");--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_period_check" CHECK ("goals"."period_start" is null or "goals"."period_end" is null or "goals"."period_end" >= "goals"."period_start");--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_measurement_range_check" CHECK ("goals"."progress_mode" <> 'measurement' or "goals"."target_value" <> "goals"."start_value");--> statement-breakpoint
ALTER TABLE public.goal_checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.goal_checkins FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.goal_checkins
USING (public.app_tenant_matches(organization_id, workspace_id))
WITH CHECK (public.app_tenant_matches(organization_id, workspace_id));--> statement-breakpoint
ALTER TABLE public.goal_task_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.goal_task_links FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.goal_task_links
USING (public.app_tenant_matches(organization_id, workspace_id))
WITH CHECK (public.app_tenant_matches(organization_id, workspace_id));--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.goal_health_status(
  goal_progress integer,
  goal_period_start timestamptz,
  goal_period_end timestamptz
)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  expected_progress integer;
  variance integer;
BEGIN
  IF goal_progress >= 100 THEN
    RETURN 'achieved';
  END IF;
  IF goal_period_start IS NOT NULL
     AND goal_period_end IS NOT NULL
     AND goal_period_end > goal_period_start THEN
    expected_progress := GREATEST(
      0,
      LEAST(
        100,
        ROUND(
          100 * EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - goal_period_start))
          / EXTRACT(EPOCH FROM (goal_period_end - goal_period_start))
        )::integer
      )
    );
    variance := goal_progress - expected_progress;
    IF variance >= -10 THEN RETURN 'on_track'; END IF;
    IF variance >= -25 THEN RETURN 'at_risk'; END IF;
    RETURN 'off_track';
  END IF;
  IF goal_progress >= 60 THEN RETURN 'on_track'; END IF;
  IF goal_progress >= 30 THEN RETURN 'at_risk'; END IF;
  RETURN 'off_track';
END;
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.refresh_goal_progress(requested_goal_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  goal_record public.goals%ROWTYPE;
  calculated_progress integer;
BEGIN
  SELECT * INTO goal_record
  FROM public.goals
  WHERE id = requested_goal_id
    AND deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  IF goal_record.progress_mode = 'tasks' THEN
    SELECT COALESCE(
      ROUND(SUM(task.progress * link.weight) / NULLIF(SUM(link.weight), 0))::integer,
      0
    )
    INTO calculated_progress
    FROM public.goal_task_links link
    JOIN public.tasks task
      ON task.id = link.task_id
     AND task.organization_id = link.organization_id
     AND task.workspace_id = link.workspace_id
     AND task.deleted_at IS NULL
    WHERE link.goal_id = requested_goal_id
      AND link.organization_id = goal_record.organization_id
      AND link.workspace_id = goal_record.workspace_id;
  ELSIF goal_record.progress_mode = 'children' THEN
    SELECT COALESCE(
      ROUND(SUM(child.progress * child.weight) / NULLIF(SUM(child.weight), 0))::integer,
      0
    )
    INTO calculated_progress
    FROM public.goals child
    WHERE child.parent_id = requested_goal_id
      AND child.organization_id = goal_record.organization_id
      AND child.workspace_id = goal_record.workspace_id
      AND child.deleted_at IS NULL;
  ELSIF goal_record.progress_mode = 'measurement' THEN
    calculated_progress := GREATEST(
      0,
      LEAST(
        100,
        ROUND(
          100 * (goal_record.current_value - goal_record.start_value)
          / NULLIF(goal_record.target_value - goal_record.start_value, 0)
        )::integer
      )
    );
  ELSE
    calculated_progress := goal_record.progress;
  END IF;

  UPDATE public.goals
  SET
    progress = calculated_progress,
    status = public.goal_health_status(calculated_progress, period_start, period_end),
    updated_at = CURRENT_TIMESTAMP
  WHERE id = requested_goal_id;
END;
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.validate_goal_scope()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.type = 'objective' AND NEW.parent_id IS NOT NULL THEN
    RAISE EXCEPTION 'an objective cannot have a parent' USING ERRCODE = '23514';
  END IF;
  IF NEW.type = 'key_result' AND NEW.parent_id IS NULL
     AND (TG_OP = 'INSERT' OR OLD.parent_id IS DISTINCT FROM NEW.parent_id OR OLD.type IS DISTINCT FROM NEW.type) THEN
    RAISE EXCEPTION 'a key result requires an objective' USING ERRCODE = '23514';
  END IF;
  IF NEW.parent_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.goals parent
    WHERE parent.id = NEW.parent_id
      AND parent.organization_id = NEW.organization_id
      AND parent.workspace_id = NEW.workspace_id
      AND parent.type = 'objective'
      AND parent.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'a key result parent must be an active objective in the same workspace'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER goals_validate_scope
BEFORE INSERT OR UPDATE OF type, parent_id, organization_id, workspace_id
ON public.goals
FOR EACH ROW
EXECUTE FUNCTION public.validate_goal_scope();--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.validate_goal_child_scope()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.goals goal
    WHERE goal.id = NEW.goal_id
      AND goal.organization_id = NEW.organization_id
      AND goal.workspace_id = NEW.workspace_id
      AND goal.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'goal child row must match an active goal tenant' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.validate_goal_task_scope()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.goals goal
    WHERE goal.id = NEW.goal_id
      AND goal.organization_id = NEW.organization_id
      AND goal.workspace_id = NEW.workspace_id
      AND goal.type = 'key_result'
      AND goal.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'goal task link must match an active key result tenant' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.tasks task
    WHERE task.id = NEW.task_id
      AND task.organization_id = NEW.organization_id
      AND task.workspace_id = NEW.workspace_id
      AND task.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'linked task must match the active goal tenant' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER goal_task_links_validate_scope
BEFORE INSERT OR UPDATE OF organization_id, workspace_id, goal_id, task_id
ON public.goal_task_links
FOR EACH ROW
EXECUTE FUNCTION public.validate_goal_task_scope();--> statement-breakpoint
CREATE TRIGGER goal_checkins_validate_scope
BEFORE INSERT OR UPDATE OF organization_id, workspace_id, goal_id
ON public.goal_checkins
FOR EACH ROW
EXECUTE FUNCTION public.validate_goal_child_scope();--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.refresh_goal_from_link()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM public.refresh_goal_progress(COALESCE(NEW.goal_id, OLD.goal_id));
  RETURN COALESCE(NEW, OLD);
END;
$$;--> statement-breakpoint
CREATE TRIGGER goal_task_links_refresh_progress
AFTER INSERT OR UPDATE OR DELETE
ON public.goal_task_links
FOR EACH ROW
EXECUTE FUNCTION public.refresh_goal_from_link();--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.refresh_goals_from_task()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  linked_goal_id uuid;
BEGIN
  FOR linked_goal_id IN
    SELECT link.goal_id
    FROM public.goal_task_links link
    WHERE link.task_id = COALESCE(NEW.id, OLD.id)
  LOOP
    PERFORM public.refresh_goal_progress(linked_goal_id);
  END LOOP;
  RETURN COALESCE(NEW, OLD);
END;
$$;--> statement-breakpoint
CREATE TRIGGER tasks_refresh_linked_goals
AFTER UPDATE OF progress, status, deleted_at OR DELETE
ON public.tasks
FOR EACH ROW
EXECUTE FUNCTION public.refresh_goals_from_task();--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.refresh_parent_goal()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP <> 'INSERT' AND OLD.parent_id IS NOT NULL THEN
    PERFORM public.refresh_goal_progress(OLD.parent_id);
  END IF;
  IF TG_OP <> 'DELETE' AND NEW.parent_id IS NOT NULL THEN
    PERFORM public.refresh_goal_progress(NEW.parent_id);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;--> statement-breakpoint
CREATE TRIGGER goals_refresh_parent
AFTER INSERT OR DELETE OR UPDATE OF progress, weight, parent_id, deleted_at
ON public.goals
FOR EACH ROW
EXECUTE FUNCTION public.refresh_parent_goal();--> statement-breakpoint
DO $$
DECLARE objective_id uuid;
BEGIN
  FOR objective_id IN
    SELECT id FROM public.goals WHERE progress_mode = 'children' AND deleted_at IS NULL
  LOOP
    PERFORM public.refresh_goal_progress(objective_id);
  END LOOP;
END $$;
