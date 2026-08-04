CREATE TYPE "public"."task_approval_mode" AS ENUM('all', 'any', 'sequential');--> statement-breakpoint
CREATE TYPE "public"."task_approval_reviewer_status" AS ENUM('pending', 'approved', 'rejected', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."task_approval_status" AS ENUM('pending', 'approved', 'rejected', 'canceled');--> statement-breakpoint
CREATE TABLE "task_approval_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"mode" "task_approval_mode" DEFAULT 'all' NOT NULL,
	"status" "task_approval_status" DEFAULT 'pending' NOT NULL,
	"message" text,
	"due_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "task_approval_requests_resolution_check" CHECK (("task_approval_requests"."status" = 'pending' and "task_approval_requests"."resolved_at" is null) or ("task_approval_requests"."status" <> 'pending' and "task_approval_requests"."resolved_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "task_approval_reviewers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"approval_request_id" uuid NOT NULL,
	"reviewer_id" uuid NOT NULL,
	"sequence" integer DEFAULT 0 NOT NULL,
	"status" "task_approval_reviewer_status" DEFAULT 'pending' NOT NULL,
	"comment" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "task_approval_reviewers_sequence_check" CHECK ("task_approval_reviewers"."sequence" >= 0),
	CONSTRAINT "task_approval_reviewers_decision_check" CHECK (("task_approval_reviewers"."status" = 'pending' and "task_approval_reviewers"."decided_at" is null) or ("task_approval_reviewers"."status" <> 'pending' and "task_approval_reviewers"."decided_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "task_checklist_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"checklist_id" uuid NOT NULL,
	"title" varchar(500) NOT NULL,
	"order" double precision DEFAULT 0 NOT NULL,
	"is_completed" boolean DEFAULT false NOT NULL,
	"completed_by" uuid,
	"completed_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "task_checklist_items_completion_check" CHECK (("task_checklist_items"."is_completed" = false and "task_checklist_items"."completed_at" is null and "task_checklist_items"."completed_by" is null) or ("task_checklist_items"."is_completed" = true and "task_checklist_items"."completed_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "task_checklists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"title" varchar(255) NOT NULL,
	"order" double precision DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "task_approval_requests" ADD CONSTRAINT "task_approval_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_approval_requests" ADD CONSTRAINT "task_approval_requests_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_approval_requests" ADD CONSTRAINT "task_approval_requests_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_approval_requests" ADD CONSTRAINT "task_approval_requests_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_approval_requests" ADD CONSTRAINT "task_approval_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_approval_reviewers" ADD CONSTRAINT "task_approval_reviewers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_approval_reviewers" ADD CONSTRAINT "task_approval_reviewers_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_approval_reviewers" ADD CONSTRAINT "task_approval_reviewers_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_approval_reviewers" ADD CONSTRAINT "task_approval_reviewers_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_approval_reviewers" ADD CONSTRAINT "task_approval_reviewers_approval_request_id_task_approval_requests_id_fk" FOREIGN KEY ("approval_request_id") REFERENCES "public"."task_approval_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_approval_reviewers" ADD CONSTRAINT "task_approval_reviewers_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_checklist_items" ADD CONSTRAINT "task_checklist_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_checklist_items" ADD CONSTRAINT "task_checklist_items_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_checklist_items" ADD CONSTRAINT "task_checklist_items_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_checklist_items" ADD CONSTRAINT "task_checklist_items_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_checklist_items" ADD CONSTRAINT "task_checklist_items_checklist_id_task_checklists_id_fk" FOREIGN KEY ("checklist_id") REFERENCES "public"."task_checklists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_checklist_items" ADD CONSTRAINT "task_checklist_items_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_checklist_items" ADD CONSTRAINT "task_checklist_items_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_checklists" ADD CONSTRAINT "task_checklists_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_checklists" ADD CONSTRAINT "task_checklists_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_checklists" ADD CONSTRAINT "task_checklists_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_checklists" ADD CONSTRAINT "task_checklists_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_checklists" ADD CONSTRAINT "task_checklists_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "task_approval_requests_task_pending_unique" ON "task_approval_requests" USING btree ("task_id") WHERE "task_approval_requests"."status" = 'pending' and "task_approval_requests"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "task_approval_requests_tenant_task_status_idx" ON "task_approval_requests" USING btree ("organization_id","workspace_id","task_id","status","deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "task_approval_reviewers_request_user_active_unique" ON "task_approval_reviewers" USING btree ("approval_request_id","reviewer_id") WHERE "task_approval_reviewers"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "task_approval_reviewers_request_sequence_active_unique" ON "task_approval_reviewers" USING btree ("approval_request_id","sequence") WHERE "task_approval_reviewers"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "task_approval_reviewers_tenant_reviewer_status_idx" ON "task_approval_reviewers" USING btree ("organization_id","workspace_id","reviewer_id","status","deleted_at");--> statement-breakpoint
CREATE INDEX "task_checklist_items_tenant_checklist_order_idx" ON "task_checklist_items" USING btree ("organization_id","workspace_id","checklist_id","deleted_at","order");--> statement-breakpoint
CREATE INDEX "task_checklists_tenant_task_order_idx" ON "task_checklists" USING btree ("organization_id","workspace_id","task_id","deleted_at","order");
--> statement-breakpoint
CREATE FUNCTION "tenant_user_is_active_member"(tenant_organization_id uuid, tenant_workspace_id uuid, tenant_user_id uuid)
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1
    FROM "memberships" membership
    WHERE membership."organization_id" = tenant_organization_id
      AND membership."user_id" = tenant_user_id
      AND membership."status" = 'active'
      AND (membership."workspace_id" IS NULL OR membership."workspace_id" = tenant_workspace_id)
  );
$$ LANGUAGE sql STABLE;
--> statement-breakpoint
CREATE FUNCTION "validate_task_workflow_scope"() RETURNS trigger AS $$
DECLARE
  workflow_task record;
BEGIN
  SELECT "organization_id", "workspace_id", "project_id", "deleted_at"
  INTO workflow_task
  FROM "tasks"
  WHERE "id" = NEW."task_id";

  IF workflow_task."organization_id" IS NULL
    OR workflow_task."organization_id" <> NEW."organization_id"
    OR workflow_task."workspace_id" <> NEW."workspace_id"
    OR workflow_task."project_id" <> NEW."project_id" THEN
    RAISE EXCEPTION 'Task workflow does not belong to the task tenant and project scope';
  END IF;

  IF workflow_task."deleted_at" IS NOT NULL THEN
    IF TG_TABLE_NAME = 'task_checklists' AND NEW."deleted_at" IS NULL THEN
      RAISE EXCEPTION 'Active task workflows cannot reference deleted tasks';
    ELSIF TG_TABLE_NAME = 'task_approval_requests' THEN
      IF NEW."deleted_at" IS NULL AND NEW."status" = 'pending' THEN
        RAISE EXCEPTION 'Active task workflows cannot reference deleted tasks';
      END IF;
    END IF;
  END IF;

  IF TG_TABLE_NAME = 'task_approval_requests' THEN
    IF NOT "tenant_user_is_active_member"(NEW."organization_id", NEW."workspace_id", NEW."requested_by") THEN
      RAISE EXCEPTION 'Task approval requester is not an active tenant member';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "task_checklists_validate_scope"
BEFORE INSERT OR UPDATE ON "task_checklists"
FOR EACH ROW EXECUTE FUNCTION "validate_task_workflow_scope"();
--> statement-breakpoint
CREATE TRIGGER "task_approval_requests_validate_scope"
BEFORE INSERT OR UPDATE ON "task_approval_requests"
FOR EACH ROW EXECUTE FUNCTION "validate_task_workflow_scope"();
--> statement-breakpoint
CREATE FUNCTION "validate_task_checklist_item"() RETURNS trigger AS $$
DECLARE
  parent_checklist record;
BEGIN
  SELECT "organization_id", "workspace_id", "project_id", "task_id", "deleted_at"
  INTO parent_checklist
  FROM "task_checklists"
  WHERE "id" = NEW."checklist_id";

  IF parent_checklist."organization_id" IS NULL
    OR parent_checklist."organization_id" <> NEW."organization_id"
    OR parent_checklist."workspace_id" <> NEW."workspace_id"
    OR parent_checklist."project_id" <> NEW."project_id"
    OR parent_checklist."task_id" <> NEW."task_id" THEN
    RAISE EXCEPTION 'Checklist item does not belong to its checklist scope';
  END IF;

  IF NEW."deleted_at" IS NULL AND parent_checklist."deleted_at" IS NOT NULL THEN
    RAISE EXCEPTION 'Active checklist items cannot reference deleted checklists';
  END IF;

  IF NEW."completed_by" IS NOT NULL
    AND NOT "tenant_user_is_active_member"(NEW."organization_id", NEW."workspace_id", NEW."completed_by") THEN
    RAISE EXCEPTION 'Checklist completer is not an active tenant member';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "task_checklist_items_validate"
BEFORE INSERT OR UPDATE ON "task_checklist_items"
FOR EACH ROW EXECUTE FUNCTION "validate_task_checklist_item"();
--> statement-breakpoint
CREATE FUNCTION "validate_task_approval_reviewer"() RETURNS trigger AS $$
DECLARE
  approval record;
BEGIN
  SELECT "organization_id", "workspace_id", "project_id", "task_id", "mode", "status", "deleted_at"
  INTO approval
  FROM "task_approval_requests"
  WHERE "id" = NEW."approval_request_id";

  IF approval."organization_id" IS NULL
    OR approval."organization_id" <> NEW."organization_id"
    OR approval."workspace_id" <> NEW."workspace_id"
    OR approval."project_id" <> NEW."project_id"
    OR approval."task_id" <> NEW."task_id" THEN
    RAISE EXCEPTION 'Task approval reviewer does not belong to its request scope';
  END IF;

  IF NEW."deleted_at" IS NULL AND approval."deleted_at" IS NOT NULL THEN
    RAISE EXCEPTION 'Active approval reviewers cannot reference deleted requests';
  END IF;

  IF NOT "tenant_user_is_active_member"(NEW."organization_id", NEW."workspace_id", NEW."reviewer_id") THEN
    RAISE EXCEPTION 'Task approval reviewer is not an active tenant member';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD."status" IS DISTINCT FROM NEW."status" THEN
    IF OLD."status" <> 'pending' THEN
      RAISE EXCEPTION 'Task approval decisions are immutable';
    END IF;
    IF NEW."status" IN ('approved', 'rejected') AND approval."status" <> 'pending' THEN
      RAISE EXCEPTION 'Task approval request is already resolved';
    END IF;
    IF NEW."status" IN ('approved', 'rejected') AND approval."mode" = 'sequential' AND EXISTS (
      SELECT 1
      FROM "task_approval_reviewers" earlier
      WHERE earlier."approval_request_id" = NEW."approval_request_id"
        AND earlier."sequence" < NEW."sequence"
        AND earlier."status" = 'pending'
        AND earlier."deleted_at" IS NULL
    ) THEN
      RAISE EXCEPTION 'Task approval reviewers must decide in sequence';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "task_approval_reviewers_validate"
BEFORE INSERT OR UPDATE ON "task_approval_reviewers"
FOR EACH ROW EXECUTE FUNCTION "validate_task_approval_reviewer"();
--> statement-breakpoint
CREATE FUNCTION "sync_task_approval_status"() RETURNS trigger AS $$
DECLARE
  approval record;
  final_status "task_approval_status";
BEGIN
  IF OLD."status" = 'pending' AND NEW."status" IN ('approved', 'rejected') THEN
    SELECT "mode", "status"
    INTO approval
    FROM "task_approval_requests"
    WHERE "id" = NEW."approval_request_id"
    FOR UPDATE;

    IF approval."status" = 'pending' THEN
      IF NEW."status" = 'rejected' THEN
        final_status := 'rejected';
      ELSIF approval."mode" = 'any' THEN
        final_status := 'approved';
      ELSIF NOT EXISTS (
        SELECT 1 FROM "task_approval_reviewers" reviewer
        WHERE reviewer."approval_request_id" = NEW."approval_request_id"
          AND reviewer."status" = 'pending'
          AND reviewer."deleted_at" IS NULL
      ) THEN
        final_status := 'approved';
      END IF;

      IF final_status IS NOT NULL THEN
        UPDATE "task_approval_requests"
        SET "status" = final_status, "resolved_at" = now(), "updated_at" = now()
        WHERE "id" = NEW."approval_request_id";

        UPDATE "task_approval_reviewers"
        SET "status" = 'skipped', "decided_at" = now(), "updated_at" = now()
        WHERE "approval_request_id" = NEW."approval_request_id"
          AND "id" <> NEW."id"
          AND "status" = 'pending'
          AND "deleted_at" IS NULL;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "task_approval_reviewers_sync_request"
AFTER UPDATE OF "status" ON "task_approval_reviewers"
FOR EACH ROW EXECUTE FUNCTION "sync_task_approval_status"();
--> statement-breakpoint
CREATE FUNCTION "close_task_workflow_children"() RETURNS trigger AS $$
BEGIN
  IF TG_TABLE_NAME = 'task_checklists' THEN
    IF NEW."deleted_at" IS NOT NULL AND OLD."deleted_at" IS NULL THEN
      UPDATE "task_checklist_items"
      SET "deleted_at" = NEW."deleted_at", "updated_at" = NEW."deleted_at"
      WHERE "checklist_id" = NEW."id" AND "deleted_at" IS NULL;
    END IF;
  ELSIF TG_TABLE_NAME = 'task_approval_requests' THEN
    IF OLD."status" = 'pending' AND NEW."status" = 'canceled' THEN
      UPDATE "task_approval_reviewers"
      SET "status" = 'skipped', "decided_at" = NEW."resolved_at", "updated_at" = NEW."updated_at"
      WHERE "approval_request_id" = NEW."id" AND "status" = 'pending' AND "deleted_at" IS NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "task_checklists_close_items"
AFTER UPDATE OF "deleted_at" ON "task_checklists"
FOR EACH ROW EXECUTE FUNCTION "close_task_workflow_children"();
--> statement-breakpoint
CREATE TRIGGER "task_approval_requests_close_reviewers"
AFTER UPDATE OF "status" ON "task_approval_requests"
FOR EACH ROW EXECUTE FUNCTION "close_task_workflow_children"();
--> statement-breakpoint
CREATE FUNCTION "close_deleted_task_workflows"() RETURNS trigger AS $$
BEGIN
  IF NEW."deleted_at" IS NOT NULL AND OLD."deleted_at" IS NULL THEN
    UPDATE "task_checklists"
    SET "deleted_at" = NEW."deleted_at", "updated_at" = NEW."deleted_at"
    WHERE "task_id" = NEW."id" AND "deleted_at" IS NULL;

    UPDATE "task_approval_requests"
    SET "status" = 'canceled', "resolved_at" = NEW."deleted_at", "updated_at" = NEW."deleted_at"
    WHERE "task_id" = NEW."id" AND "status" = 'pending' AND "deleted_at" IS NULL;

    UPDATE "task_approval_reviewers"
    SET "deleted_at" = NEW."deleted_at", "updated_at" = NEW."deleted_at"
    WHERE "task_id" = NEW."id" AND "deleted_at" IS NULL;

    UPDATE "task_approval_requests"
    SET "deleted_at" = NEW."deleted_at", "updated_at" = NEW."deleted_at"
    WHERE "task_id" = NEW."id" AND "deleted_at" IS NULL;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "tasks_close_deleted_workflows"
AFTER UPDATE OF "deleted_at" ON "tasks"
FOR EACH ROW EXECUTE FUNCTION "close_deleted_task_workflows"();
