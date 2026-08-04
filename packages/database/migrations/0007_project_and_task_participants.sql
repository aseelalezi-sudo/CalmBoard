CREATE TYPE "public"."project_member_role" AS ENUM('manager', 'member', 'guest', 'viewer');--> statement-breakpoint
CREATE TABLE "project_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "project_member_role" DEFAULT 'member' NOT NULL,
	"is_owner" boolean DEFAULT false NOT NULL,
	"added_by" uuid,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "task_assignees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"assigned_by" uuid,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"unassigned_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "task_followers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"followed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"unfollowed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_assignees" ADD CONSTRAINT "task_assignees_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_assignees" ADD CONSTRAINT "task_assignees_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_assignees" ADD CONSTRAINT "task_assignees_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_assignees" ADD CONSTRAINT "task_assignees_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_assignees" ADD CONSTRAINT "task_assignees_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_assignees" ADD CONSTRAINT "task_assignees_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_followers" ADD CONSTRAINT "task_followers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_followers" ADD CONSTRAINT "task_followers_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_followers" ADD CONSTRAINT "task_followers_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_followers" ADD CONSTRAINT "task_followers_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_followers" ADD CONSTRAINT "task_followers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "project_members_project_user_active_unique" ON "project_members" USING btree ("project_id","user_id") WHERE "project_members"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "project_members_project_owner_active_unique" ON "project_members" USING btree ("project_id") WHERE "project_members"."is_owner" and "project_members"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "project_members_tenant_project_active_idx" ON "project_members" USING btree ("organization_id","workspace_id","project_id","deleted_at","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "task_assignees_task_user_active_unique" ON "task_assignees" USING btree ("task_id","user_id") WHERE "task_assignees"."unassigned_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "task_assignees_task_primary_active_unique" ON "task_assignees" USING btree ("task_id") WHERE "task_assignees"."is_primary" and "task_assignees"."unassigned_at" is null;--> statement-breakpoint
CREATE INDEX "task_assignees_tenant_user_active_idx" ON "task_assignees" USING btree ("organization_id","workspace_id","user_id","unassigned_at","task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "task_followers_task_user_active_unique" ON "task_followers" USING btree ("task_id","user_id") WHERE "task_followers"."unfollowed_at" is null;--> statement-breakpoint
CREATE INDEX "task_followers_tenant_user_active_idx" ON "task_followers" USING btree ("organization_id","workspace_id","user_id","unfollowed_at","task_id");
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "projects" project
    WHERE project."owner_id" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM "memberships" membership
        WHERE membership."user_id" = project."owner_id"
          AND membership."organization_id" = project."organization_id"
          AND membership."status" = 'active'
          AND (membership."workspace_id" IS NULL OR membership."workspace_id" = project."workspace_id")
      )
  ) THEN
    RAISE EXCEPTION 'Project owners without an active matching tenant membership must be resolved before participant backfill';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "tasks" task
    CROSS JOIN LATERAL (VALUES (task."assignee_id"), (task."reporter_id")) participant("user_id")
    WHERE participant."user_id" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM "memberships" membership
        WHERE membership."user_id" = participant."user_id"
          AND membership."organization_id" = task."organization_id"
          AND membership."status" = 'active'
          AND (membership."workspace_id" IS NULL OR membership."workspace_id" = task."workspace_id")
      )
  ) THEN
    RAISE EXCEPTION 'Task assignees or reporters without an active matching tenant membership must be resolved before participant backfill';
  END IF;
END $$;
--> statement-breakpoint
CREATE FUNCTION "validate_participant_tenant_scope"() RETURNS trigger AS $$
DECLARE
  scoped_project record;
  scoped_task record;
  requires_active_membership boolean := false;
