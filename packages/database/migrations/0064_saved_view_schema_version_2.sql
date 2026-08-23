ALTER TABLE "saved_views" DROP CONSTRAINT IF EXISTS "saved_views_configuration_version_check";--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_configuration_version_check" CHECK (jsonb_typeof("saved_views"."configuration") = 'object' and "saved_views"."configuration"->>'schemaVersion' in ('1', '2'));--> statement-breakpoint
ALTER TABLE "saved_views" DROP CONSTRAINT IF EXISTS "saved_views_default_scope_check";--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_default_scope_check" CHECK ("saved_views"."is_default" = false or "saved_views"."project_id" is not null);--> statement-breakpoint
WITH ranked_defaults AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY organization_id, workspace_id, project_id
           ORDER BY updated_at DESC, created_at DESC, id DESC
         ) as rank
  FROM saved_views
  WHERE is_default = true AND deleted_at IS NULL AND project_id IS NOT NULL
)
UPDATE saved_views
SET is_default = false, updated_at = NOW()
WHERE id IN (
  SELECT id FROM ranked_defaults WHERE rank > 1
);--> statement-breakpoint
DROP INDEX IF EXISTS "saved_views_creator_project_default_unique";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "saved_views_project_default_unique" ON "saved_views" USING btree ("organization_id","workspace_id","project_id") WHERE "saved_views"."is_default" = true and "saved_views"."deleted_at" is null and "saved_views"."project_id" is not null;
