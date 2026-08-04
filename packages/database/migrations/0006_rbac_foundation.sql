CREATE TYPE "public"."authorization_scope" AS ENUM('organization', 'workspace', 'project');--> statement-breakpoint
CREATE TYPE "public"."permission_override_effect" AS ENUM('allow', 'deny');--> statement-breakpoint
CREATE TABLE "membership_permission_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid,
	"project_id" uuid,
	"membership_id" uuid NOT NULL,
	"permission_id" uuid NOT NULL,
	"scope" "authorization_scope" NOT NULL,
	"effect" "permission_override_effect" NOT NULL,
	"reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "membership_permission_overrides_scope_check" CHECK (("membership_permission_overrides"."scope" = 'organization' and "membership_permission_overrides"."workspace_id" is null and "membership_permission_overrides"."project_id" is null)
        or ("membership_permission_overrides"."scope" = 'workspace' and "membership_permission_overrides"."workspace_id" is not null and "membership_permission_overrides"."project_id" is null)
        or ("membership_permission_overrides"."scope" = 'project' and "membership_permission_overrides"."workspace_id" is not null and "membership_permission_overrides"."project_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "membership_role_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid,
	"project_id" uuid,
	"membership_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"scope" "authorization_scope" NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "membership_role_bindings_scope_check" CHECK (("membership_role_bindings"."scope" = 'organization' and "membership_role_bindings"."workspace_id" is null and "membership_role_bindings"."project_id" is null)
        or ("membership_role_bindings"."scope" = 'workspace' and "membership_role_bindings"."workspace_id" is not null and "membership_role_bindings"."project_id" is null)
        or ("membership_role_bindings"."scope" = 'project' and "membership_role_bindings"."workspace_id" is not null and "membership_role_bindings"."project_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(160) NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"category" varchar(80) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "permissions_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role_id" uuid NOT NULL,
	"permission_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"key" varchar(100) NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "roles_ownership_check" CHECK (("roles"."is_system" and "roles"."organization_id" is null) or (not "roles"."is_system" and "roles"."organization_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "membership_permission_overrides" ADD CONSTRAINT "membership_permission_overrides_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_permission_overrides" ADD CONSTRAINT "membership_permission_overrides_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_permission_overrides" ADD CONSTRAINT "membership_permission_overrides_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_permission_overrides" ADD CONSTRAINT "membership_permission_overrides_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_permission_overrides" ADD CONSTRAINT "membership_permission_overrides_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_permission_overrides" ADD CONSTRAINT "membership_permission_overrides_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_role_bindings" ADD CONSTRAINT "membership_role_bindings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_role_bindings" ADD CONSTRAINT "membership_role_bindings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_role_bindings" ADD CONSTRAINT "membership_role_bindings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_role_bindings" ADD CONSTRAINT "membership_role_bindings_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_role_bindings" ADD CONSTRAINT "membership_role_bindings_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_role_bindings" ADD CONSTRAINT "membership_role_bindings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "membership_permission_overrides_organization_unique" ON "membership_permission_overrides" USING btree ("membership_id","permission_id") WHERE "membership_permission_overrides"."scope" = 'organization';--> statement-breakpoint
CREATE UNIQUE INDEX "membership_permission_overrides_workspace_unique" ON "membership_permission_overrides" USING btree ("membership_id","workspace_id","permission_id") WHERE "membership_permission_overrides"."scope" = 'workspace';--> statement-breakpoint
CREATE UNIQUE INDEX "membership_permission_overrides_project_unique" ON "membership_permission_overrides" USING btree ("membership_id","project_id","permission_id") WHERE "membership_permission_overrides"."scope" = 'project';--> statement-breakpoint
CREATE INDEX "membership_permission_overrides_tenant_scope_idx" ON "membership_permission_overrides" USING btree ("organization_id","workspace_id","project_id","membership_id");--> statement-breakpoint
CREATE UNIQUE INDEX "membership_role_bindings_primary_unique" ON "membership_role_bindings" USING btree ("membership_id") WHERE "membership_role_bindings"."is_primary";--> statement-breakpoint
CREATE UNIQUE INDEX "membership_role_bindings_organization_unique" ON "membership_role_bindings" USING btree ("membership_id","role_id") WHERE "membership_role_bindings"."scope" = 'organization';--> statement-breakpoint
CREATE UNIQUE INDEX "membership_role_bindings_workspace_unique" ON "membership_role_bindings" USING btree ("membership_id","workspace_id","role_id") WHERE "membership_role_bindings"."scope" = 'workspace';--> statement-breakpoint
CREATE UNIQUE INDEX "membership_role_bindings_project_unique" ON "membership_role_bindings" USING btree ("membership_id","project_id","role_id") WHERE "membership_role_bindings"."scope" = 'project';--> statement-breakpoint
CREATE INDEX "membership_role_bindings_tenant_scope_idx" ON "membership_role_bindings" USING btree ("organization_id","workspace_id","project_id","membership_id");--> statement-breakpoint
CREATE UNIQUE INDEX "role_permissions_role_permission_unique" ON "role_permissions" USING btree ("role_id","permission_id");--> statement-breakpoint
CREATE UNIQUE INDEX "roles_system_key_unique" ON "roles" USING btree ("key") WHERE "roles"."organization_id" is null and "roles"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "roles_organization_key_unique" ON "roles" USING btree ("organization_id","key") WHERE "roles"."organization_id" is not null and "roles"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "roles_organization_active_idx" ON "roles" USING btree ("organization_id","deleted_at");
--> statement-breakpoint
INSERT INTO "permissions" ("key", "name", "description", "category") VALUES
  ('organization.manage', 'Manage organization', 'Change organization settings and ownership-sensitive configuration', 'organization'),
  ('workspace.manage', 'Manage workspace', 'Change workspace settings and structure', 'workspace'),
  ('members.manage', 'Manage members', 'Change membership roles and status', 'members'),
  ('members.invite', 'Invite members', 'Invite users to an organization or workspace', 'members'),
  ('projects.create', 'Create projects', 'Create projects in an allowed workspace', 'projects'),
  ('projects.update', 'Update projects', 'Update project settings and content', 'projects'),
  ('projects.delete', 'Delete projects', 'Archive or delete projects', 'projects'),
  ('projects.view_private', 'View private projects', 'View projects marked as private', 'projects'),
  ('tasks.create', 'Create tasks', 'Create tasks in an allowed project', 'tasks'),
  ('tasks.update_others', 'Update other users tasks', 'Update tasks owned by or assigned to other users', 'tasks'),
  ('tasks.delete', 'Delete tasks', 'Archive or delete tasks', 'tasks'),
  ('custom_fields.manage', 'Manage custom fields', 'Create, update, or remove custom fields', 'workspace'),
  ('automations.manage', 'Manage automations', 'Create, update, execute, or remove automations', 'workspace'),
  ('reports.view', 'View reports', 'View operational and analytical reports', 'reporting'),
  ('billing.manage', 'Manage billing', 'Manage subscriptions, invoices, and payment settings', 'billing'),
  ('data.export', 'Export data', 'Export organization or workspace data', 'security'),
  ('integrations.manage', 'Manage integrations', 'Configure and remove external integrations', 'integrations'),
  ('audit.view', 'View audit log', 'View security and audit history', 'security')
ON CONFLICT ("key") DO UPDATE SET
  "name" = excluded."name",
  "description" = excluded."description",
  "category" = excluded."category";
--> statement-breakpoint
INSERT INTO "roles" ("key", "name", "description", "is_system") VALUES
  ('owner', 'Owner', 'Full organization control including ownership-sensitive operations', true),
  ('admin', 'Admin', 'Administrative access excluding owner-only operations', true),
  ('manager', 'Manager', 'Workspace, project, task, automation, and reporting management', true),
  ('member', 'Member', 'Standard project and task contribution access', true),
  ('guest', 'Guest', 'Limited contribution access to explicitly assigned resources', true),
  ('viewer', 'Viewer', 'Read-only access to explicitly visible resources', true)
ON CONFLICT ("key") WHERE "organization_id" IS NULL AND "deleted_at" IS NULL DO UPDATE SET
  "name" = excluded."name",
  "description" = excluded."description",
  "updated_at" = now();
--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT role."id", permission."id"
FROM "roles" role
JOIN "permissions" permission ON permission."key" = ANY (
  CASE role."key"
    WHEN 'owner' THEN ARRAY[
      'organization.manage', 'workspace.manage', 'members.manage', 'members.invite',
      'projects.create', 'projects.update', 'projects.delete', 'projects.view_private',
      'tasks.create', 'tasks.update_others', 'tasks.delete', 'custom_fields.manage',
      'automations.manage', 'reports.view', 'billing.manage', 'data.export',
      'integrations.manage', 'audit.view'
    ]::text[]
    WHEN 'admin' THEN ARRAY[
      'workspace.manage', 'members.manage', 'members.invite', 'projects.create',
      'projects.update', 'projects.delete', 'projects.view_private', 'tasks.create',
      'tasks.update_others', 'tasks.delete', 'custom_fields.manage', 'automations.manage',
      'reports.view', 'data.export', 'integrations.manage', 'audit.view'
    ]::text[]
    WHEN 'manager' THEN ARRAY[
      'projects.create', 'projects.update', 'projects.delete', 'projects.view_private',
      'tasks.create', 'tasks.update_others', 'tasks.delete', 'custom_fields.manage',
      'automations.manage', 'reports.view', 'data.export'
    ]::text[]
    WHEN 'member' THEN ARRAY['projects.create', 'tasks.create']::text[]
    WHEN 'guest' THEN ARRAY['tasks.create']::text[]
    ELSE ARRAY[]::text[]
  END
)
WHERE role."is_system" = true
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
--> statement-breakpoint
CREATE FUNCTION "validate_authorization_assignment_scope"() RETURNS trigger AS $$
DECLARE
  membership_organization_id uuid;
  membership_workspace_id uuid;
  role_organization_id uuid;
BEGIN
  SELECT "organization_id", "workspace_id"
  INTO membership_organization_id, membership_workspace_id
  FROM "memberships"
  WHERE "id" = NEW."membership_id";

  IF membership_organization_id IS NULL OR membership_organization_id <> NEW."organization_id" THEN
    RAISE EXCEPTION 'Authorization assignment organization does not match its membership';
  END IF;

  IF membership_workspace_id IS NOT NULL AND membership_workspace_id IS DISTINCT FROM NEW."workspace_id" THEN
    RAISE EXCEPTION 'Authorization assignment workspace does not match its membership';
  END IF;

  IF NEW."workspace_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "workspaces"
    WHERE "id" = NEW."workspace_id" AND "organization_id" = NEW."organization_id"
  ) THEN
    RAISE EXCEPTION 'Authorization assignment workspace does not belong to its organization';
  END IF;

  IF NEW."project_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "projects"
    WHERE "id" = NEW."project_id"
      AND "organization_id" = NEW."organization_id"
      AND "workspace_id" = NEW."workspace_id"
  ) THEN
    RAISE EXCEPTION 'Authorization assignment project does not belong to its tenant scope';
  END IF;

  IF TG_TABLE_NAME = 'membership_role_bindings' THEN
    SELECT "organization_id" INTO role_organization_id
    FROM "roles"
    WHERE "id" = NEW."role_id" AND "deleted_at" IS NULL;

    IF NOT FOUND OR (role_organization_id IS NOT NULL AND role_organization_id <> NEW."organization_id") THEN
      RAISE EXCEPTION 'Authorization role is not available in this organization';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "membership_role_bindings_validate_scope"
