DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "memberships"
    GROUP BY "user_id", "organization_id", "workspace_id"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate memberships must be resolved before applying tenant uniqueness';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "invitations" WHERE "status" = 'pending'
    GROUP BY "organization_id", "workspace_id", lower("email")
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate pending invitations must be resolved before applying tenant uniqueness';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "tasks" GROUP BY "organization_id", "serial" HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate task serials must be resolved before applying tenant uniqueness';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "workspaces" GROUP BY "organization_id", "slug" HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate workspace slugs must be resolved before applying tenant uniqueness';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "custom_fields" WHERE "deleted_at" IS NULL
    GROUP BY "organization_id", "workspace_id", "project_id", "key"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate active custom-field keys must be resolved before applying tenant uniqueness';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "invoices" GROUP BY "organization_id", "number" HAVING count(*) > 1
  ) OR EXISTS (
    SELECT 1 FROM "branches" GROUP BY "organization_id", "code" HAVING count(*) > 1
  ) OR EXISTS (
    SELECT 1 FROM "notification_preferences" GROUP BY "user_id" HAVING count(*) > 1
  ) OR EXISTS (
    SELECT 1 FROM "usage_limits" GROUP BY "organization_id" HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate organization-owned identifiers must be resolved before applying uniqueness';
  END IF;
END
$$;--> statement-breakpoint

CREATE INDEX "attachments_tenant_task_active_idx" ON "attachments" USING btree ("organization_id","workspace_id","task_id","deleted_at");--> statement-breakpoint
CREATE INDEX "attachments_tenant_project_active_idx" ON "attachments" USING btree ("organization_id","workspace_id","project_id","deleted_at");--> statement-breakpoint
CREATE INDEX "automations_tenant_active_trigger_idx" ON "automations" USING btree ("organization_id","workspace_id","deleted_at","enabled","trigger");--> statement-breakpoint
CREATE UNIQUE INDEX "branches_organization_code_unique" ON "branches" USING btree ("organization_id","code");--> statement-breakpoint
CREATE INDEX "comments_tenant_task_active_created_idx" ON "comments" USING btree ("organization_id","workspace_id","task_id","deleted_at","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "custom_fields_workspace_key_unique" ON "custom_fields" USING btree ("organization_id","workspace_id","key") WHERE "custom_fields"."project_id" is null and "custom_fields"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "custom_fields_project_key_unique" ON "custom_fields" USING btree ("organization_id","workspace_id","project_id","key") WHERE "custom_fields"."project_id" is not null and "custom_fields"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "docs_tenant_active_updated_idx" ON "docs" USING btree ("organization_id","workspace_id","deleted_at","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_pending_org_workspace_email_unique" ON "invitations" USING btree ("organization_id","workspace_id",lower("email")) WHERE "invitations"."status" = 'pending' and "invitations"."workspace_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_pending_orgwide_email_unique" ON "invitations" USING btree ("organization_id",lower("email")) WHERE "invitations"."status" = 'pending' and "invitations"."workspace_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_organization_number_unique" ON "invoices" USING btree ("organization_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_user_org_workspace_unique" ON "memberships" USING btree ("user_id","organization_id","workspace_id") WHERE "memberships"."workspace_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_user_org_orgwide_unique" ON "memberships" USING btree ("user_id","organization_id") WHERE "memberships"."workspace_id" is null;--> statement-breakpoint
CREATE INDEX "memberships_tenant_status_lookup" ON "memberships" USING btree ("organization_id","workspace_id","status","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_preferences_user_unique" ON "notification_preferences" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "notifications_tenant_user_created_idx" ON "notifications" USING btree ("organization_id","workspace_id","user_id","created_at");--> statement-breakpoint
CREATE INDEX "projects_tenant_active_created_idx" ON "projects" USING btree ("organization_id","workspace_id","deleted_at","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_organization_serial_unique" ON "tasks" USING btree ("organization_id","serial");--> statement-breakpoint
CREATE INDEX "tasks_tenant_project_active_order_idx" ON "tasks" USING btree ("organization_id","workspace_id","project_id","deleted_at","order");--> statement-breakpoint
CREATE INDEX "tasks_tenant_assignee_status_idx" ON "tasks" USING btree ("organization_id","workspace_id","assignee_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "usage_limits_organization_unique" ON "usage_limits" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspaces_organization_slug_unique" ON "workspaces" USING btree ("organization_id","slug");--> statement-breakpoint
CREATE INDEX "workspaces_organization_active_idx" ON "workspaces" USING btree ("organization_id","deleted_at");
