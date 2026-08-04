CREATE TABLE "project_teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"added_by" uuid,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
UPDATE "projects"
SET
	"privacy" = COALESCE(NULLIF("privacy", ''), 'workspace'),
	"progress" = LEAST(100, GREATEST(0, COALESCE("progress", 0))),
	"logged_hours" = GREATEST(0, COALESCE("logged_hours", 0)),
	"budget" = CASE WHEN "budget" < 0 THEN 0 ELSE "budget" END,
	"estimated_hours" = CASE WHEN "estimated_hours" < 0 THEN 0 ELSE "estimated_hours" END,
	"end_date" = CASE WHEN "start_date" IS NOT NULL AND "end_date" < "start_date" THEN "start_date" ELSE "end_date" END;
--> statement-breakpoint
UPDATE "tasks"
SET
	"progress" = LEAST(100, GREATEST(0, COALESCE("progress", 0))),
	"logged_hours" = GREATEST(0, COALESCE("logged_hours", 0)),
	"estimated_hours" = CASE WHEN "estimated_hours" < 0 THEN 0 ELSE "estimated_hours" END,
	"story_points" = CASE WHEN "story_points" < 0 THEN 0 ELSE "story_points" END,
	"due_date" = CASE WHEN "start_date" IS NOT NULL AND "due_date" < "start_date" THEN "start_date" ELSE "due_date" END;
--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "privacy" SET DATA TYPE varchar(30);--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "privacy" SET DEFAULT 'workspace';--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "privacy" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "progress" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "logged_hours" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "logged_hours" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "progress" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "cover_url" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "manager_id" uuid;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "template" varchar(30) DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "timezone" varchar(100) DEFAULT 'UTC' NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "delay_reason" text;--> statement-breakpoint
UPDATE "tasks"
SET
	"delay_reason" = NULLIF("custom_fields"->>'delayReason', ''),
	"custom_fields" = COALESCE("custom_fields", '{}'::jsonb) - 'delayReason'
WHERE "custom_fields" ? 'delayReason';
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "project_teams" ADD CONSTRAINT "project_teams_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_teams" ADD CONSTRAINT "project_teams_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_teams" ADD CONSTRAINT "project_teams_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_teams" ADD CONSTRAINT "project_teams_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_teams" ADD CONSTRAINT "project_teams_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "project_teams_project_team_active_unique" ON "project_teams" USING btree ("project_id","team_id") WHERE "project_teams"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "project_teams_tenant_project_active_idx" ON "project_teams" USING btree ("organization_id","workspace_id","project_id","deleted_at","team_id");--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_manager_id_users_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "projects_tenant_manager_active_idx" ON "projects" USING btree ("organization_id","workspace_id","manager_id","deleted_at");--> statement-breakpoint
INSERT INTO "project_members" (
	"organization_id", "workspace_id", "project_id", "user_id", "role", "is_owner", "added_by"
)
SELECT
	project."organization_id", project."workspace_id", project."id", project."owner_id", 'manager', true, project."owner_id"
FROM "projects" project
WHERE project."owner_id" IS NOT NULL
	AND project."deleted_at" IS NULL
	AND NOT EXISTS (
		SELECT 1 FROM "project_members" member
		WHERE member."project_id" = project."id"
			AND member."user_id" = project."owner_id"
			AND member."deleted_at" IS NULL
	);
--> statement-breakpoint
INSERT INTO "task_assignees" (
	"organization_id", "workspace_id", "project_id", "task_id", "user_id", "is_primary", "assigned_by"
)
SELECT
	task."organization_id", task."workspace_id", task."project_id", task."id", task."assignee_id", true, task."reporter_id"
FROM "tasks" task
WHERE task."assignee_id" IS NOT NULL
	AND task."deleted_at" IS NULL
	AND NOT EXISTS (
		SELECT 1 FROM "task_assignees" assignee
		WHERE assignee."task_id" = task."id"
			AND assignee."user_id" = task."assignee_id"
			AND assignee."unassigned_at" IS NULL
	);
--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_progress_check" CHECK ("projects"."progress" between 0 and 100);--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_budget_check" CHECK ("projects"."budget" is null or "projects"."budget" >= 0);--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_estimated_hours_check" CHECK ("projects"."estimated_hours" is null or "projects"."estimated_hours" >= 0);--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_logged_hours_check" CHECK ("projects"."logged_hours" >= 0);--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_date_range_check" CHECK ("projects"."start_date" is null or "projects"."end_date" is null or "projects"."end_date" >= "projects"."start_date");--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_version_check" CHECK ("projects"."version" >= 1);--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_privacy_check" CHECK ("projects"."privacy" in ('workspace', 'private', 'private-members', 'guest-share', 'archived'));--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_progress_check" CHECK ("tasks"."progress" between 0 and 100);--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_estimated_hours_check" CHECK ("tasks"."estimated_hours" is null or "tasks"."estimated_hours" >= 0);--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_logged_hours_check" CHECK ("tasks"."logged_hours" >= 0);--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_story_points_check" CHECK ("tasks"."story_points" is null or "tasks"."story_points" >= 0);--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_date_range_check" CHECK ("tasks"."start_date" is null or "tasks"."due_date" is null or "tasks"."due_date" >= "tasks"."start_date");--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_version_check" CHECK ("tasks"."version" >= 1);
--> statement-breakpoint
ALTER TABLE public.project_teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_teams FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.project_teams
USING (public.app_tenant_matches(organization_id, workspace_id))
WITH CHECK (public.app_tenant_matches(organization_id, workspace_id));
