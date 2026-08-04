CREATE INDEX "tasks_tenant_active_updated_idx" ON "tasks" USING btree ("organization_id","workspace_id","updated_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "tasks"."deleted_at" is null and "tasks"."parent_id" is null;--> statement-breakpoint
DROP POLICY "tenant_isolation" ON "tasks";--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "tasks"
USING (
  "organization_id" = (SELECT public.app_current_organization_id())
  AND (
    (SELECT public.app_current_workspace_id()) IS NULL
    OR "workspace_id" = (SELECT public.app_current_workspace_id())
  )
)
WITH CHECK (
  "organization_id" = (SELECT public.app_current_organization_id())
  AND (
    (SELECT public.app_current_workspace_id()) IS NULL
    OR "workspace_id" = (SELECT public.app_current_workspace_id())
  )
);
