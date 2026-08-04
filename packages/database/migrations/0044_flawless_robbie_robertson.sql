CREATE TABLE "dashboard_layouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"widgets" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dashboard_layouts_widgets_array_check" CHECK (jsonb_typeof("dashboard_layouts"."widgets") = 'array'),
	CONSTRAINT "dashboard_layouts_version_positive_check" CHECK ("dashboard_layouts"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "dashboard_layouts" ADD CONSTRAINT "dashboard_layouts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dashboard_layouts" ADD CONSTRAINT "dashboard_layouts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dashboard_layouts" ADD CONSTRAINT "dashboard_layouts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dashboard_layouts_user_workspace_unique" ON "dashboard_layouts" USING btree ("organization_id","workspace_id","user_id");--> statement-breakpoint
CREATE INDEX "dashboard_layouts_tenant_updated_idx" ON "dashboard_layouts" USING btree ("organization_id","workspace_id","updated_at");--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.validate_dashboard_layout_scope()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
	IF TG_OP = 'UPDATE' AND (
		OLD.organization_id <> NEW.organization_id
		OR OLD.workspace_id <> NEW.workspace_id
		OR OLD.user_id <> NEW.user_id
	) THEN
		RAISE EXCEPTION 'Dashboard layout ownership and tenant scope are immutable';
	END IF;
	IF NOT EXISTS (
		SELECT 1 FROM public.workspaces workspace
		WHERE workspace.id = NEW.workspace_id
			AND workspace.organization_id = NEW.organization_id
	) THEN
		RAISE EXCEPTION 'Dashboard layout workspace is outside the organization';
	END IF;
	IF NOT EXISTS (
		SELECT 1 FROM public.memberships membership
		WHERE membership.organization_id = NEW.organization_id
			AND membership.user_id = NEW.user_id
			AND membership.status = 'active'
			AND (membership.workspace_id = NEW.workspace_id OR membership.workspace_id IS NULL)
	) THEN
		RAISE EXCEPTION 'Dashboard layout owner must be an active workspace member';
	END IF;
	IF TG_OP = 'UPDATE' THEN
		NEW.updated_at := CURRENT_TIMESTAMP;
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER dashboard_layouts_validate_scope
BEFORE INSERT OR UPDATE ON public.dashboard_layouts
FOR EACH ROW EXECUTE FUNCTION public.validate_dashboard_layout_scope();--> statement-breakpoint
ALTER TABLE public.dashboard_layouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dashboard_layouts FORCE ROW LEVEL SECURITY;
CREATE POLICY dashboard_layouts_owner_isolation ON public.dashboard_layouts
USING (
	public.app_tenant_matches(organization_id, workspace_id)
	AND user_id = public.app_current_actor_id()
)
WITH CHECK (
	public.app_tenant_matches(organization_id, workspace_id)
	AND user_id = public.app_current_actor_id()
);
