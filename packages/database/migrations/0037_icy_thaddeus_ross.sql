CREATE TYPE "public"."workload_time_off_kind" AS ENUM('vacation', 'sick', 'personal', 'public_holiday');--> statement-breakpoint
CREATE TYPE "public"."workload_time_off_status" AS ENUM('requested', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE "workload_capacities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"weekly_minutes" integer DEFAULT 2400 NOT NULL,
	"workday_mask" integer DEFAULT 62 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workload_capacities_weekly_minutes_check" CHECK ("workload_capacities"."weekly_minutes" between 0 and 10080),
	CONSTRAINT "workload_capacities_workday_mask_check" CHECK ("workload_capacities"."workday_mask" between 0 and 127)
);
--> statement-breakpoint
CREATE TABLE "workload_time_off" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid,
	"kind" "workload_time_off_kind" NOT NULL,
	"status" "workload_time_off_status" DEFAULT 'approved' NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"minutes_per_day" integer,
	"note" varchar(500),
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workload_time_off_range_check" CHECK ("workload_time_off"."ends_on" >= "workload_time_off"."starts_on"),
	CONSTRAINT "workload_time_off_minutes_check" CHECK ("workload_time_off"."minutes_per_day" is null or "workload_time_off"."minutes_per_day" between 1 and 1440),
	CONSTRAINT "workload_time_off_target_check" CHECK (("workload_time_off"."kind" = 'public_holiday' and "workload_time_off"."user_id" is null) or ("workload_time_off"."kind" <> 'public_holiday' and "workload_time_off"."user_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "workload_capacities" ADD CONSTRAINT "workload_capacities_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workload_capacities" ADD CONSTRAINT "workload_capacities_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workload_capacities" ADD CONSTRAINT "workload_capacities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workload_time_off" ADD CONSTRAINT "workload_time_off_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workload_time_off" ADD CONSTRAINT "workload_time_off_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workload_time_off" ADD CONSTRAINT "workload_time_off_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workload_time_off" ADD CONSTRAINT "workload_time_off_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workload_capacities_workspace_user_unique" ON "workload_capacities" USING btree ("organization_id","workspace_id","user_id");--> statement-breakpoint
CREATE INDEX "workload_capacities_tenant_user_idx" ON "workload_capacities" USING btree ("organization_id","workspace_id","user_id");--> statement-breakpoint
CREATE INDEX "workload_time_off_tenant_range_idx" ON "workload_time_off" USING btree ("organization_id","workspace_id","starts_on","ends_on");--> statement-breakpoint
CREATE INDEX "workload_time_off_tenant_user_idx" ON "workload_time_off" USING btree ("organization_id","workspace_id","user_id");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION validate_workload_tenant_scope()
RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM workspaces workspace
    WHERE workspace.id = NEW.workspace_id
      AND workspace.organization_id = NEW.organization_id
      AND workspace.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Workload record workspace does not belong to its organization' USING ERRCODE = '23503';
  END IF;

  IF NEW.user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM memberships membership
    WHERE membership.user_id = NEW.user_id
      AND membership.organization_id = NEW.organization_id
      AND membership.status = 'active'
      AND (membership.workspace_id IS NULL OR membership.workspace_id = NEW.workspace_id)
  ) THEN
    RAISE EXCEPTION 'Workload member does not have an active membership in this tenant scope' USING ERRCODE = '23503';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER workload_capacities_validate_scope
BEFORE INSERT OR UPDATE ON workload_capacities
FOR EACH ROW EXECUTE FUNCTION validate_workload_tenant_scope();
--> statement-breakpoint
CREATE TRIGGER workload_time_off_validate_scope
BEFORE INSERT OR UPDATE ON workload_time_off
FOR EACH ROW EXECUTE FUNCTION validate_workload_tenant_scope();
--> statement-breakpoint
ALTER TABLE public.workload_capacities ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.workload_capacities FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON public.workload_capacities
USING (public.app_tenant_matches(organization_id, workspace_id))
WITH CHECK (public.app_tenant_matches(organization_id, workspace_id));
--> statement-breakpoint
ALTER TABLE public.workload_time_off ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.workload_time_off FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON public.workload_time_off
USING (public.app_tenant_matches(organization_id, workspace_id))
WITH CHECK (public.app_tenant_matches(organization_id, workspace_id));
