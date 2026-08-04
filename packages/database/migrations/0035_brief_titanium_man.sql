CREATE TABLE "project_wip_limits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"status" "task_status" NOT NULL,
	"limit" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_wip_limits_limit_check" CHECK ("project_wip_limits"."limit" between 1 and 100000)
);
--> statement-breakpoint
ALTER TABLE "project_wip_limits" ADD CONSTRAINT "project_wip_limits_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_wip_limits" ADD CONSTRAINT "project_wip_limits_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_wip_limits" ADD CONSTRAINT "project_wip_limits_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "project_wip_limits_project_status_unique" ON "project_wip_limits" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "project_wip_limits_tenant_project_idx" ON "project_wip_limits" USING btree ("organization_id","workspace_id","project_id");--> statement-breakpoint
CREATE OR REPLACE FUNCTION validate_project_wip_limit_scope()
RETURNS trigger AS $$
DECLARE
  project_scope record;
BEGIN
  SELECT organization_id, workspace_id
  INTO project_scope
  FROM projects
  WHERE id = NEW.project_id
    AND deleted_at IS NULL;

  IF project_scope IS NULL
    OR project_scope.organization_id <> NEW.organization_id
    OR project_scope.workspace_id <> NEW.workspace_id THEN
    RAISE EXCEPTION 'WIP limit must use the project tenant scope' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER project_wip_limits_validate_scope
BEFORE INSERT OR UPDATE ON project_wip_limits
FOR EACH ROW EXECUTE FUNCTION validate_project_wip_limit_scope();--> statement-breakpoint
ALTER TABLE public.project_wip_limits ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.project_wip_limits FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON public.project_wip_limits
USING (public.app_tenant_matches(organization_id, workspace_id))
WITH CHECK (public.app_tenant_matches(organization_id, workspace_id));
