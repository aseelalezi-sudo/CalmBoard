CREATE TABLE "project_baseline_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"baseline_id" uuid NOT NULL,
	"source_task_id" uuid NOT NULL,
	"serial" varchar(20) NOT NULL,
	"title" varchar(500) NOT NULL,
	"start_date" timestamp with time zone,
	"due_date" timestamp with time zone,
	"is_milestone" boolean DEFAULT false NOT NULL,
	"task_version" integer NOT NULL,
	CONSTRAINT "project_baseline_tasks_version_check" CHECK ("project_baseline_tasks"."task_version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "project_baselines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"task_count" integer NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_baselines_task_count_check" CHECK ("project_baselines"."task_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "is_milestone" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "project_baseline_tasks" ADD CONSTRAINT "project_baseline_tasks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_baseline_tasks" ADD CONSTRAINT "project_baseline_tasks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_baseline_tasks" ADD CONSTRAINT "project_baseline_tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_baseline_tasks" ADD CONSTRAINT "project_baseline_tasks_baseline_id_project_baselines_id_fk" FOREIGN KEY ("baseline_id") REFERENCES "public"."project_baselines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_baselines" ADD CONSTRAINT "project_baselines_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_baselines" ADD CONSTRAINT "project_baselines_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_baselines" ADD CONSTRAINT "project_baselines_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_baselines" ADD CONSTRAINT "project_baselines_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "project_baseline_tasks_source_unique" ON "project_baseline_tasks" USING btree ("baseline_id","source_task_id");--> statement-breakpoint
CREATE INDEX "project_baseline_tasks_tenant_baseline_idx" ON "project_baseline_tasks" USING btree ("organization_id","workspace_id","baseline_id");--> statement-breakpoint
CREATE INDEX "project_baselines_tenant_project_created_idx" ON "project_baselines" USING btree ("organization_id","workspace_id","project_id","created_at");--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_milestone_dates_check" CHECK ("tasks"."is_milestone" = false or ("tasks"."start_date" is not null and "tasks"."due_date" = "tasks"."start_date"));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION validate_project_baseline_scope()
RETURNS trigger AS $$
DECLARE project_scope record;
BEGIN
  SELECT organization_id, workspace_id INTO project_scope
  FROM projects WHERE id = NEW.project_id AND deleted_at IS NULL;
  IF project_scope IS NULL
    OR project_scope.organization_id <> NEW.organization_id
    OR project_scope.workspace_id <> NEW.workspace_id THEN
    RAISE EXCEPTION 'Baseline must use the project tenant scope' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER project_baselines_validate_scope
BEFORE INSERT OR UPDATE ON project_baselines
FOR EACH ROW EXECUTE FUNCTION validate_project_baseline_scope();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION validate_project_baseline_task_scope()
RETURNS trigger AS $$
DECLARE baseline_scope record;
BEGIN
  SELECT organization_id, workspace_id, project_id INTO baseline_scope
  FROM project_baselines WHERE id = NEW.baseline_id;
  IF baseline_scope IS NULL
    OR baseline_scope.organization_id <> NEW.organization_id
    OR baseline_scope.workspace_id <> NEW.workspace_id
    OR baseline_scope.project_id <> NEW.project_id THEN
    RAISE EXCEPTION 'Baseline task must use the baseline tenant scope' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER project_baseline_tasks_validate_scope
BEFORE INSERT OR UPDATE ON project_baseline_tasks
FOR EACH ROW EXECUTE FUNCTION validate_project_baseline_task_scope();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_baseline_snapshot_update()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Baseline snapshots are immutable' USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER project_baselines_immutable
BEFORE UPDATE ON project_baselines
FOR EACH ROW EXECUTE FUNCTION prevent_baseline_snapshot_update();
--> statement-breakpoint
CREATE TRIGGER project_baseline_tasks_immutable
BEFORE UPDATE ON project_baseline_tasks
FOR EACH ROW EXECUTE FUNCTION prevent_baseline_snapshot_update();
--> statement-breakpoint
ALTER TABLE public.project_baselines ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.project_baselines FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON public.project_baselines
USING (public.app_tenant_matches(organization_id, workspace_id))
WITH CHECK (public.app_tenant_matches(organization_id, workspace_id));
--> statement-breakpoint
ALTER TABLE public.project_baseline_tasks ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.project_baseline_tasks FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON public.project_baseline_tasks
USING (public.app_tenant_matches(organization_id, workspace_id))
WITH CHECK (public.app_tenant_matches(organization_id, workspace_id));
