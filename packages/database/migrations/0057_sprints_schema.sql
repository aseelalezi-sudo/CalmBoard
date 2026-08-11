CREATE TYPE "public"."sprint_status" AS ENUM('planned', 'active', 'completed', 'cancelled');--> statement-breakpoint
CREATE TABLE "sprints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"goal" text,
	"status" "sprint_status" DEFAULT 'planned' NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "task_sprint_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"sprint_id" uuid NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	"assigned_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "sprint_id" uuid;--> statement-breakpoint
ALTER TABLE "sprints" ADD CONSTRAINT "sprints_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sprints" ADD CONSTRAINT "sprints_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sprints" ADD CONSTRAINT "sprints_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sprints" ADD CONSTRAINT "sprints_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_sprint_assignments" ADD CONSTRAINT "task_sprint_assignments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_sprint_assignments" ADD CONSTRAINT "task_sprint_assignments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_sprint_assignments" ADD CONSTRAINT "task_sprint_assignments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_sprint_assignments" ADD CONSTRAINT "task_sprint_assignments_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_sprint_assignments" ADD CONSTRAINT "task_sprint_assignments_sprint_id_sprints_id_fk" FOREIGN KEY ("sprint_id") REFERENCES "public"."sprints"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_sprint_assignments" ADD CONSTRAINT "task_sprint_assignments_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sprints_project_idx" ON "sprints" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "sprints_project_status_idx" ON "sprints" USING btree ("project_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "sprints_active_unique" ON "sprints" USING btree ("project_id") WHERE "sprints"."status" = 'active' and "sprints"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "task_sprint_assignments_task_idx" ON "task_sprint_assignments" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "task_sprint_assignments_sprint_idx" ON "task_sprint_assignments" USING btree ("sprint_id");--> statement-breakpoint
CREATE INDEX "task_sprint_assignments_project_idx" ON "task_sprint_assignments" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "task_sprint_assignments_active_unique" ON "task_sprint_assignments" USING btree ("task_id") WHERE "task_sprint_assignments"."removed_at" is null;--> statement-breakpoint
CREATE INDEX "tasks_sprint_id_idx" ON "tasks" USING btree ("sprint_id");--> statement-breakpoint
ALTER TABLE "sprints" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "task_sprint_assignments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "sprints" USING ("organization_id" = (SELECT public.app_current_organization_id()) AND ((SELECT public.app_current_workspace_id()) IS NULL OR "workspace_id" = (SELECT public.app_current_workspace_id()))) WITH CHECK ("organization_id" = (SELECT public.app_current_organization_id()) AND ((SELECT public.app_current_workspace_id()) IS NULL OR "workspace_id" = (SELECT public.app_current_workspace_id())));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "task_sprint_assignments" USING ("organization_id" = (SELECT public.app_current_organization_id()) AND ((SELECT public.app_current_workspace_id()) IS NULL OR "workspace_id" = (SELECT public.app_current_workspace_id()))) WITH CHECK ("organization_id" = (SELECT public.app_current_organization_id()) AND ((SELECT public.app_current_workspace_id()) IS NULL OR "workspace_id" = (SELECT public.app_current_workspace_id())));
--> statement-breakpoint
ALTER TABLE "sprints" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "task_sprint_assignments" FORCE ROW LEVEL SECURITY;
