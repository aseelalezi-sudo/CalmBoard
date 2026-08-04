ALTER TABLE "attachments" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
ALTER TABLE "automations" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
ALTER TABLE "doc_versions" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "doc_versions" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
ALTER TABLE "form_responses" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "form_responses" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
ALTER TABLE "forms" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "project_sections" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "project_sections" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
ALTER TABLE "saved_views" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "time_logs" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "time_logs" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint

UPDATE "teams" AS child
SET "organization_id" = parent."organization_id"
FROM "workspaces" AS parent
WHERE child."workspace_id" = parent."id";--> statement-breakpoint

UPDATE "project_sections" AS child
SET "organization_id" = parent."organization_id", "workspace_id" = parent."workspace_id"
FROM "projects" AS parent
WHERE child."project_id" = parent."id";--> statement-breakpoint

UPDATE "comments" AS child
SET "organization_id" = parent."organization_id", "workspace_id" = parent."workspace_id"
FROM "tasks" AS parent
WHERE child."task_id" = parent."id";--> statement-breakpoint

UPDATE "attachments" AS child
SET "organization_id" = parent."organization_id", "workspace_id" = parent."workspace_id"
FROM "tasks" AS parent
WHERE child."task_id" = parent."id";--> statement-breakpoint

UPDATE "attachments" AS child
SET "organization_id" = parent."organization_id", "workspace_id" = parent."workspace_id"
FROM "projects" AS parent
WHERE child."project_id" = parent."id" AND child."organization_id" IS NULL;--> statement-breakpoint

UPDATE "time_logs" AS child
SET "organization_id" = parent."organization_id", "workspace_id" = parent."workspace_id"
FROM "tasks" AS parent
WHERE child."task_id" = parent."id";--> statement-breakpoint

UPDATE "automations" AS child
SET "organization_id" = parent."organization_id"
FROM "workspaces" AS parent
WHERE child."workspace_id" = parent."id";--> statement-breakpoint

UPDATE "automation_runs" AS child
SET "organization_id" = parent."organization_id", "workspace_id" = parent."workspace_id"
FROM "automations" AS parent
WHERE child."automation_id" = parent."id";--> statement-breakpoint

UPDATE "forms" AS child
SET "organization_id" = parent."organization_id"
FROM "workspaces" AS parent
WHERE child."workspace_id" = parent."id";--> statement-breakpoint

UPDATE "form_responses" AS child
SET "organization_id" = parent."organization_id", "workspace_id" = parent."workspace_id"
FROM "forms" AS parent
WHERE child."form_id" = parent."id";--> statement-breakpoint

UPDATE "saved_views" AS child
SET "organization_id" = parent."organization_id"
FROM "workspaces" AS parent
WHERE child."workspace_id" = parent."id";--> statement-breakpoint

UPDATE "doc_versions" AS child
SET "organization_id" = parent."organization_id", "workspace_id" = parent."workspace_id"
FROM "docs" AS parent
WHERE child."doc_id" = parent."id";--> statement-breakpoint

UPDATE "notifications" AS child
SET "organization_id" = parent."organization_id", "workspace_id" = parent."workspace_id"
FROM "tasks" AS parent
WHERE child."entity_type" = 'task' AND child."entity_id" = parent."id"
  AND (child."organization_id" IS NULL OR child."workspace_id" IS NULL);--> statement-breakpoint

UPDATE "notifications" AS child
SET "organization_id" = parent."organization_id"
FROM "workspaces" AS parent
WHERE child."workspace_id" = parent."id" AND child."organization_id" IS NULL;--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "attachments" WHERE "organization_id" IS NULL OR "workspace_id" IS NULL)
    OR EXISTS (SELECT 1 FROM "automation_runs" WHERE "organization_id" IS NULL OR "workspace_id" IS NULL)
    OR EXISTS (SELECT 1 FROM "automations" WHERE "organization_id" IS NULL)
    OR EXISTS (SELECT 1 FROM "comments" WHERE "organization_id" IS NULL OR "workspace_id" IS NULL)
    OR EXISTS (SELECT 1 FROM "doc_versions" WHERE "organization_id" IS NULL OR "workspace_id" IS NULL)
    OR EXISTS (SELECT 1 FROM "form_responses" WHERE "organization_id" IS NULL OR "workspace_id" IS NULL)
    OR EXISTS (SELECT 1 FROM "forms" WHERE "organization_id" IS NULL)
    OR EXISTS (SELECT 1 FROM "notifications" WHERE "organization_id" IS NULL OR "workspace_id" IS NULL)
    OR EXISTS (SELECT 1 FROM "project_sections" WHERE "organization_id" IS NULL OR "workspace_id" IS NULL)
    OR EXISTS (SELECT 1 FROM "saved_views" WHERE "organization_id" IS NULL)
    OR EXISTS (SELECT 1 FROM "teams" WHERE "organization_id" IS NULL)
    OR EXISTS (SELECT 1 FROM "time_logs" WHERE "organization_id" IS NULL OR "workspace_id" IS NULL)
  THEN
    RAISE EXCEPTION 'Tenant backfill left orphan rows; repair the reported relationships before retrying migration';
  END IF;
END
$$;--> statement-breakpoint

ALTER TABLE "attachments" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "attachments" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "automation_runs" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "automation_runs" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "automations" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "comments" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "comments" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "doc_versions" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "doc_versions" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "form_responses" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "form_responses" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "forms" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "project_sections" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "project_sections" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "saved_views" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "teams" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "time_logs" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "time_logs" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automations" ADD CONSTRAINT "automations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_versions" ADD CONSTRAINT "doc_versions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_versions" ADD CONSTRAINT "doc_versions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_responses" ADD CONSTRAINT "form_responses_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_responses" ADD CONSTRAINT "form_responses_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forms" ADD CONSTRAINT "forms_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_sections" ADD CONSTRAINT "project_sections_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_sections" ADD CONSTRAINT "project_sections_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_logs" ADD CONSTRAINT "time_logs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_logs" ADD CONSTRAINT "time_logs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
