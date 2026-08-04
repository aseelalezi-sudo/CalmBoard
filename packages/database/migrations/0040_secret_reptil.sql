CREATE TYPE "public"."document_access_level" AS ENUM('viewer', 'editor', 'manager');--> statement-breakpoint
CREATE TYPE "public"."document_workspace_access" AS ENUM('none', 'viewer', 'editor');--> statement-breakpoint
CREATE TABLE "document_permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"doc_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"access_level" "document_access_level" NOT NULL,
	"granted_by_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_permissions_no_self_grant_check" CHECK ("document_permissions"."user_id" <> "document_permissions"."granted_by_id")
);
--> statement-breakpoint
ALTER TABLE "doc_versions" DROP CONSTRAINT "doc_versions_doc_id_docs_id_fk";
--> statement-breakpoint
UPDATE "docs" SET "is_public" = false WHERE "is_public" IS NULL;--> statement-breakpoint
ALTER TABLE "docs" ALTER COLUMN "is_public" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "docs" ADD COLUMN "workspace_access" "document_workspace_access" DEFAULT 'viewer' NOT NULL;--> statement-breakpoint
ALTER TABLE "docs" ADD COLUMN "inherit_permissions" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "document_permissions" ADD CONSTRAINT "document_permissions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_permissions" ADD CONSTRAINT "document_permissions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_permissions" ADD CONSTRAINT "document_permissions_doc_id_docs_id_fk" FOREIGN KEY ("doc_id") REFERENCES "public"."docs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_permissions" ADD CONSTRAINT "document_permissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_permissions" ADD CONSTRAINT "document_permissions_granted_by_id_users_id_fk" FOREIGN KEY ("granted_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_permissions_doc_user_unique" ON "document_permissions" USING btree ("doc_id","user_id");--> statement-breakpoint
CREATE INDEX "document_permissions_tenant_user_idx" ON "document_permissions" USING btree ("organization_id","workspace_id","user_id","doc_id");--> statement-breakpoint
ALTER TABLE "doc_versions" ADD CONSTRAINT "doc_versions_doc_id_docs_id_fk" FOREIGN KEY ("doc_id") REFERENCES "public"."docs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "docs" ADD CONSTRAINT "docs_parent_id_docs_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."docs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "doc_versions_document_number_unique" ON "doc_versions" USING btree ("doc_id","version_number");--> statement-breakpoint
CREATE INDEX "doc_versions_tenant_document_created_idx" ON "doc_versions" USING btree ("organization_id","workspace_id","doc_id","created_at");--> statement-breakpoint
CREATE INDEX "docs_tenant_parent_active_idx" ON "docs" USING btree ("organization_id","workspace_id","parent_id","deleted_at");--> statement-breakpoint
ALTER TABLE "doc_versions" ADD CONSTRAINT "doc_versions_number_positive_check" CHECK ("doc_versions"."version_number" > 0);--> statement-breakpoint
ALTER TABLE "docs" ADD CONSTRAINT "docs_parent_not_self_check" CHECK ("docs"."parent_id" is null or "docs"."parent_id" <> "docs"."id");--> statement-breakpoint
ALTER TABLE public.document_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_permissions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.document_permissions
USING (public.app_tenant_matches(organization_id, workspace_id))
WITH CHECK (public.app_tenant_matches(organization_id, workspace_id));--> statement-breakpoint
CREATE POLICY docs_public_select ON public.docs FOR SELECT
USING (is_public = true AND deleted_at IS NULL);--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.validate_document_hierarchy()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  parent_found boolean;
  ancestor_depth integer;
  descendant_depth integer;
  cycle_found boolean;
BEGIN
  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.docs parent
    WHERE parent.id = NEW.parent_id
      AND parent.organization_id = NEW.organization_id
      AND parent.workspace_id = NEW.workspace_id
      AND parent.deleted_at IS NULL
  ) INTO parent_found;
  IF NOT parent_found THEN
    RAISE EXCEPTION 'document parent must belong to the same active workspace'
      USING ERRCODE = '23514';
  END IF;

  WITH RECURSIVE ancestors AS (
    SELECT
      parent.id,
      parent.parent_id,
      1 AS depth,
      ARRAY[parent.id]::uuid[] AS path,
      parent.id = NEW.id AS cycle
    FROM public.docs parent
    WHERE parent.id = NEW.parent_id
      AND parent.organization_id = NEW.organization_id
      AND parent.workspace_id = NEW.workspace_id
      AND parent.deleted_at IS NULL
    UNION ALL
    SELECT
      parent.id,
      parent.parent_id,
      ancestors.depth + 1,
      ancestors.path || parent.id,
      parent.id = ANY(ancestors.path) OR parent.id = NEW.id
    FROM ancestors
    JOIN public.docs parent ON parent.id = ancestors.parent_id
    WHERE NOT ancestors.cycle
      AND ancestors.depth <= 10
      AND parent.organization_id = NEW.organization_id
      AND parent.workspace_id = NEW.workspace_id
      AND parent.deleted_at IS NULL
  )
  SELECT COALESCE(MAX(depth), 0), COALESCE(BOOL_OR(cycle), false)
  INTO ancestor_depth, cycle_found
  FROM ancestors;

  IF cycle_found THEN
    RAISE EXCEPTION 'document parent would create a cycle'
      USING ERRCODE = '23514';
  END IF;

  WITH RECURSIVE descendants AS (
    SELECT child.id, 2 AS depth, ARRAY[NEW.id, child.id]::uuid[] AS path
    FROM public.docs child
    WHERE child.parent_id = NEW.id
      AND child.id <> NEW.id
      AND child.organization_id = NEW.organization_id
      AND child.workspace_id = NEW.workspace_id
      AND child.deleted_at IS NULL
    UNION ALL
    SELECT child.id, descendants.depth + 1, descendants.path || child.id
    FROM descendants
    JOIN public.docs child ON child.parent_id = descendants.id
    WHERE NOT child.id = ANY(descendants.path)
      AND descendants.depth <= 10
      AND child.organization_id = NEW.organization_id
      AND child.workspace_id = NEW.workspace_id
      AND child.deleted_at IS NULL
  )
  SELECT COALESCE(MAX(depth), 1) INTO descendant_depth FROM descendants;

  IF ancestor_depth + descendant_depth > 10 THEN
    RAISE EXCEPTION 'document nesting cannot exceed 10 levels'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER docs_validate_hierarchy
BEFORE INSERT OR UPDATE OF parent_id, organization_id, workspace_id, deleted_at
ON public.docs
FOR EACH ROW
EXECUTE FUNCTION public.validate_document_hierarchy();--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.validate_document_child_scope()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.docs document
    WHERE document.id = NEW.doc_id
      AND document.organization_id = NEW.organization_id
      AND document.workspace_id = NEW.workspace_id
      AND document.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'document child row must match an active document tenant'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER document_permissions_validate_scope
BEFORE INSERT OR UPDATE OF organization_id, workspace_id, doc_id
ON public.document_permissions
FOR EACH ROW
EXECUTE FUNCTION public.validate_document_child_scope();--> statement-breakpoint
CREATE TRIGGER doc_versions_validate_scope
BEFORE INSERT OR UPDATE OF organization_id, workspace_id, doc_id
ON public.doc_versions
FOR EACH ROW
EXECUTE FUNCTION public.validate_document_child_scope();