BEGIN
  SELECT "organization_id", "workspace_id"
  INTO scoped_project
  FROM "projects"
  WHERE "id" = NEW."project_id";

  IF NOT FOUND
    OR scoped_project."organization_id" <> NEW."organization_id"
    OR scoped_project."workspace_id" <> NEW."workspace_id" THEN
    RAISE EXCEPTION 'Participant project does not belong to its tenant scope';
  END IF;

  IF TG_TABLE_NAME IN ('task_assignees', 'task_followers') THEN
    SELECT "organization_id", "workspace_id", "project_id"
    INTO scoped_task
    FROM "tasks"
    WHERE "id" = NEW."task_id";

    IF NOT FOUND
      OR scoped_task."organization_id" <> NEW."organization_id"
      OR scoped_task."workspace_id" <> NEW."workspace_id"
      OR scoped_task."project_id" <> NEW."project_id" THEN
      RAISE EXCEPTION 'Participant task does not belong to its project and tenant scope';
    END IF;
  END IF;

  IF TG_TABLE_NAME = 'project_members' THEN
    requires_active_membership := NEW."deleted_at" IS NULL;
  ELSIF TG_TABLE_NAME = 'task_assignees' THEN
    requires_active_membership := NEW."unassigned_at" IS NULL;
  ELSIF TG_TABLE_NAME = 'task_followers' THEN
    requires_active_membership := NEW."unfollowed_at" IS NULL;
  END IF;

  IF requires_active_membership THEN
    IF NOT EXISTS (
      SELECT 1 FROM "memberships" membership
      WHERE membership."user_id" = NEW."user_id"
        AND membership."organization_id" = NEW."organization_id"
        AND membership."status" = 'active'
        AND (membership."workspace_id" IS NULL OR membership."workspace_id" = NEW."workspace_id")
    ) THEN
      RAISE EXCEPTION 'Participant does not have an active membership in this tenant scope';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "project_members_validate_tenant_scope"
BEFORE INSERT OR UPDATE ON "project_members"
FOR EACH ROW EXECUTE FUNCTION "validate_participant_tenant_scope"();
--> statement-breakpoint
CREATE TRIGGER "task_assignees_validate_tenant_scope"
BEFORE INSERT OR UPDATE ON "task_assignees"
FOR EACH ROW EXECUTE FUNCTION "validate_participant_tenant_scope"();
--> statement-breakpoint
CREATE TRIGGER "task_followers_validate_tenant_scope"
BEFORE INSERT OR UPDATE ON "task_followers"
FOR EACH ROW EXECUTE FUNCTION "validate_participant_tenant_scope"();
--> statement-breakpoint
INSERT INTO "project_members" (
  "organization_id", "workspace_id", "project_id", "user_id", "role", "is_owner"
)
SELECT "organization_id", "workspace_id", "id", "owner_id", 'manager', true
FROM "projects"
WHERE "owner_id" IS NOT NULL AND "deleted_at" IS NULL
ON CONFLICT ("project_id", "user_id") WHERE "deleted_at" IS NULL DO UPDATE SET
  "role" = 'manager',
  "is_owner" = true,
  "updated_at" = now();
--> statement-breakpoint
INSERT INTO "task_assignees" (
  "organization_id", "workspace_id", "project_id", "task_id", "user_id", "is_primary"
)
SELECT "organization_id", "workspace_id", "project_id", "id", "assignee_id", true
FROM "tasks"
WHERE "assignee_id" IS NOT NULL AND "deleted_at" IS NULL
ON CONFLICT ("task_id", "user_id") WHERE "unassigned_at" IS NULL DO UPDATE SET
  "is_primary" = true;