BEFORE INSERT OR UPDATE ON "membership_role_bindings"
FOR EACH ROW EXECUTE FUNCTION "validate_authorization_assignment_scope"();
--> statement-breakpoint
CREATE TRIGGER "membership_permission_overrides_validate_scope"
BEFORE INSERT OR UPDATE ON "membership_permission_overrides"
FOR EACH ROW EXECUTE FUNCTION "validate_authorization_assignment_scope"();
--> statement-breakpoint
INSERT INTO "membership_role_bindings" (
  "organization_id", "workspace_id", "membership_id", "role_id", "scope", "is_primary"
)
SELECT
  membership."organization_id",
  membership."workspace_id",
  membership."id",
  role."id",
  CASE WHEN membership."workspace_id" IS NULL
    THEN 'organization'::"authorization_scope"
    ELSE 'workspace'::"authorization_scope"
  END,
  true
FROM "memberships" membership
JOIN "roles" role
  ON role."key" = membership."role"::text
  AND role."is_system" = true
  AND role."deleted_at" IS NULL
ON CONFLICT ("membership_id") WHERE "is_primary" DO UPDATE SET
  "organization_id" = excluded."organization_id",
  "workspace_id" = excluded."workspace_id",
  "project_id" = NULL,
  "role_id" = excluded."role_id",
  "scope" = excluded."scope",
  "updated_at" = now();
