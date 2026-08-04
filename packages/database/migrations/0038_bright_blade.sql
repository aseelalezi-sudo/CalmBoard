UPDATE "saved_views" SET "filters" = '{}'::jsonb WHERE "filters" IS NULL OR jsonb_typeof("filters") <> 'object';--> statement-breakpoint
UPDATE "saved_views" SET "is_shared" = false WHERE "is_shared" IS NULL;--> statement-breakpoint
ALTER TABLE "saved_views" ALTER COLUMN "filters" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "saved_views" ALTER COLUMN "is_shared" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "saved_views" ADD COLUMN "configuration" jsonb DEFAULT '{"schemaVersion":1}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "saved_views" ADD COLUMN "is_default" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "saved_views_tenant_project_visible_idx" ON "saved_views" USING btree ("organization_id","workspace_id","project_id","is_shared","created_by");--> statement-breakpoint
CREATE UNIQUE INDEX "saved_views_creator_project_default_unique" ON "saved_views" USING btree ("organization_id","workspace_id","project_id","created_by") WHERE "saved_views"."is_default" = true and "saved_views"."deleted_at" is null and "saved_views"."project_id" is not null and "saved_views"."created_by" is not null;--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_view_type_check" CHECK ("saved_views"."view_type" in ('board', 'list', 'table', 'calendar', 'timeline', 'workload'));--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_filters_object_check" CHECK (jsonb_typeof("saved_views"."filters") = 'object');--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_configuration_version_check" CHECK (jsonb_typeof("saved_views"."configuration") = 'object' and "saved_views"."configuration"->>'schemaVersion' = '1');--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_default_scope_check" CHECK ("saved_views"."is_default" = false or ("saved_views"."project_id" is not null and "saved_views"."created_by" is not null));--> statement-breakpoint
CREATE OR REPLACE FUNCTION validate_saved_view_tenant_scope()
RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM workspaces workspace
    WHERE workspace.id = NEW.workspace_id
      AND workspace.organization_id = NEW.organization_id
      AND workspace.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Saved view workspace does not belong to its organization' USING ERRCODE = '23503';
  END IF;

  IF NEW.project_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM projects project
    WHERE project.id = NEW.project_id
      AND project.organization_id = NEW.organization_id
      AND project.workspace_id = NEW.workspace_id
      AND project.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Saved view project does not belong to its tenant scope' USING ERRCODE = '23503';
  END IF;

  IF NEW.created_by IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM memberships membership
    WHERE membership.user_id = NEW.created_by
      AND membership.organization_id = NEW.organization_id
      AND membership.status = 'active'
      AND (membership.workspace_id IS NULL OR membership.workspace_id = NEW.workspace_id)
  ) THEN
    RAISE EXCEPTION 'Saved view owner does not have an active membership in this tenant scope' USING ERRCODE = '23503';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER saved_views_validate_scope
BEFORE INSERT OR UPDATE ON saved_views
FOR EACH ROW EXECUTE FUNCTION validate_saved_view_tenant_scope();