--> statement-breakpoint
INSERT INTO "task_followers" (
  "organization_id", "workspace_id", "project_id", "task_id", "user_id"
)
SELECT DISTINCT "organization_id", "workspace_id", "project_id", "id", participant."user_id"
FROM "tasks"
CROSS JOIN LATERAL (VALUES ("reporter_id"), ("assignee_id")) participant("user_id")
WHERE participant."user_id" IS NOT NULL AND "deleted_at" IS NULL
ON CONFLICT ("task_id", "user_id") WHERE "unfollowed_at" IS NULL DO NOTHING;
--> statement-breakpoint
CREATE FUNCTION "sync_project_owner_membership"() RETURNS trigger AS $$
BEGIN
  IF NEW."deleted_at" IS NOT NULL THEN
    UPDATE "project_members"
    SET "is_owner" = false, "deleted_at" = coalesce("deleted_at", NEW."deleted_at"), "updated_at" = now()
    WHERE "project_id" = NEW."id" AND "deleted_at" IS NULL;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' OR NEW."owner_id" IS DISTINCT FROM OLD."owner_id" OR OLD."deleted_at" IS NOT NULL THEN
    UPDATE "project_members"
    SET "is_owner" = false, "updated_at" = now()
    WHERE "project_id" = NEW."id" AND "is_owner" = true AND "deleted_at" IS NULL;

    IF NEW."owner_id" IS NOT NULL AND NEW."deleted_at" IS NULL THEN
      INSERT INTO "project_members" (
        "organization_id", "workspace_id", "project_id", "user_id", "role", "is_owner"
      ) VALUES (
        NEW."organization_id", NEW."workspace_id", NEW."id", NEW."owner_id", 'manager', true
      )
      ON CONFLICT ("project_id", "user_id") WHERE "deleted_at" IS NULL DO UPDATE SET
        "role" = 'manager',
        "is_owner" = true,
        "updated_at" = now();
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "projects_sync_owner_membership"
AFTER INSERT OR UPDATE OF "owner_id", "deleted_at" ON "projects"
FOR EACH ROW EXECUTE FUNCTION "sync_project_owner_membership"();
--> statement-breakpoint
CREATE FUNCTION "sync_task_primary_assignee_and_followers"() RETURNS trigger AS $$
BEGIN
  IF NEW."deleted_at" IS NOT NULL THEN
    UPDATE "task_assignees"
    SET "is_primary" = false, "unassigned_at" = coalesce("unassigned_at", NEW."deleted_at")
    WHERE "task_id" = NEW."id" AND "unassigned_at" IS NULL;

    UPDATE "task_followers"
    SET "unfollowed_at" = coalesce("unfollowed_at", NEW."deleted_at")
    WHERE "task_id" = NEW."id" AND "unfollowed_at" IS NULL;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD."assignee_id" IS DISTINCT FROM NEW."assignee_id" THEN
    UPDATE "task_assignees"
    SET "is_primary" = false, "unassigned_at" = now()
    WHERE "task_id" = NEW."id" AND "is_primary" = true AND "unassigned_at" IS NULL;
  END IF;

  IF NEW."assignee_id" IS NOT NULL AND NEW."deleted_at" IS NULL THEN
    INSERT INTO "task_assignees" (
      "organization_id", "workspace_id", "project_id", "task_id", "user_id", "is_primary"
    ) VALUES (
      NEW."organization_id", NEW."workspace_id", NEW."project_id", NEW."id", NEW."assignee_id", true
    )
    ON CONFLICT ("task_id", "user_id") WHERE "unassigned_at" IS NULL DO UPDATE SET
      "is_primary" = true;

    INSERT INTO "task_followers" (
      "organization_id", "workspace_id", "project_id", "task_id", "user_id"
    ) VALUES (
      NEW."organization_id", NEW."workspace_id", NEW."project_id", NEW."id", NEW."assignee_id"
    )
    ON CONFLICT ("task_id", "user_id") WHERE "unfollowed_at" IS NULL DO NOTHING;
  END IF;

  IF NEW."reporter_id" IS NOT NULL AND NEW."deleted_at" IS NULL THEN
    INSERT INTO "task_followers" (
      "organization_id", "workspace_id", "project_id", "task_id", "user_id"
    ) VALUES (
      NEW."organization_id", NEW."workspace_id", NEW."project_id", NEW."id", NEW."reporter_id"
    )
    ON CONFLICT ("task_id", "user_id") WHERE "unfollowed_at" IS NULL DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "tasks_sync_primary_assignee_and_followers"
AFTER INSERT OR UPDATE OF "assignee_id", "reporter_id", "deleted_at" ON "tasks"
FOR EACH ROW EXECUTE FUNCTION "sync_task_primary_assignee_and_followers"();
