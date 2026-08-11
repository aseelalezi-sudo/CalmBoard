CREATE TYPE "public"."sprint_data_quality" AS ENUM('exact', 'reconstructed', 'partial');--> statement-breakpoint
CREATE TYPE "public"."sprint_event_type" AS ENUM('task_added', 'task_removed', 'story_points_changed', 'task_completed', 'task_reopened');--> statement-breakpoint
CREATE TYPE "public"."sprint_snapshot_type" AS ENUM('start', 'complete');--> statement-breakpoint
CREATE TABLE "sprint_analytics_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"sprint_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"event_type" "sprint_event_type" NOT NULL,
	"story_points_at_event" integer,
	"is_completed_at_event" boolean NOT NULL,
	"old_story_points" integer,
	"new_story_points" integer,
	"occurred_at" timestamp with time zone NOT NULL,
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sprint_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"sprint_id" uuid NOT NULL,
	"snapshot_type" "sprint_snapshot_type" NOT NULL,
	"data_quality" "sprint_data_quality" NOT NULL,
	"scope_task_count" integer,
	"scope_story_points" integer,
	"completed_task_count" integer,
	"completed_story_points" integer,
	"remaining_task_count" integer,
	"remaining_story_points" integer,
	"captured_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sprint_snapshots_scope_tasks_check" CHECK ("sprint_snapshots"."scope_task_count" is null or "sprint_snapshots"."scope_task_count" >= 0),
	CONSTRAINT "sprint_snapshots_scope_points_check" CHECK ("sprint_snapshots"."scope_story_points" is null or "sprint_snapshots"."scope_story_points" >= 0),
	CONSTRAINT "sprint_snapshots_completed_tasks_check" CHECK ("sprint_snapshots"."completed_task_count" is null or "sprint_snapshots"."completed_task_count" >= 0),
	CONSTRAINT "sprint_snapshots_completed_points_check" CHECK ("sprint_snapshots"."completed_story_points" is null or "sprint_snapshots"."completed_story_points" >= 0),
	CONSTRAINT "sprint_snapshots_remaining_tasks_check" CHECK ("sprint_snapshots"."remaining_task_count" is null or "sprint_snapshots"."remaining_task_count" >= 0),
	CONSTRAINT "sprint_snapshots_remaining_points_check" CHECK ("sprint_snapshots"."remaining_story_points" is null or "sprint_snapshots"."remaining_story_points" >= 0)
);
--> statement-breakpoint
ALTER TABLE "sprint_analytics_events" ADD CONSTRAINT "sprint_analytics_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sprint_analytics_events" ADD CONSTRAINT "sprint_analytics_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sprint_analytics_events" ADD CONSTRAINT "sprint_analytics_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sprint_analytics_events" ADD CONSTRAINT "sprint_analytics_events_sprint_id_sprints_id_fk" FOREIGN KEY ("sprint_id") REFERENCES "public"."sprints"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sprint_analytics_events" ADD CONSTRAINT "sprint_analytics_events_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sprint_analytics_events" ADD CONSTRAINT "sprint_analytics_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sprint_snapshots" ADD CONSTRAINT "sprint_snapshots_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sprint_snapshots" ADD CONSTRAINT "sprint_snapshots_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sprint_snapshots" ADD CONSTRAINT "sprint_snapshots_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sprint_snapshots" ADD CONSTRAINT "sprint_snapshots_sprint_id_sprints_id_fk" FOREIGN KEY ("sprint_id") REFERENCES "public"."sprints"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sprint_analytics_events_sprint_idx" ON "sprint_analytics_events" USING btree ("sprint_id","occurred_at");--> statement-breakpoint
CREATE INDEX "sprint_analytics_events_project_idx" ON "sprint_analytics_events" USING btree ("project_id","occurred_at");--> statement-breakpoint
CREATE INDEX "sprint_analytics_events_task_idx" ON "sprint_analytics_events" USING btree ("task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sprint_snapshots_type_unique" ON "sprint_snapshots" USING btree ("sprint_id","snapshot_type");--> statement-breakpoint
CREATE INDEX "sprint_snapshots_project_type_captured_idx" ON "sprint_snapshots" USING btree ("project_id","snapshot_type","captured_at");--> statement-breakpoint
ALTER TABLE "sprint_snapshots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sprint_analytics_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "sprint_snapshots" USING ("organization_id" = (SELECT public.app_current_organization_id()) AND ((SELECT public.app_current_workspace_id()) IS NULL OR "workspace_id" = (SELECT public.app_current_workspace_id()))) WITH CHECK ("organization_id" = (SELECT public.app_current_organization_id()) AND ((SELECT public.app_current_workspace_id()) IS NULL OR "workspace_id" = (SELECT public.app_current_workspace_id())));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "sprint_analytics_events" USING ("organization_id" = (SELECT public.app_current_organization_id()) AND ((SELECT public.app_current_workspace_id()) IS NULL OR "workspace_id" = (SELECT public.app_current_workspace_id()))) WITH CHECK ("organization_id" = (SELECT public.app_current_organization_id()) AND ((SELECT public.app_current_workspace_id()) IS NULL OR "workspace_id" = (SELECT public.app_current_workspace_id())));
--> statement-breakpoint
ALTER TABLE "sprint_snapshots" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sprint_analytics_events" FORCE ROW LEVEL SECURITY;