--> statement-breakpoint
CREATE FUNCTION "sync_membership_primary_role_binding"() RETURNS trigger AS $$
DECLARE
  system_role_id uuid;
  binding_scope "authorization_scope";
BEGIN
  SELECT "id" INTO system_role_id
  FROM "roles"
  WHERE "key" = NEW."role"::text
    AND "is_system" = true
    AND "deleted_at" IS NULL;

  IF system_role_id IS NULL THEN
    RAISE EXCEPTION 'System role % is not configured', NEW."role";
  END IF;

  binding_scope := CASE WHEN NEW."workspace_id" IS NULL
    THEN 'organization'::"authorization_scope"
    ELSE 'workspace'::"authorization_scope"
  END;

  INSERT INTO "membership_role_bindings" (
    "organization_id", "workspace_id", "membership_id", "role_id", "scope", "is_primary"
  ) VALUES (
    NEW."organization_id", NEW."workspace_id", NEW."id", system_role_id, binding_scope, true
  )
  ON CONFLICT ("membership_id") WHERE "is_primary" DO UPDATE SET
    "organization_id" = excluded."organization_id",
    "workspace_id" = excluded."workspace_id",
    "project_id" = NULL,
    "role_id" = excluded."role_id",
    "scope" = excluded."scope",
    "updated_at" = now();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "memberships_sync_primary_role_binding"
AFTER INSERT OR UPDATE OF "role", "organization_id", "workspace_id" ON "memberships"
FOR EACH ROW EXECUTE FUNCTION "sync_membership_primary_role_binding"();
